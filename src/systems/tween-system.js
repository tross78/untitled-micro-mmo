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
    /** Monotonic game time in seconds — set each update from the loop's gameTime */
    this.gameTime = 0;
  }

  /**
   * @param {number} dt - Fixed step delta time in seconds
   */
  update(dt) {
    this.gameTime += dt;

    // 1. Process Movement Tweens — clamp to [0,1] so render never overshoots
    const tweens = this.world.query([Component.Tweenable]);
    const TWEEN_SPEED = 6.0;
    for (const entityId of tweens) {
      const tween = this.world.getComponent(entityId, Component.Tweenable);
      if (!tween) continue;
      tween.progress = Math.min(1.0, tween.progress + dt * (tween.speed || TWEEN_SPEED));
      if (tween.progress >= 1.0) this.world.removeComponent(entityId, Component.Tweenable);
    }

    // 2. Process Collision Bumps — clamp to [0,1]
    const bumps = this.world.query([Component.CollisionBump]);
    const BUMP_SPEED = 20.0;
    for (const entityId of bumps) {
      const bump = this.world.getComponent(entityId, Component.CollisionBump);
      if (!bump) continue;
      bump.progress = Math.min(1.0, bump.progress + dt * BUMP_SPEED);
      if (bump.progress >= 1.0) this.world.removeComponent(entityId, Component.CollisionBump);
    }

    // 3. Process Attack Animations — clamp to [0,1]
    const attacks = this.world.query([Component.AttackAnimation]);
    const ATTACK_SPEED = 12.0;
    for (const entityId of attacks) {
        const anim = this.world.getComponent(entityId, Component.AttackAnimation);
        if (!anim) continue;
        anim.progress = Math.min(1.0, anim.progress + dt * ATTACK_SPEED);
        if (anim.progress >= 1.0) this.world.removeComponent(entityId, Component.AttackAnimation);
    }

    // 4. Process Visual Effects (Hit Flashes) — expire by wall clock (ms timestamp set at creation)
    const now = Date.now();
    const effects = this.world.query([Component.VisualEffect]);
    for (const entityId of effects) {
        const fx = this.world.getComponent(entityId, Component.VisualEffect);
        if (!fx || now > fx.expires) {
            this.world.removeComponent(entityId, Component.VisualEffect);
        }
    }
  }
}
