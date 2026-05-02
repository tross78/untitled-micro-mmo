// @ts-check

import { Component } from '../domain/components.js';

/**
 * NetworkSystem bridges ECS state changes to P2P network actions.
 * Standardizes networking to fit within the system pipeline.
 */
export class NetworkSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {any} gameActions - Modular game actions from network/index.js
   */
  constructor(world, gameActions) {
    this.world = world;
    this.gameActions = gameActions;
    this.lastLocation = null;
    this.lastX = -1;
    this.lastY = -1;
  }

  update() {
    const players = this.world.query([Component.PlayerControlled, Component.Transform]);
    if (players.length === 0) return;

    const playerId = players[0];
    const transform = this.world.getComponent(playerId, Component.Transform);
    if (!transform) return;

    // 1. Sync Movement to Network
    if (transform.x !== this.lastX || transform.y !== this.lastY || transform.mapId !== this.lastLocation) {
      if (this.gameActions.sendMove) {
        this.gameActions.sendMove({
          from: this.lastLocation || transform.mapId,
          to: transform.mapId,
          x: transform.x,
          y: transform.y
        });
      }
      this.lastX = transform.x;
      this.lastY = transform.y;
      this.lastLocation = transform.mapId;
    }

    // 2. Capture specific intents that need broadcasting (e.g. combat damage)
    // Note: Most combat broadcasting is still handled by legacy handlers for now.
  }
}
