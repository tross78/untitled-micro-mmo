// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { QUESTS } from '../content/data.js';

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

        if (oldLoc !== transform.mapId) {
          Object.entries(this.localPlayer.quests || {}).forEach(([qid, progress]) => {
            const quest = QUESTS[qid];
            if (!quest || progress.completed) return;
            if (quest.type !== 'explore' || quest.objective?.target !== transform.mapId) return;
            const nextProgress = Math.max(progress.progress || 0, quest.objective?.count || 1);
            if (nextProgress !== progress.progress) {
              progress.progress = nextProgress;
              bus.emit('quest:progress', {
                name: quest.name,
                current: progress.progress,
                total: quest.objective?.count || 1
              });
            }
          });

          bus.emit('player:move', {
            from: oldLoc,
            to: transform.mapId
          });
        } else {
          bus.emit('player:step', {
            mapId: transform.mapId,
            from: { x: oldX, y: oldY },
            to: { x: transform.x, y: transform.y }
          });
        }
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
