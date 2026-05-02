// @ts-check

import { Component } from '../domain/components.js';

/**
 * TweenSystem processes interpolation progress for smooth movement and animations.
 */
export class TweenSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   */
  constructor(world) {
    this.world = world;
  }

  /**
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    const entities = this.world.query([Component.Tweenable]);
    const TWEEN_SPEED = 10.0; // Complete in ~100ms (1/10s)

    for (const entityId of entities) {
      const tween = this.world.getComponent(entityId, Component.Tweenable);
      if (!tween) continue;

      tween.progress += dt * TWEEN_SPEED;

      if (tween.progress >= 1.0) {
        // Tween complete
        this.world.components.get(Component.Tweenable).delete(entityId);
      }
    }
  }
}
