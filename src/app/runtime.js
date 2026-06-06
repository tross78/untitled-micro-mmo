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
import { LightingRenderSystem } from '../systems/lighting-render-system.js';
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

    // Transition fade overlay state
    this._transition = { active: false, phase: 'idle', alpha: 0 };

    // Cached canvas element (set in initSystems)
    this._canvas = null;

    // Cached chrome heights — recomputed only in updateViewport()
    this._topChrome = 0;
    this._bottomChrome = 0;

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
    this._resizeHandler = () => this.updateViewport();
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('orientationchange', this._resizeHandler);

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
    this.movementSystem = new MovementSystem(this.world, worldData, gameActions, {
        onTransitionStart: () => this._startFade(),
        onTransitionEnd:   () => this._endFade(),
    });
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
    this.lightingRender = new LightingRenderSystem(this.VP);
    this.uiRender = new UIRenderSystem(this.world, this.VP, worldData, { worldState, shardEnemies, getNPCsAt, get players() { return getPlayers(); } });
    this.audioSystem = new AudioSystem(this.world);

    this._canvas = document.getElementById('game-canvas');

    // Cache the 2D context once — getContext is a DOM call, not free on every frame
    this._ctx = null;

    this.loop = new GameLoop({
      fps: 60,
      update: (dt) => this.update(dt),
      render: (gameTime) => {
          if (!this._canvas) this._canvas = document.getElementById('game-canvas');
          if (this._canvas instanceof HTMLCanvasElement) {
              if (!this._ctx) this._ctx = this._canvas.getContext('2d');
              if (this._ctx) this.draw(this._ctx, localPlayerStore, gameTime);
          }
      },
    });
  }

  updateViewport() {
    const prevS = this.VP.S;
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

    // Cache chrome heights — these only change on resize
    this._topChrome = this.getTopChromeHeight();
    this._bottomChrome = this.getBottomChromeHeight();

    if (this.mapRender) this.mapRender.VP = this.VP;
    if (this.entityRender) this.entityRender.VP = this.VP;
    if (this.weatherRender) this.weatherRender.VP = this.VP;
    if (this.lightingRender) this.lightingRender.VP = this.VP;
    if (this.uiRender) this.uiRender.VP = this.VP;

    // Tile and sprite caches are built at a specific VP.S. Invalidate when scale changes
    // so the next frame rebuilds them at the new tile size rather than blitting stale data.
    if (this.VP.S !== prevS) {
        if (this.mapRender) this.mapRender.invalidate();
        if (this.entityRender) this.entityRender.invalidate();
    }

    const canvas = document.getElementById('game-canvas');
    if (canvas instanceof HTMLCanvasElement) {
        if (canvas.width !== this.VP.CW) { canvas.width = this.VP.CW; this._ctx = null; }
        if (canvas.height !== this.VP.CH) { canvas.height = this.VP.CH; this._ctx = null; }
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
   * @param {number} gameTime - Monotonic game time in seconds (from GameLoop)
   */
  draw(ctx, localPlayerStore, gameTime = 0) {
    const transform = this.world.getComponent(this.playerEntityId, Component.Transform);
    const tween = this.world.getComponent(this.playerEntityId, Component.Tweenable);
    if (!transform || !this.mapRender || !this.entityRender || !this.uiRender) return;
    const room = worldData[transform.mapId];
    if (!room) return;

    let drawX = transform.x;
    let drawY = transform.y;
    if (tween) {
        const t = 1 - (1 - tween.progress) * (1 - tween.progress); // ease-out quad, matches entity render
        drawX = tween.startX + (tween.targetX - tween.startX) * t;
        drawY = tween.startY + (tween.targetY - tween.startY) * t;
    }

    const { camX, camY, screenOffsetX, screenOffsetY, worldVP } = this.getViewportTransform(drawX, drawY, transform.mapId);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, worldVP.topChrome, this.VP.CW, worldVP.worldPxH);
    ctx.clip();

    if (this.mapRender) this.mapRender.VP = worldVP;
    if (this.entityRender) this.entityRender.VP = worldVP;
    if (this.weatherRender) this.weatherRender.VP = worldVP;
    if (this.lightingRender) this.lightingRender.VP = worldVP;
    try {
        this.mapRender.draw(ctx, { localPlayer: localPlayerStore, worldState, worldData }, camX, camY, screenOffsetX, screenOffsetY, gameTime);
        this.entityRender.draw(ctx, camX, camY, screenOffsetX, screenOffsetY, gameTime);
        if (this.weatherRender) this.weatherRender.draw(ctx, worldState, transform.mapId, gameTime);
        if (this.lightingRender) this.lightingRender.draw(ctx, transform.mapId, camX, camY, screenOffsetX, screenOffsetY, gameTime);
    } finally {
        if (this.mapRender) this.mapRender.VP = this.VP;
        if (this.entityRender) this.entityRender.VP = this.VP;
        if (this.weatherRender) this.weatherRender.VP = this.VP;
        if (this.lightingRender) this.lightingRender.VP = this.VP;
        ctx.restore();
    }

    this.uiRender.draw(ctx, localPlayerStore);
    this._drawTransitionFade(ctx, gameTime);
  }

  getTopChromeHeight() {
    const topBar = Math.max(56, Math.floor(this.VP.S * 1.35));
    const ticker = Math.max(18, Math.floor(this.VP.S * 0.38));
    return topBar + ticker;
  }

  getBottomChromeHeight() {
    return Math.max(64, Math.floor(this.VP.S * 1.7));
  }

  getWorldViewport() {
    const topChrome = this._topChrome || this.getTopChromeHeight();
    const bottomChrome = this._bottomChrome || this.getBottomChromeHeight();
    const worldPxH = Math.max(this.VP.S * 4, this.VP.CH - topChrome - bottomChrome);
    const worldRows = Math.max(4, Math.ceil(worldPxH / this.VP.S));
    return {
      W: this.VP.W,
      H: worldRows,
      S: this.VP.S,
      CW: this.VP.CW,
      CH: worldRows * this.VP.S,
      topChrome,
      bottomChrome,
      worldPxH,
    };
  }

  _startFade() {
    this._transition = { active: true, phase: 'out', alpha: 0, startTime: null };
  }

  _endFade() {
    this._transition.phase = 'in';
    this._transition.startTime = null;
  }

  _drawTransitionFade(ctx, gameTime = 0) {
    const t = this._transition;
    if (!t.active) return;
    const FADE_DURATION = 0.2; // 200ms in game-time seconds
    if (t.startTime == null) t.startTime = gameTime;
    const elapsed = gameTime - t.startTime;
    if (t.phase === 'out') {
        t.alpha = Math.min(1, elapsed / FADE_DURATION);
    } else if (t.phase === 'in') {
        t.alpha = Math.max(0, 1 - elapsed / FADE_DURATION);
        if (t.alpha === 0) t.active = false;
    }
    if (t.alpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${t.alpha})`;
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);
    }
  }

  getViewportTransform(drawX, drawY, mapId) {
    const room = worldData[mapId];
    const worldVP = this.getWorldViewport();
    if (!room) return { camX: 0, camY: 0, screenOffsetX: 0, screenOffsetY: worldVP.topChrome, worldVP };

    const roomFitsX = room.width <= worldVP.W;
    const roomFitsY = room.height <= worldVP.H;

    const camX = roomFitsX
      ? 0
      : Math.max(0, Math.min(room.width - worldVP.W, drawX - (worldVP.W / 2)));

    const camY = roomFitsY
      ? 0
      : Math.max(0, Math.min(room.height - worldVP.H, drawY - (worldVP.H / 2)));

    const screenOffsetX = roomFitsX ? Math.floor(((worldVP.W - room.width) * worldVP.S) / 2) : 0;
    const screenOffsetY = worldVP.topChrome + (roomFitsY ? Math.floor(((worldVP.H - room.height) * worldVP.S) / 2) : 0);

    return { camX, camY, screenOffsetX, screenOffsetY, worldVP };
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
    this.world.removeComponent(this.playerEntityId, Component.Tweenable);
    this.world.removeComponent(this.playerEntityId, Component.CollisionBump);
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
