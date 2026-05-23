import { jest } from '@jest/globals';
import {
    getArbiterUrl,
    normalizeArbiterUrl,
    setResolvedArbiterUrl,
} from '../infra/runtime.js';
import { appRuntime } from '../app/runtime.js';
import { WorldStore } from '../domain/ecs.js';
import { WorldSyncSystem } from '../systems/world-sync-system.js';
import { Component } from '../domain/components.js';

describe('runtime bootstrap resolution', () => {
    beforeEach(() => {
        localStorage.clear();
        setResolvedArbiterUrl('');
        jest.restoreAllMocks();
        global.fetch = jest.fn();
    });

    test('getArbiterUrl prefers stored resolved arbiter url', () => {
        setResolvedArbiterUrl('https://arbiter.tysonross.com/');
        expect(getArbiterUrl('')).toBe('https://arbiter.tysonross.com');
    });

    test('normalizeArbiterUrl accepts domain shorthand and strips trailing slashes', () => {
        expect(normalizeArbiterUrl('arbiter.tysonross.com/')).toBe('https://arbiter.tysonross.com');
        expect(normalizeArbiterUrl('localhost:3000/')).toBe('http://localhost:3000');
        expect(normalizeArbiterUrl('https://arbiter.tysonross.com/api/')).toBe('https://arbiter.tysonross.com/api');
        expect(normalizeArbiterUrl('javascript:alert(1)')).toBe('');
    });

    test('getArbiterUrl accepts explicitly configured future arbiter endpoints', () => {
        localStorage.setItem('fenhollow_arbiter_url', 'arbiter.tysonross.com/');
        expect(getArbiterUrl('')).toBe('https://arbiter.tysonross.com');
    });

    test('getArbiterUrl ignores invalid fallback values', () => {
        expect(getArbiterUrl('fallback')).toBe('');
    });
});

describe('viewport sizing on mobile layouts', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('updateViewport uses portrait sizing on narrow screens', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockImplementation((id) => (id === 'game-canvas' ? canvas : null));
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 });

        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();

        expect(appRuntime.VP.S).toBe(50);
        expect(appRuntime.VP.W).toBe(12);
        expect(appRuntime.VP.H).toBe(24);
        expect(canvas.width).toBe(appRuntime.VP.CW);
        expect(canvas.height).toBe(appRuntime.VP.CH);
    });

    test('updateViewport uses landscape sizing on wide screens', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockImplementation((id) => (id === 'game-canvas' ? canvas : null));
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();

        expect(appRuntime.VP.S).toBe(46);
        expect(appRuntime.VP.W).toBe(26);
        expect(appRuntime.VP.H).toBe(13);
        expect(canvas.width).toBe(appRuntime.VP.CW);
        expect(canvas.height).toBe(appRuntime.VP.CH);
    });

    test('world viewport reserves space for top and bottom chrome', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();

        const worldVP = appRuntime.getWorldViewport();
        expect(worldVP.H).toBeLessThan(appRuntime.VP.H);
        expect(worldVP.topChrome).toBeGreaterThan(0);
        expect(worldVP.bottomChrome).toBeGreaterThan(0);
    });
});

describe('updateViewport invalidates render caches on tile scale change', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('invalidates map and entity caches when VP.S changes', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockReturnValue(canvas);

        const mapInvalidate = jest.fn();
        const entityInvalidate = jest.fn();
        appRuntime.mapRender = { VP: appRuntime.VP, invalidate: mapInvalidate };
        appRuntime.entityRender = { VP: appRuntime.VP, invalidate: entityInvalidate };
        appRuntime.weatherRender = null;
        appRuntime.uiRender = null;

        // Force a scale change: set VP.S to a known value first
        appRuntime.VP.S = 40;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });

        appRuntime.updateViewport();

        // At 1440×900 landscape: sFromW=72, sFromH=69 → VP.S=69, which differs from 40
        expect(appRuntime.VP.S).toBe(69);
        expect(mapInvalidate).toHaveBeenCalled();
        expect(entityInvalidate).toHaveBeenCalled();
    });

    test('does not invalidate caches when VP.S is unchanged', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockReturnValue(canvas);

        // Two identical calls — VP.S should not change on the second
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.weatherRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();
        const s = appRuntime.VP.S;

        const mapInvalidate = jest.fn();
        const entityInvalidate = jest.fn();
        appRuntime.mapRender = { VP: appRuntime.VP, invalidate: mapInvalidate };
        appRuntime.entityRender = { VP: appRuntime.VP, invalidate: entityInvalidate };

        appRuntime.updateViewport(); // same dimensions → same VP.S
        expect(appRuntime.VP.S).toBe(s);
        expect(mapInvalidate).not.toHaveBeenCalled();
        expect(entityInvalidate).not.toHaveBeenCalled();
    });
});

