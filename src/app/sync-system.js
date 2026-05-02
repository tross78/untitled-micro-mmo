// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';

/**
 * SyncSystem bridges the ECS runtime state back to the canonical stores
 * (localPlayer, worldState) to ensure networking and persistence remain consistent.
 */
export class SyncSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {Record<string, any>} localPlayer - Canonical localPlayer store
   * @param {number} playerEntityId
   */
  constructor(world, localPlayer, playerEntityId) {
    this.world = world;
    this.localPlayer = localPlayer;
    this.playerEntityId = playerEntityId;
  }

  update() {
    // 1. Sync Transform -> localPlayer location/coordinates
    const transform = this.world.getComponent(this.playerEntityId, Component.Transform);
    if (transform) {
      // @ts-ignore
      const oldLoc = this.localPlayer.location;
      const oldX = this.localPlayer.x;
      const oldY = this.localPlayer.y;

      if (oldX !== transform.x || oldY !== transform.y || oldLoc !== transform.mapId) {
        this.localPlayer.x = transform.x;
        this.localPlayer.y = transform.y;
        this.localPlayer.location = transform.mapId;
        
        // Emit legacy event for UI and Networking
        bus.emit('player:move', { 
            from: oldLoc, 
            to: transform.mapId,
            x: transform.x,
            y: transform.y
        });
      }
    }

    // 2. Sync Health -> localPlayer hp
    const health = this.world.getComponent(this.playerEntityId, Component.Health);
    if (health) {
      // @ts-ignore
      if (this.localPlayer.hp !== health.current || this.localPlayer.maxHp !== health.max) {
        this.localPlayer.hp = health.current;
        this.localPlayer.maxHp = health.max;
        // Legacy UI often watches localPlayer directly or relies on logical refresh
      }
    }
  }
}
