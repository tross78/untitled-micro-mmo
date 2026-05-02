// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { preJoinShard, joinInstance, currentRtcConfig } from '../network/index.js';
import { getCurrentInstance } from '../network/shard.js';
import { myEntry } from '../security/identity.js';
import { shardEnemies, localPlayer, worldState } from '../state/store.js';
import { ITEMS, NPCS } from '../content/data.js';
import { getNPCsAt } from '../commands/helpers.js';
import { getNPCDialogue } from '../rules/index.js';

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

    // 1. Active Portal Detection (Phase 7.9.9.4)
    const exitTile = (loc.exitTiles || []).find(t => t.x === nx && t.y === ny);
    if (exitTile) {
        await this.performTransition(entityId, transform, exitTile.dest, exitTile.destX, exitTile.destY);
        return;
    }

    // 2. Check Bounds
    if (nx < 0 || nx >= loc.width || ny < 0 || ny >= loc.height) {
      const destId = loc.exits?.[this.dirToKey(dir)];
      if (destId) {
        const destRoom = this.worldData[destId];
        const destExitTile = (destRoom.exitTiles || []).find(t => t.dest === transform.mapId);
        
        let tx = destExitTile?.destX ?? nx;
        let ty = destExitTile?.destY ?? ny;
        
        if (dir === 'n') ty = destRoom.height - 1;
        if (dir === 's') ty = 0;
        if (dir === 'e') tx = 0;
        if (dir === 'w') tx = destRoom.width - 1;

        await this.performTransition(entityId, transform, destId, tx, ty);
      }
      return;
    }

    // 3. Check Static Collisions
    const isWall = (loc.tileOverrides || []).some(t => t.x === nx && t.y === ny && t.type === 'wall');
    const isScenery = (loc.scenery || []).some(s => s.x === nx && s.y === ny);
    if (isWall || isScenery) return;

    // 4. Update Transform
    const oldX = transform.x;
    const oldY = transform.y;
    transform.x = nx;
    transform.y = ny;

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
  handleInteract(entityId, transform) {
    const locId = transform.mapId;
    const loc = this.worldData[locId];
    
    // 1. Check for Portals (Phase 7.9.9.4)
    const exitTile = (loc?.exitTiles || []).find(t => t.x === transform.x && t.y === transform.y);
    if (exitTile) {
        this.performTransition(entityId, transform, exitTile.dest, exitTile.destX, exitTile.destY);
        return;
    }

    // 2. Check for Loot
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
    } else {
        const npcs = getNPCsAt(locId);
        if (npcs.length > 0) {
            const npcId = npcs[0];
            const text = getNPCDialogue(npcId, localPlayer, worldState);
            bus.emit('npc:speak', { npcName: NPCS[npcId].name, text });
        } else {
            bus.emit('log', { msg: `Nothing to pick up.` });
        }
    }
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
