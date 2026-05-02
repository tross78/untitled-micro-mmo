// @ts-check

import { Component } from '../domain/components.js';
import { ACTION } from '../engine/input.js';

/**
 * InputSystem captures user input and attaches Intent components to entities.
 */
export class InputSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {typeof import('../state/eventbus.js').bus} bus - Event bus
   */
  constructor(world, bus) {
    this.world = world;
    this.bus = bus;
    this.pendingIntents = [];

    this.bus.on('input:action', ({ action, type }) => {
      if (type !== 'down') return;
      this.pendingIntents.push(action);
    });
  }

  update() {
    const players = this.world.query([Component.PlayerControlled]);
    if (players.length === 0) return;

    const playerEntityId = players[0];
    
    // Process one intent per tick or all? Usually one per tick for discrete grid movement
    if (this.pendingIntents.length > 0) {
      const action = this.pendingIntents.shift();
      
      const intent = { action: 'idle' };
      
      if ([ACTION.MOVE_N, ACTION.MOVE_S, ACTION.MOVE_E, ACTION.MOVE_W].includes(action)) {
        intent.action = 'move';
        // @ts-ignore
        intent.dir = action.replace('move_', '');
      } else if (action === ACTION.ATTACK) {
        intent.action = 'attack';
      } else if (action === ACTION.INTERACT) {
        intent.action = 'interact';
      } else if (['die', 'flee', 'rest'].includes(action)) {
        intent.action = action;
      }
      
      this.world.setComponent(playerEntityId, Component.Intent, intent);
    }
  }
}
