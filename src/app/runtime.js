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
import { PatrolSystem } from '../systems/patrol-system.js';
import { MapRenderSystem } from '../systems/map-render-system.js';
import { EntityRenderSystem } from '../systems/entity-render-system.js';
import { UIRenderSystem } from '../systems/ui-render-system.js';
import { WorldSyncSystem } from '../systems/world-sync-system.js';
import { AudioSystem } from '../systems/audio-system.js';
import { WeatherRenderSystem } from '../systems/weather-render-system.js';
import { bus } from '../state/eventbus.js';
import { world as worldData, NPCS } from '../content/data.js';
import { worldState, shardEnemies } from '../state/store.js';
import { getNPCsAt } from '../commands/helpers.js';

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
    window.addEventListener('orientationchange', () => this.updateViewport());

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
    this.combatSystem = new CombatSystem(this.world, { localPlayer: localPlayerStore, worldState, shardEnemies }, worldData, gameActions);
    this.tweenSystem = new TweenSystem(this.world);
    this.dialogueSystem = new DialogueSystem(this.world);
    this.patrolSystem = new PatrolSystem(this.world);
    this.networkSystem = new NetworkSystem(this.world, gameActions, {
        localPlayer: localPlayerStore,
        get players() { return getPlayers(); }
    });

    // Initialize Render Systems
    this.mapRender = new MapRenderSystem(this.world, this.VP);
    this.entityRender = new EntityRenderSystem(this.world, this.VP);
    this.weatherRender = new WeatherRenderSystem(this.VP);
    this.uiRender = new UIRenderSystem(this.world, this.VP, worldData, { worldState, shardEnemies, getNPCsAt });
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
    const width  = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const isPortrait = height > width;
    const targetW = isPortrait ? 12 : 20;
    const targetH = isPortrait ? 20 : 13;
    const sFromW = Math.floor(width  / targetW);
    const sFromH = Math.floor(height / targetH);
    this.VP.S = Math.max(40, Math.min(72, Math.min(sFromW, sFromH)));
    this.VP.W = Math.floor(width  / this.VP.S);
    this.VP.H = Math.floor(height / this.VP.S);

    if (this.mapRender) this.mapRender.VP = this.VP;
    if (this.entityRender) this.entityRender.VP = this.VP;
    if (this.weatherRender) this.weatherRender.VP = this.VP;
    if (this.uiRender) this.uiRender.VP = this.VP;

    const canvas = document.getElementById('game-canvas');
    if (canvas instanceof HTMLCanvasElement) {
        if (canvas.width !== this.VP.CW) canvas.width = this.VP.CW;
        if (canvas.height !== this.VP.CH) canvas.height = this.VP.CH;
    }
  }

  start() {
    if (this.loop) this.loop.start();

    // Flush OffscreenCanvas caches when the tab comes back into view.
    // Browsers can lose/GC offscreen canvas contexts while the tab is hidden,
    // causing drawImage() to silently produce nothing on the next paint.
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        if (this.mapRender) this.mapRender.invalidate();
        if (this.entityRender) this.entityRender.invalidate();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    // 0. Sync World State to ECS
    if (this.worldSync) this.worldSync.update();
    if (this.patrolSystem) this.patrolSystem.update();

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
    const room = worldData[transform.mapId];
    if (!room) return;

    let drawX = transform.x;
    let drawY = transform.y;
    if (tween) {
        drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
        drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
    }

    const { camX, camY, screenOffsetX, screenOffsetY } = this.getViewportTransform(drawX, drawY, transform.mapId);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.mapRender.draw(ctx, { localPlayer: localPlayerStore, worldState, worldData }, camX, camY, screenOffsetX, screenOffsetY);
    this.entityRender.draw(ctx, camX, camY, screenOffsetX, screenOffsetY);
    if (this.weatherRender) this.weatherRender.draw(ctx, worldState, transform.mapId);
    this.uiRender.draw(ctx, localPlayerStore);
  }

  getViewportTransform(drawX, drawY, mapId) {
    const room = worldData[mapId];
    if (!room) return { camX: 0, camY: 0, screenOffsetX: 0, screenOffsetY: 0 };

    const roomFitsX = room.width <= this.VP.W;
    const roomFitsY = room.height <= this.VP.H;

    const camX = roomFitsX
      ? 0
      : Math.max(0, Math.min(room.width - this.VP.W, drawX - (this.VP.W / 2)));

    const camY = roomFitsY
      ? 0
      : Math.max(0, Math.min(room.height - this.VP.H, drawY - (this.VP.H / 2)));

    const screenOffsetX = roomFitsX ? Math.floor(((this.VP.W - room.width) * this.VP.S) / 2) : 0;
    const screenOffsetY = roomFitsY ? Math.floor(((this.VP.H - room.height) * this.VP.S) / 2) : 0;

    return { camX, camY, screenOffsetX, screenOffsetY };
  }

  getCamera(drawX, drawY, mapId) {
    const { camX, camY } = this.getViewportTransform(drawX, drawY, mapId);
    return { camX, camY };
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
    this.world.removeComponent(this.playerEntityId, Component.Menu);
    this.world.removeComponent(this.playerEntityId, Component.Dialogue);
    this.world.setComponent(this.playerEntityId, 'Identity', {
      name: player.name,
      ph: player.ph,
    });
    this.world.setComponent(this.playerEntityId, Component.Transform, {
      mapId: player.location,
      x: player.x,
      y: player.y,
      facing: 's'
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