describe('transition fade timing', () => {
    test('_startFade initializes with null startTime', () => {
        appRuntime._startFade();
        expect(appRuntime._transition.startTime).toBeNull();
        expect(appRuntime._transition.phase).toBe('out');
        expect(appRuntime._transition.alpha).toBe(0);
    });

    test('_drawTransitionFade advances alpha using gameTime, not frame count', () => {
        const ctx = { fillStyle: '', fillRect: jest.fn() };
        appRuntime._startFade();

        // First call at gameTime=0 seeds startTime; alpha = 0
        appRuntime._drawTransitionFade(ctx, 0);
        expect(appRuntime._transition.alpha).toBe(0);

        // Half-way through the 200ms fade
        appRuntime._drawTransitionFade(ctx, 0.1);
        expect(appRuntime._transition.alpha).toBeCloseTo(0.5, 1);

        // Full fade at 200ms
        appRuntime._drawTransitionFade(ctx, 0.2);
        expect(appRuntime._transition.alpha).toBeCloseTo(1, 5);
    });

    test('_drawTransitionFade fades in after _endFade is called', () => {
        const ctx = { fillStyle: '', fillRect: jest.fn() };
        appRuntime._startFade();

        // Complete the fade-out at gameTime 0 → 0.2
        appRuntime._drawTransitionFade(ctx, 0);
        appRuntime._drawTransitionFade(ctx, 0.2);
        expect(appRuntime._transition.alpha).toBeCloseTo(1, 5);

        // Switch to fade-in; startTime resets on first call
        appRuntime._endFade();
        appRuntime._drawTransitionFade(ctx, 0.2); // seeds fade-in startTime=0.2, elapsed=0, alpha=1
        appRuntime._drawTransitionFade(ctx, 0.3); // 100ms in → alpha ~0.5
        expect(appRuntime._transition.alpha).toBeCloseTo(0.5, 1);

        appRuntime._drawTransitionFade(ctx, 0.4); // 200ms in → fade complete
        expect(appRuntime._transition.active).toBe(false);
    });

    test('fade does not advance when inactive', () => {
        const ctx = { fillStyle: '', fillRect: jest.fn() };
        appRuntime._transition = { active: false, phase: 'idle', alpha: 0, startTime: null };
        appRuntime._drawTransitionFade(ctx, 100);
        expect(ctx.fillRect).not.toHaveBeenCalled();
    });
});

describe('enemy world sync patrol stability', () => {
    test('world sync projects arbiter snapshot ghosts as stale peer sprites', () => {
        const world = new WorldStore();
        const stores = {
            localPlayer: { location: 'cellar' },
            shardEnemies: new Map(),
            NPCS: {},
            players: new Map([['ghost:feed0001', {
                ghost: true,
                name: 'Safari Peer',
                location: 'cellar',
                x: 6,
                y: 5,
                hp: 10,
                maxHp: 10,
            }]])
        };
        const worldData = {
            cellar: { width: 10, height: 10, staticEntities: [] }
        };
        const system = new WorldSyncSystem(world, stores, worldData);

        system.update();

        const peerId = system.entityMap.get('ghost:feed0001');
        expect(peerId).toBeTruthy();
        expect(world.getComponent(peerId, Component.Sprite)).toMatchObject({
            type: 'peer',
            palette: 'peer',
            stale: true,
            ghost: true,
        });
        expect(world.getComponent(peerId, Component.Transform)).toMatchObject({
            mapId: 'cellar',
            x: 6,
            y: 5,
        });
        expect(world.getComponent(peerId, 'Identity')).toMatchObject({
            name: 'Safari Peer',
            id: 'ghost:feed0001',
        });
    });

    test('world sync does not reset an existing enemy transform every update', () => {
        const world = new WorldStore();
        const stores = {
            localPlayer: { location: 'forest_depths' },
            shardEnemies: new Map([['forest_depths', { hp: 10 }]]),
            NPCS: {},
            players: new Map()
        };
        const worldData = {
            forest_depths: { width: 25, height: 25, enemy: 'goblin', enemyX: 5, enemyY: 5 }
        };
        const system = new WorldSyncSystem(world, stores, worldData);

        system.update();
        const enemyId = system.entityMap.get('enemy_forest_depths');
        const firstTransform = world.getComponent(enemyId, Component.Transform);
        firstTransform.x = 7;
        firstTransform.y = 8;

        system.update();
        const secondTransform = world.getComponent(enemyId, Component.Transform);
        expect(secondTransform.x).toBe(7);
        expect(secondTransform.y).toBe(8);
    });

    test('world sync moves blocked enemy spawns to a safe tile', () => {
        const world = new WorldStore();
        const stores = {
            localPlayer: { location: 'blocked_room' },
            shardEnemies: new Map([['blocked_room', { hp: 10 }]]),
            NPCS: {},
            players: new Map()
        };
        const worldData = {
            blocked_room: {
                width: 11,
                height: 11,
                enemy: 'mountain_troll',
                enemyX: 5,
                enemyY: 5,
                tileOverrides: [{ x: 5, y: 5, type: 'wall' }],
                scenery: [],
            }
        };
        const system = new WorldSyncSystem(world, stores, worldData);

        system.update();

        const enemyId = system.entityMap.get('enemy_blocked_room');
        const transform = world.getComponent(enemyId, Component.Transform);
        expect(transform.x === 5 && transform.y === 5).toBe(false);
        expect(transform.x).toBeGreaterThanOrEqual(0);
        expect(transform.y).toBeGreaterThanOrEqual(0);
        expect(transform.x).toBeLessThan(worldData.blocked_room.width);
        expect(transform.y).toBeLessThan(worldData.blocked_room.height);
    });
});
