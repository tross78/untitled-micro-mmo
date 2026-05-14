// @ts-check

import { Component } from '../domain/components.js';

// Peers within this tile radius get every move; beyond this, throttled to AOI_FAR_INTERVAL_MS.
const AOI_NEAR_RADIUS = 12;
const AOI_FAR_INTERVAL_MS = 500;

/**
 * NetworkSystem bridges ECS state changes to P2P network actions.
 * Standardizes networking to fit within the system pipeline.
 */
export class NetworkSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {any} gameActions - Modular game actions from network/index.js
   * @param {{ localPlayer?: any, players?: Map<string,any> | Iterable<[string, any]> }} [stores]
   */
  constructor(world, gameActions, stores = {}) {
    this.world = world;
    this.gameActions = gameActions;
    this.stores = stores;
    this.lastLocation = null;
    this.lastX = -1;
    this.lastY = -1;
    // peerId -> last time we sent a move to that far peer
    this.farPeerLastSent = new Map();
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
        this._sendWithAoI(transform);
      }
      this.lastX = transform.x;
      this.lastY = transform.y;
      this.lastLocation = transform.mapId;
    }

    // 2. Capture specific intents that need broadcasting (e.g. combat damage)
    // Note: Most combat broadcasting is still handled by legacy handlers for now.
  }

  _sendWithAoI(transform) {
    const packet = {
      from: this.lastLocation || transform.mapId,
      to: transform.mapId,
      x: transform.x,
      y: transform.y
    };

    const remotePlayers = this.stores.players;
    // If we can't do per-peer targeting, broadcast as before
    if (!remotePlayers || !this.gameActions.sendMoveTo) {
      this.gameActions.sendMove(packet);
      return;
    }

    const now = Date.now();
    const nearIds = [];
    const farIds = [];

    for (const [id, peer] of remotePlayers) {
      if (peer.location !== transform.mapId || peer.ghost) continue;
      const dx = (peer.x || 0) - transform.x;
      const dy = (peer.y || 0) - transform.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= AOI_NEAR_RADIUS) {
        nearIds.push(id);
      } else {
        const last = this.farPeerLastSent.get(id) || 0;
        if (now - last >= AOI_FAR_INTERVAL_MS) {
          farIds.push(id);
          this.farPeerLastSent.set(id, now);
        }
      }
    }

    if (nearIds.length > 0) this.gameActions.sendMoveTo(packet, nearIds);
    if (farIds.length > 0) this.gameActions.sendMoveTo(packet, farIds);
    // If no peers yet, fallback broadcast ensures we still announce our move
    if (nearIds.length === 0 && farIds.length === 0) this.gameActions.sendMove(packet);
  }
}
