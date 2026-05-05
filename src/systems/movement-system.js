// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { preJoinShard, joinInstance, currentRtcConfig } from '../network/index.js';
import { getCurrentInstance } from '../network/shard.js';
import { myEntry } from '../security/identity.js';
import { shardEnemies, localPlayer, worldState } from '../state/store.js';
import { ITEMS, NPCS } from '../content/data.js';
import { getScatteredContent, getNPCDialogue, findSafeArrival } from '../rules/index.js';
import { getNPCsAt } from '../commands/helpers.js';
import { ACTION } from '../engine/input.js';

/**
 * MovementSystem handles spatial logic, collision detection, and room transitions.
 */
export class MovementSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {Record<string, any>} worldData - Authored world data (rooms, exits)
   * @param {any} gameActions - Network actions
   */
  constructor(world, worldData, gameActions) {
    this.world = world;
    this.worldData = worldData;
    this.gameActions = gameActions;
    this.isProcessing = false;
  }

  update() {
    // 1. Process explicit Intent
    const entitiesWithIntent = this.world.query([Component.Transform, Component.Intent]);

    for (const entityId of entitiesWithIntent) {
      const intent = this.world.getComponent(entityId, Component.Intent);
      const transform = this.world.getComponent(entityId, Component.Transform);

      if (intent.action === 'move') {
        this.handleMove(entityId, transform, intent.dir);
        this.world.removeComponent(entityId, Component.Intent);
        this.world.removeComponent(entityId, Component.MovementTarget);
      } else if (intent.action === 'interact') {
        this.handleInteract(entityId, transform);
        this.world.removeComponent(entityId, Component.Intent);
      }
    }

    // 2. Process Movement Targets (Tap-to-move)
    const entitiesWithTarget = this.world.query([Component.Transform, Component.MovementTarget]);
    for (const entityId of entitiesWithTarget) {
      if (this.world.getComponent(entityId, Component.Intent)) continue;
      if (this.world.getComponent(entityId, Component.Tweenable)) continue;

      const transform = this.world.getComponent(entityId, Component.Transform);
      const target = this.world.getComponent(entityId, Component.MovementTarget);

      if (transform.x === target.x && transform.y === target.y) {
        this.world.removeComponent(entityId, Component.MovementTarget);
        continue;
      }

      const nextStepDir = this.findNextStepBFS(transform, target);

      if (nextStepDir) {
        this.handleMove(entityId, transform, nextStepDir);
      } else {
        // Path blocked: give feedback and clear target
        const dx = target.x - transform.x;
        const dy = target.y - transform.y;
        let failDir;
        if (Math.abs(dx) > Math.abs(dy)) failDir = dx > 0 ? 'e' : 'w';
        else failDir = dy > 0 ? 's' : 'n';

        this.world.setComponent(entityId, Component.CollisionBump, { dir: failDir, progress: 0 });
        this.world.removeComponent(entityId, Component.MovementTarget);
      }
    }
    
    // Proactive Sharding (Step 3 of Phase 7.9.9.4)
    this.processProactiveSharding();
  }

  /**
   * @param {number} _entityId
   * @param {any} transform
   * @param {string} dir
   */
  async handleMove(entityId, transform, dir) {
    const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
    const dy = dir === 's' ? 1 : dir === 'n' ? -1 : 0;

    const loc = this.worldData[transform.mapId];
    if (!loc) return;

    const nx = transform.x + dx;
    const ny = transform.y + dy;

    // 1. Active Portal Detection
    const exitTile = (loc.exitTiles || []).find(t =>
        nx >= t.x && nx < t.x + (t.w || 1) &&
        ny >= t.y && ny < t.y + (t.h || 1)
    );
    if (exitTile) {
        await this.performTransition(entityId, transform, exitTile.dest, exitTile.destX, exitTile.destY);
        return;
    }

    // 2. Check Bounds — LttP-style full-edge transitions, preserving player position offset
    if (nx < 0 || nx >= loc.width || ny < 0 || ny >= loc.height) {
      const boundaryExit = this.findBoundaryExit(loc, transform.x, transform.y, dir);
      if (boundaryExit) {
        await this.performTransition(entityId, transform, boundaryExit.dest, boundaryExit.destX, boundaryExit.destY);
        return;
      }

      const destId = loc.exits?.[this.dirToKey(dir)];
      const hasAuthoredEdgeExit = this.roomHasBoundaryExit(loc, dir);
      if (destId && !hasAuthoredEdgeExit) {
        const destRoom = this.worldData[destId];
        if (!destRoom) return;
        const tx = this.getFallbackArrivalX(destRoom, dir);
        const ty = this.getFallbackArrivalY(destRoom, dir);
        await this.performTransition(entityId, transform, destId, tx, ty);
        return;
      }

      transform.facing = dir;
      this.world.setComponent(entityId, Component.CollisionBump, { dir, progress: 0 });
      this.world.removeComponent(entityId, Component.MovementTarget);
      return;
    }

    // 3. Check entity occupants first (NPCs/enemies take priority over scenery)
    const occupant = this.getOccupantAt(transform.mapId, nx, ny, entityId);
    if (occupant) {
        transform.facing = dir;
        if (occupant.type === 'npc') {
            this.openNpcInteraction(occupant.id);
        } else if (occupant.type === 'enemy') {
            bus.emit('input:action', { action: ACTION.ATTACK, type: 'down' });
        }
        return;
    }

    // 4. Check Static Collisions
    const isWall = (loc.tileOverrides || []).some(t => t.x === nx && t.y === ny && t.type === 'wall');
    const isScenery = (loc.scenery || []).some(s =>
        nx >= s.x && nx < s.x + (s.w || 1) &&
        ny >= s.y && ny < s.y + (s.h || 1)
    );
    if (isWall || isScenery) {
        transform.facing = dir;
        this.world.setComponent(entityId, Component.CollisionBump, { dir, progress: 0 });
        this.world.removeComponent(entityId, Component.MovementTarget);
        return;
    }

    // 4. Update Transform
    const oldX = transform.x;
    const oldY = transform.y;
    transform.x = nx;
    transform.y = ny;
    transform.facing = dir;

    // 5. Add Tweenable for visual interpolation
    this.world.setComponent(entityId, Component.Tweenable, {
      startX: oldX,
      startY: oldY,
      targetX: nx,
      targetY: ny,
      progress: 0
    });
  }

  /**
   * @param {number} entityId
   * @param {any} transform
   * @param {string} destId
   * @param {number} tx
  * @param {number} ty
  */
  async performTransition(entityId, transform, destId, tx, ty) {
    const loc = this.worldData[destId];
    const safePos = loc ? findSafeArrival(tx, ty, loc.width, loc.height, (x, y) => this.isWalkable(destId, x, y)) : { x: tx, y: ty };
    
    transform.mapId = destId;
    transform.x = safePos?.x ?? tx;
    transform.y = safePos?.y ?? ty;

    // Network Sync
    await joinInstance(destId, getCurrentInstance(), currentRtcConfig);
    const entry = await myEntry();
    if (entry && this.gameActions.sendPresenceSingle) this.gameActions.sendPresenceSingle(entry);
  }

  /**
   * @param {number} entityId
   * @param {any} transform
   */
  async handleInteract(entityId, transform) {
    const locId = transform.mapId;
    const loc = this.worldData[locId];
    const target = this.getFacingTarget(transform);
    
    // 1. Check for Portals
    const exitTile = (loc?.exitTiles || []).find(t =>
        transform.x >= t.x && transform.x < t.x + (t.w || 1) &&
        transform.y >= t.y && transform.y < t.y + (t.h || 1)
    );
    if (exitTile) {
        await this.performTransition(entityId, transform, exitTile.dest, exitTile.destX, exitTile.destY);
        return;
    }

    const occupant = this.getOccupantAt(locId, target.x, target.y, entityId);
    if (occupant?.type === 'npc') {
        this.openNpcInteraction(occupant.id);
        return;
    }
    if (occupant?.type === 'enemy') {
        bus.emit('input:action', { action: ACTION.ATTACK, type: 'down' });
        return;
    }

    // 2. Check for Foraging (Phase 8.1)
    const scattered = getScatteredContent(locId, worldState.day, loc);
    const itemAtFeet = scattered.find(s => s.x === transform.x && s.y === transform.y && s.type === 'flora');
    
    if (itemAtFeet) {
        const itemId = itemAtFeet.label === 'mushroom' ? 'red_mushroom' : 'herbs';
        const item = ITEMS[itemId];
        localPlayer.inventory.push(itemId);
        bus.emit('item:pickup', { item });
        bus.emit('log', { msg: `You foraged ${item?.name || itemAtFeet.label}!`, color: '#0f0' });
        return;
    }

    // 3. Check for Loot
    const sharedEnemy = shardEnemies.get(locId);
    if (sharedEnemy && sharedEnemy.hp <= 0 && sharedEnemy.loot && sharedEnemy.loot.length > 0) {
      const loot = [...sharedEnemy.loot];
      sharedEnemy.loot = [];
      loot.forEach(itemId => {
        const item = ITEMS[itemId];
        if (item?.type === 'gold') localPlayer.gold += item.amount;
        else localPlayer.inventory.push(itemId);
        bus.emit('item:pickup', { item });
      });
      bus.emit('log', { msg: `Picked up: ${loot.join(', ')}`, color: '#ff0' });
      return;
    }

    // 4. Fallback: NPC Interaction
    const npcs = getNPCsAt(locId);
    if (npcs.length > 0) {
        const npcId = npcs[0];
        this.openNpcInteraction(npcId);
    } else {
        bus.emit('log', { msg: `Nothing to pick up.` });
    }
  }

  getFacingTarget(transform) {
    const facing = transform.facing || 's';
    const dx = facing === 'e' ? 1 : facing === 'w' ? -1 : 0;
    const dy = facing === 's' ? 1 : facing === 'n' ? -1 : 0;
    return { x: transform.x + dx, y: transform.y + dy };
  }

  getOccupantAt(mapId, x, y, excludeEntityId) {
    const entities = this.world.query([Component.Transform, Component.Sprite]);
    for (const id of entities) {
      if (id === excludeEntityId) continue;
      const transform = this.world.getComponent(id, Component.Transform);
      const sprite = this.world.getComponent(id, Component.Sprite);
      if (!transform || !sprite || transform.mapId !== mapId) continue;
      if (transform.x !== x || transform.y !== y) continue;
      const identity = this.world.getComponent(id, 'Identity');
      return { entityId: id, type: sprite.type, id: identity?.id || sprite.type };
    }
    return null;
  }

  openNpcInteraction(npcId) {
    if (!NPCS[npcId]) return;
    const text = getNPCDialogue(npcId, worldState.seed, worldState.day, worldState.mood);
    const role = NPCS[npcId].role;
    if (role === 'shop' || role === 'quest') {
      bus.emit('npc:speak', { npcName: NPCS[npcId].name, text });
      bus.emit('ui:queue-menu', { type: 'npc', context: { npcId, text } });
      return;
    }
    bus.emit('npc:speak', { npcName: NPCS[npcId].name, text });
  }

  findBoundaryExit(loc, x, y, dir) {
    return (loc.exitTiles || []).find((tile) => {
      const width = tile.w || 1;
      const height = tile.h || 1;
      if (dir === 'n') return tile.y === 0 && x >= tile.x && x < tile.x + width && y >= tile.y && y < tile.y + height;
      if (dir === 's') return tile.y + height === loc.height && x >= tile.x && x < tile.x + width && y >= tile.y && y < tile.y + height;
      if (dir === 'e') return tile.x + width === loc.width && x >= tile.x && x < tile.x + width && y >= tile.y && y < tile.y + height;
      if (dir === 'w') return tile.x === 0 && x >= tile.x && x < tile.x + width && y >= tile.y && y < tile.y + height;
      return false;
    }) || null;
  }

  roomHasBoundaryExit(loc, dir) {
    return (loc.exitTiles || []).some((tile) => {
      const width = tile.w || 1;
      const height = tile.h || 1;
      if (dir === 'n') return tile.y === 0;
      if (dir === 's') return tile.y + height === loc.height;
      if (dir === 'e') return tile.x + width === loc.width;
      if (dir === 'w') return tile.x === 0;
      return false;
    });
  }

  getFallbackArrivalX(destRoom, dir) {
    if (dir === 'e') return 0;
    if (dir === 'w') return destRoom.width - 1;
    return Math.floor(destRoom.width / 2);
  }

  getFallbackArrivalY(destRoom, dir) {
    if (dir === 's') return 0;
    if (dir === 'n') return destRoom.height - 1;
    return Math.floor(destRoom.height / 2);
  }

  processProactiveSharding() {
    const players = this.world.query([Component.PlayerControlled, Component.Transform]);
    for (const id of players) {
      const transform = this.world.getComponent(id, Component.Transform);
      const loc = this.worldData[transform.mapId];
      if (!loc) continue;

      (loc.exitTiles || []).forEach(tile => {
        if (Math.abs(tile.x - transform.x) + Math.abs(tile.y - transform.y) <= 2) {
          preJoinShard(tile.dest);
        }
      });

      const exits = loc.exits || {};
      if (transform.x <= 1 && exits.west) preJoinShard(exits.west);
      if (transform.x >= loc.width - 2 && exits.east) preJoinShard(exits.east);
      if (transform.y <= 1 && exits.north) preJoinShard(exits.north);
      if (transform.y >= loc.height - 2 && exits.south) preJoinShard(exits.south);
    }
  }

  /**
   * Simple BFS to find the next step toward a target.
   * @param {any} transform 
   * @param {any} target 
   */
  findNextStepBFS(transform, target) {
    const startX = transform.x;
    const startY = transform.y;
    const mapId = transform.mapId;
    const loc = this.worldData[mapId];
    if (!loc) return null;

    // Use a simple BFS since rooms are small and we only need the first step
    const queue = [[startX, startY, []]];
    const visited = new Set([`${startX},${startY}`]);
    const maxNodes = 400; // Safety cap for performance
    let nodesProcessed = 0;

    while (queue.length > 0 && nodesProcessed < maxNodes) {
      const [cx, cy, path] = queue.shift();
      nodesProcessed++;

      if (cx === target.x && cy === target.y) {
        return path[0]; // Return the first direction in the successful path
      }

      // Order: N, S, E, W (stable determinism)
      const neighbors = [
        { x: cx, y: cy - 1, dir: 'n' },
        { x: cx, y: cy + 1, dir: 's' },
        { x: cx + 1, y: cy, dir: 'e' },
        { x: cx - 1, y: cy, dir: 'w' }
      ];

      for (const n of neighbors) {
        const key = `${n.x},${n.y}`;
        if (!visited.has(key) && this.isWalkable(mapId, n.x, n.y)) {
          visited.add(key);
          queue.push([n.x, n.y, [...path, n.dir]]);
        }
      }
    }

    return null; // No path found within search bounds
  }

  /**
   * Helper to check if a tile is walkable for pathfinding purposes.
   * Logic matches handleMove but without side effects.
   */
  isWalkable(mapId, x, y) {
    const loc = this.worldData[mapId];
    if (!loc) return false;

    // 1. Check Bounds
    if (x < 0 || x >= loc.width || y < 0 || y >= loc.height) return false;

    // 2. Check Static Collisions
    const isWall = (loc.tileOverrides || []).some(t => t.x === x && t.y === y && t.type === 'wall');
    const isScenery = (loc.scenery || []).find(s =>
        x >= s.x && x < s.x + (s.w || 1) &&
        y >= s.y && y < s.y + (s.h || 1)
    );
    if (isWall || isScenery) return false;

    // Note: We don't check dynamic occupants (other players/NPCs) for pathfinding 
    // to keep it stable and avoid jitter, but handleMove will still block them.
    return true;
  }

  dirToKey(dir) {
    return { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' }[dir] || dir;
  }
}
