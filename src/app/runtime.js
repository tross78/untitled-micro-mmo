// @ts-check

import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { SyncSystem } from './sync-system.js';
import { GameLoop } from './loop.js';
import { InputSystem } from '../systems/input-system.js';
import { MovementSystem } from '../systems/movement-system.js';
import { CombatSystem } from '../systems/combat-system.js';
import { TweenSystem } from '../systems/tween-system.js';
import { DialogueSystem } from '../systems/dialogue-system.js';
import { NetworkSystem } from '../systems/network-system.js';
import { MapRenderSystem } from '../systems/map-render-system.js';
import { EntityRenderSystem } from '../systems/entity-render-system.js';
import { UIRenderSystem } from '../systems/ui-render-system.js';
import { WorldSyncSystem } from '../systems/world-sync-system.js';
import { AudioSystem } from '../systems/audio-system.js';
import { bus } from '../state/eventbus.js';
import { world as worldData, NPCS } from '../content/data.js';
import { worldState, shardEnemies } from '../state/store.js';

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
    /** @type {TweenSystem | null} */
    this.tweenSystem = null;
    /** @type {DialogueSystem | null} */
    this.dialogueSystem = null;
    /** @type {NetworkSystem | null} */
    this.networkSystem = null;

    // Render Systems (Phase 8)
    /** @type {MapRenderSystem | null} */
    this.mapRender = null;
    /** @type {EntityRenderSystem | null} */
    this.entityRender = null;
    /** @type {UIRenderSystem | null} */
    this.uiRender = null;
    /** @type {WorldSyncSystem | null} */
    this.worldSync = null;
    /** @type {AudioSystem | null} */
    this.audioSystem = null;

    // Viewport Config (Responsive Phase 8)
    this.VP = { 
        W: 20, H: 12, S: 48,
        get CW() { return this.W * this.S; }, 
        get CH() { return this.H * this.S; } 
    };

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
   * @param {any} gameActions
   */
  initSystems(localPlayerStore, gameActions) {
    if (!this.playerEntityId) this.hydratePlayer(localPlayerStore);
    
    this.updateViewport();
    window.addEventListener('resize', () => this.updateViewport());

    this.syncSystem = new SyncSystem(this.world, localPlayerStore, this.playerEntityId);
    
    // Lazy access to stores to avoid circularity
    const getPlayers = () => {
        try { return require('../state/store.js').players; } catch (_e) { return new Map(); }
    };

    this.worldSync = new WorldSyncSystem(this.world, { 
        get players() { return getPlayers(); }, 
        shardEnemies, 
        NPCS, 
        localPlayer: localPlayerStore 
    }, worldData);
    this.inputSystem = new InputSystem(this.world, bus);
    this.movementSystem = new MovementSystem(this.world, worldData, gameActions);
    this.combatSystem = new CombatSystem(this.world, { localPlayer: localPlayerStore, worldState, shardEnemies }, gameActions);
    this.tweenSystem = new TweenSystem(this.world);
    this.dialogueSystem = new DialogueSystem(this.world);
    this.networkSystem = new NetworkSystem(this.world, gameActions);

    // Initialize Render Systems
    this.mapRender = new MapRenderSystem(this.world, this.VP);
    this.entityRender = new EntityRenderSystem(this.world, this.VP);
    this.uiRender = new UIRenderSystem(this.world, this.VP);
    this.audioSystem = new AudioSystem(this.world);

    this.loop = new GameLoop({
      fps: 60,
      update: (dt) => this.update(dt),
      render: () => {
          const canvas = document.getElementById('game-canvas');
          if (canvas instanceof HTMLCanvasElement) {
              const ctx = canvas.getContext('2d');
              if (ctx) this.draw(ctx, localPlayerStore);
          }
      },
    });
  }

  updateViewport() {
    const isPortrait = window.innerHeight > window.innerWidth;
    if (isPortrait) {
        this.VP.W = 12;
        this.VP.H = 20;
    } else {
        this.VP.W = 20;
        this.VP.H = 12;
    }
    // Update systems that care about VP
    if (this.mapRender) this.mapRender.VP = this.VP;
    if (this.entityRender) this.entityRender.VP = this.VP;
    if (this.uiRender) this.uiRender.VP = this.VP;

    // Trigger canvas resize
    const canvas = document.getElementById('game-canvas');
    if (canvas instanceof HTMLCanvasElement) {
        canvas.width = this.VP.CW;
        canvas.height = this.VP.CH;
    }
  }

  start() {
    if (this.loop) this.loop.start();
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    // 0. Sync World State to ECS
    if (this.worldSync) this.worldSync.update();

    // 1. Run Game Systems
    if (this.inputSystem) this.inputSystem.update();
    if (this.movementSystem) this.movementSystem.update();
    if (this.combatSystem) this.combatSystem.update();
    if (this.tweenSystem) this.tweenSystem.update(dt);
    if (this.dialogueSystem) this.dialogueSystem.update(dt);
    if (this.networkSystem) this.networkSystem.update();
    if (this.audioSystem) this.audioSystem.update(dt);
    
    // 2. Run Sync System (bridge ECS to canonical state)
    if (this.syncSystem) this.syncSystem.update();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} localPlayerStore
   */
  draw(ctx, localPlayerStore) {
    const transform = this.world.getComponent(this.playerEntityId, Component.Transform);
    const tween = this.world.getComponent(this.playerEntityId, Component.Tweenable);
    if (!transform || !this.mapRender || !this.entityRender || !this.uiRender) return;

    let drawX = transform.x;
    let drawY = transform.y;
    if (tween) {
        drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
        drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
    }

    // Camera follow
    const camX = drawX - (this.VP.W / 2);
    const camY = drawY - (this.VP.H / 2);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    this.mapRender.draw(ctx, { localPlayer: localPlayerStore, worldState, worldData }, camX, camY);
    this.entityRender.draw(ctx, camX, camY);
    this.uiRender.draw(ctx, localPlayerStore);
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
    this.world.setComponent(this.playerEntityId, Component.Sprite, {
      type: 'player',
      palette: 'self',
      seed: 0 // Local player uses standard hero palette
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
