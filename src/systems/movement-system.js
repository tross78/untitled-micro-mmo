// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { preJoinShard, joinInstance, currentRtcConfig } from '../network/index.js';
import { getCurrentInstance } from '../network/shard.js';
import { myEntry } from '../security/identity.js';
import { shardEnemies, localPlayer, worldState } from '../state/store.js';
import { ITEMS, NPCS } from '../content/data.js';
import { getScatteredContent, getNPCDialogue } from '../rules/index.js';
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
    const entities = this.world.query([Component.Transform, Component.Intent]);

    for (const entityId of entities) {
      const intent = this.world.getComponent(entityId, Component.Intent);
      const transform = this.world.getComponent(entityId, Component.Transform);

      if (intent.action === 'move') {
        this.handleMove(entityId, transform, intent.dir);
        this.world.components.get(Component.Intent).delete(entityId);
      } else if (intent.action === 'interact') {
        this.handleInteract(entityId, transform);
        this.world.components.get(Component.Intent).delete(entityId);
      }
    }
    
    // Proactive Sharding (Step 3 of Phase 7.9.9.4)
    this.processProactiveSharding();
  }

  /**
   * @param {number} entityId
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
      const destId = loc.exits?.[this.dirToKey(dir)];
      if (destId) {
        const destRoom = this.worldData[destId];
        if (!destRoom) return;
        let tx, ty;
        // Preserve the player's position along the edge they crossed
        if (dir === 'n') { ty = destRoom.height - 1; tx = Math.min(transform.x, destRoom.width - 1); }
        else if (dir === 's') { ty = 0; tx = Math.min(transform.x, destRoom.width - 1); }
        else if (dir === 'e') { tx = 0; ty = Math.min(transform.y, destRoom.height - 1); }
        else if (dir === 'w') { tx = destRoom.width - 1; ty = Math.min(transform.y, destRoom.height - 1); }
        else { tx = 0; ty = 0; }
        await this.performTransition(entityId, transform, destId, tx, ty);
      }
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
    const prevLoc = transform.mapId;
    transform.mapId = destId;
    transform.x = tx;
    transform.y = ty;

    // Network Sync
    await joinInstance(destId, getCurrentInstance(), currentRtcConfig);
    const entry = await myEntry();
    if (entry && this.gameActions.sendPresenceSingle) this.gameActions.sendPresenceSingle(entry);
    
    bus.emit('player:move', { from: prevLoc, to: destId });
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
        localPlayer.inventory.push(itemId);
        bus.emit('item:pickup', { item: { name: itemAtFeet.label } });
        bus.emit('log', { msg: `You foraged a ${itemAtFeet.label}!`, color: '#0f0' });
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
      bus.emit('ui:menu', { type: 'npc', context: { npcId, text } });
      return;
    }
    bus.emit('npc:speak', { npcName: NPCS[npcId].name, text });
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

  dirToKey(dir) {
    return { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' }[dir] || dir;
  }
}
