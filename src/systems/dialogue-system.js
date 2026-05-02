// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';

/**
 * DialogueSystem bridges the legacy dialogue events to ECS components.
 */
export class DialogueSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   */
  constructor(world) {
    this.world = world;

    bus.on('npc:speak', ({ npcName, text }) => {
      const players = this.world.query([Component.PlayerControlled]);
      if (players.length > 0) {
        this.world.setComponent(players[0], Component.Dialogue, {
          text,
          speakerId: npcName,
          progress: 0,
          page: 1
        });
      }
    });

    bus.on('ui:back', () => {
      const players = this.world.query([Component.PlayerControlled]);
      if (players.length > 0) {
        this.world.components.get(Component.Dialogue)?.delete(players[0]);
      }
    });
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const entities = this.world.query([Component.Dialogue]);
    const TYPE_SPEED = 30.0; // chars per second

    for (const entityId of entities) {
      const dialogue = this.world.getComponent(entityId, Component.Dialogue);
      if (!dialogue) continue;

      if (dialogue.progress < dialogue.text.length) {
        dialogue.progress += dt * TYPE_SPEED;
      }
    }
  }
}
