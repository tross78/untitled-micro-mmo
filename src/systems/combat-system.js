// @ts-check

import { Component } from '../domain/components.js';
import { resolveAttack } from '../rules/index.js';
import { bus } from '../state/eventbus.js';

/**
 * CombatSystem handles attack resolution and damage calculation.
 */
export class CombatSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   */
  constructor(world) {
    this.world = world;
  }

  update() {
    const entities = this.world.query([Component.Intent, Component.Health]);

    for (const entityId of entities) {
      const intent = this.world.getComponent(entityId, Component.Intent);
      
      if (intent.action === 'attack') {
        this.handleAttack(entityId);
        // Intent is cleared by MovementSystem or we can clear it here if movement doesn't run
      }
    }
  }

  /**
   * @param {number} attackerId
   */
  handleAttack(attackerId) {
    const health = this.world.getComponent(attackerId, Component.Health);
    // For now, this is a stub. Real combat logic is complex and stateless in rules/index.js.
    // We'll bridge to the existing stateless resolveAttack logic.
    
    // In a full ECS, we'd query for nearby enemies. 
    // For now, we just emit the legacy 'attack' intent or call handleCommand('attack').
    // But since we want to move logic INTO ECS:
    
    // Legacy bridge:
    // @ts-ignore
    const { handleCommand } = require('../commands/index.js');
    handleCommand('attack');
    
    // Once we have Enemy entities in ECS, we will do:
    // 1. Find target
    // 2. dmg = resolveAttack(atk, def, rng)
    // 3. targetHealth.current -= dmg
    // 4. bus.emit('combat:hit', ...)
  }
}
