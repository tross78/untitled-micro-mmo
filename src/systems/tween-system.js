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
    const now = Date.now();

    // 1. Process Movement Tweens
    const tweens = this.world.query([Component.Tweenable]);
    const TWEEN_SPEED = 6.0;
    for (const entityId of tweens) {
      const tween = this.world.getComponent(entityId, Component.Tweenable);
      if (!tween) continue;
      tween.progress += dt * (tween.speed || TWEEN_SPEED);
      if (tween.progress >= 1.0) this.world.removeComponent(entityId, Component.Tweenable);
    }

    // 2. Process Collision Bumps
    const bumps = this.world.query([Component.CollisionBump]);
    const BUMP_SPEED = 20.0; // Very fast vibration
    for (const entityId of bumps) {
      const bump = this.world.getComponent(entityId, Component.CollisionBump);
      if (!bump) continue;
      bump.progress += dt * BUMP_SPEED;
      if (bump.progress >= 1.0) this.world.removeComponent(entityId, Component.CollisionBump);
    }

    // 3. Process Attack Animations
    const attacks = this.world.query([Component.AttackAnimation]);
    const ATTACK_SPEED = 12.0; // Complete in ~80ms
    for (const entityId of attacks) {
        const anim = this.world.getComponent(entityId, Component.AttackAnimation);
        if (!anim) continue;
        anim.progress += dt * ATTACK_SPEED;
        if (anim.progress >= 1.0) this.world.removeComponent(entityId, Component.AttackAnimation);
    }

    // 3. Process Visual Effects (Hit Flashes)
    const effects = this.world.query([Component.VisualEffect]);
    for (const entityId of effects) {
        const fx = this.world.getComponent(entityId, Component.VisualEffect);
        if (!fx || now > fx.expires) {
            this.world.removeComponent(entityId, Component.VisualEffect);
        }
    }
  }
}
