import { MapRenderSystem } from '../systems/map-render-system.js';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { world as gameWorld } from '../content/data.js';

// Provide a mock OffscreenCanvas so rebuildCache doesn't fail
const makeOffscreenCtx = () => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    arcTo: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    closePath: jest.fn(),
    clip: jest.fn(),
    rect: jest.fn(),
    measureText: jest.fn(() => ({ width: 50 })),
    fillText: jest.fn(),
    createImageData: jest.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: jest.fn(),
    getImageData: jest.fn((x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
});

const makeCtx = makeOffscreenCtx;

let _offCtxStore = null;
const MockOffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; _offCtxStore = makeOffscreenCtx(); this._ctx = _offCtxStore; }
    getContext(type) { return type === '2d' ? this._ctx : null; }
};

const VP = { W: 10, H: 10, S: 16, CW: 160, CH: 160 };

const makeState = (locationId = 'cellar') => ({
    localPlayer: { location: locationId, x: 5, y: 5 },
    worldState: { day: 1, weather: 'clear', season: 'spring', threatLevel: 0, event: null },
    worldData: gameWorld,
});

describe('MapRenderSystem', () => {
    let world;
    let system;
    let ctx;

    beforeAll(() => {
        global.OffscreenCanvas = MockOffscreenCanvas;
    });

    beforeEach(() => {
        world = new WorldStore();
        system = new MapRenderSystem(world, { ...VP });
        ctx = makeCtx();
    });

    test('constructor sets up null caches', () => {
        expect(system.tileCache).toBeNull();
        expect(system._scatterCache).toBeNull();
    });

    test('invalidate clears caches', () => {
        system.tileCache = { locKey: 'x', canvas: {} };
        system._scatterCache = {};
        system.invalidate();
        expect(system.tileCache).toBeNull();
        expect(system._scatterCache).toBeNull();
    });

    test('draw does not throw for a valid room', () => {
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0)).not.toThrow();
    });

    test('draw returns early for unknown location', () => {
        expect(() => system.draw(ctx, makeState('__nowhere__'), 0, 0)).not.toThrow();
        expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    test('draw builds tile cache on first call', () => {
        system.draw(ctx, makeState('cellar'), 0, 0);
        expect(system.tileCache).not.toBeNull();
        expect(system.tileCache.locKey).toContain('cellar');
    });

    test('draw reuses tile cache on second call with same state', () => {
        const state = makeState('cellar');
        system.draw(ctx, state, 0, 0);
        const firstCache = system.tileCache;
        system.draw(ctx, state, 0, 0);
        expect(system.tileCache).toBe(firstCache);
    });

    test('draw rebuilds cache when location changes', () => {
        system.draw(ctx, makeState('cellar'), 0, 0);
        const firstCache = system.tileCache;
        system.draw(ctx, makeState('hallway'), 0, 0);
        expect(system.tileCache).not.toBe(firstCache);
    });

    test('draw renders scenery from room definition', () => {
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0)).not.toThrow();
        // cellar has barrels and crates — drawImage should be called for scenery
        expect(ctx.drawImage).toHaveBeenCalled();
    });

    test('draw renders exit tiles', () => {
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0)).not.toThrow();
    });

    test('draw renders movement target ring when entity has MovementTarget', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 3, y: 3 });
        world.setComponent(eid, Component.MovementTarget, { x: 4, y: 4 });
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0, 0, 0, 0)).not.toThrow();
        expect(ctx.arc).toHaveBeenCalled();
    });

    test('draw renders TapPulse affordance', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.TapPulse, { x: 3, y: 3, expiresAt: Date.now() + 500 });
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0, 0, 0, 0)).not.toThrow();
    });

    test('draw cleans up expired TapPulse', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.TapPulse, { x: 3, y: 3, expiresAt: Date.now() - 1 });
        expect(() => system.draw(ctx, makeState('cellar'), 0, 0, 0, 0, 0)).not.toThrow();
        expect(world.getComponent(eid, Component.TapPulse)).toBeUndefined();
    });

    test('drawExitArrow covers all cardinal directions', () => {
        const loc = { width: 10, height: 10 };
        const exits = [
            { x: 4, y: 0, w: 2, h: 1 },        // north
            { x: 4, y: 9, w: 2, h: 1 },         // south
            { x: 0, y: 4, w: 1, h: 2 },         // west
            { x: 9, y: 4, w: 1, h: 2 },         // east
            { x: 4, y: 4, w: 1, h: 1 },         // middle (no direction)
        ];
        exits.forEach(ex => {
            expect(() => system.drawExitArrow(ctx, ex, loc, ex.x, ex.y, 0, 0, 0.5)).not.toThrow();
        });
        expect(ctx.stroke).toHaveBeenCalled();
    });

    test('drawScenery does not throw for known labels', () => {
        const labels = ['barrel', 'crate', 'tree', 'torch', 'pillar', 'stairs', 'bookshelf'];
        labels.forEach(label => {
            expect(() => system.drawScenery(ctx, 0, 0, label, 0, 0, 1, 1, 0, 0, 0)).not.toThrow();
        });
    });

    test('draw works for multiple rooms', () => {
        const rooms = ['cellar', 'hallway', 'tavern', 'market'];
        const existingRooms = rooms.filter(room => gameWorld[room]);
        expect(existingRooms).toHaveLength(rooms.length);
        existingRooms.forEach(room => {
            expect(() => system.draw(ctx, makeState(room), 0, 0)).not.toThrow();
        });
    });

    test('cache key includes VP.S so tile size changes trigger a rebuild', () => {
        const state = makeState('cellar');
        system.draw(ctx, state, 0, 0);
        const firstCache = system.tileCache;
        // Simulate a window resize that changes tile scale
        system.VP = { ...VP, S: VP.S * 2, CW: VP.W * VP.S * 2, CH: VP.H * VP.S * 2 };
        system.draw(ctx, state, 0, 0);
        // Cache key changed because VP.S is embedded — must rebuild
        expect(system.tileCache).not.toBe(firstCache);
        expect(system.tileCache.locKey).toContain(String(VP.S * 2));
    });

    test('invalidate followed by draw rebuilds cache even with same location/day', () => {
        const state = makeState('cellar');
        system.draw(ctx, state, 0, 0);
        const firstCache = system.tileCache;
        system.invalidate();
        system.draw(ctx, state, 0, 0);
        // Cache object reference should differ after invalidation
        expect(system.tileCache).not.toBe(firstCache);
    });
});
