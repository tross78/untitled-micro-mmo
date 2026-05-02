// @ts-check

import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { SyncSystem } from './sync-system.js';
import { GameLoop } from './loop.js';
import { InputSystem } from '../systems/input-system.js';
import { MovementSystem } from '../systems/movement-system.js';
import { CombatSystem } from '../systems/combat-system.js';
import { bus } from '../state/eventbus.js';
import { world as worldData } from '../engine/data.js';

class AppRuntime {
  constructor() {
    this.world = new WorldStore();
    this.playerEntityId = null;
    this.ports = {};
    /** @type {SyncSystem | null} */
    this.syncSystem = null;
    /** @type {InputSystem | null} */
    this.inputSystem = null;
    /** @type {MovementSystem | null} */
    this.movementSystem = null;
    /** @type {CombatSystem | null} */
    this.combatSystem = null;
    /** @type {GameLoop | null} */
    this.loop = null;
  }

  /**
   * @param {import('../domain/ports.js').AppPorts['ports']} ports
   */
  configurePorts(ports) {
    this.ports = { ...this.ports, ...ports };
  }

  /**
   * @param {Record<string, any>} localPlayerStore
   */
  initSystems(localPlayerStore) {
    if (!this.playerEntityId) this.hydratePlayer(localPlayerStore);
    
    this.syncSystem = new SyncSystem(this.world, localPlayerStore, this.playerEntityId);
    this.inputSystem = new InputSystem(this.world, bus);
    this.movementSystem = new MovementSystem(this.world, worldData);
    this.combatSystem = new CombatSystem(this.world);
    
    this.loop = new GameLoop({
      fps: 60,
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });
  }

  start() {
    if (this.loop) this.loop.start();
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    // 1. Run Game Systems
    if (this.inputSystem) this.inputSystem.update();
    if (this.movementSystem) this.movementSystem.update();
    if (this.combatSystem) this.combatSystem.update();
    
    // 2. Run Sync System (bridge ECS to canonical state)
    if (this.syncSystem) this.syncSystem.update();
  }

  render() {
    // Future RenderSystem will go here. For now, we rely on the visual refresh triggers.
  }

  /**
   * Keep canonical save/state data separate from the ECS tables.
   * The ECS layer is a runtime projection for systems and future swaps.
   * @param {Record<string, any>} player
   */
  hydratePlayer(player) {
    if (!this.playerEntityId) {
      this.playerEntityId = this.world.createEntity();
    }
    this.world.setComponent(this.playerEntityId, Component.PlayerControlled, {});
    this.world.setComponent(this.playerEntityId, 'Identity', {
      name: player.name,
      ph: player.ph,
    });
    this.world.setComponent(this.playerEntityId, Component.Transform, {
      mapId: player.location,
      x: player.x,
      y: player.y,
    });
    this.world.setComponent(this.playerEntityId, Component.Health, {
      current: player.hp,
      max: player.maxHp,
    });
    this.world.setComponent(this.playerEntityId, 'Inventory', {
      items: player.inventory || [],
      gold: player.gold || 0,
    });
  }
}

export const appRuntime = new AppRuntime();
