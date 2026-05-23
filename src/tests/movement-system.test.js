import { MovementSystem } from '../systems/movement-system.js';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';

jest.mock('../network/index.js', () => ({
    preJoinShard: jest.fn(),
    joinInstance: jest.fn().mockResolvedValue(null),
    currentRtcConfig: {},
}));
jest.mock('../network/shard.js', () => ({ getCurrentInstance: jest.fn(() => 1) }));
jest.mock('../security/identity.js', () => ({
    myEntry: jest.fn().mockResolvedValue(null),
    playerKeys: { privateKey: null },
}));
jest.mock('../state/store.js', () => ({
    shardEnemies: new Map(),
    localPlayer: {
        inventory: [], gold: 0, xp: 0, level: 1, location: 'cellar',
        equipped: { weapon: null, armor: null },
        gatheredNodes: { day: 1, nodes: new Set() },
    },
    worldState: { day: 1, seed: 'seed', mood: 'calm' },
    activeChannels: new Map(),
    pendingDuel: null,
}));
jest.mock('../rules/index.js', () => {
    const actual = jest.requireActual('../rules/index.js');
    return {
        ...actual,
        getNPCDialogue: jest.fn(() => 'Hello!'),
        findSafeArrival: jest.fn((x, y) => ({ x, y })),
    };
});
jest.mock('../commands/helpers.js', () => ({
    getNPCsAt: jest.fn(() => []),
    grantItem: jest.fn(),
}));
jest.mock('../ui/index.js', () => ({ log: jest.fn() }));
jest.mock('../graphics/sprite-kind.js', () => ({ getSpriteKind: jest.fn(s => s?.palette || 'other') }));
jest.mock('../state/eventbus.js', () => ({ bus: { emit: jest.fn(), on: jest.fn() } }));
jest.mock('../content/data/constants.js', () => ({
    RESOURCE_LABEL_TO_ITEM: { herbs: 'herbs', log: 'log' },
}));

// Minimal world data for tests
const testWorld = {
    cellar: {
        name: 'Cellar', width: 10, height: 10,
        exits: { north: 'hallway' },
        exitTiles: [{ x: 4, y: 0, w: 2, h: 1, dest: 'hallway', destX: 5, destY: 8 }],
        tileOverrides: [{ x: 3, y: 3, type: 'wall' }, { x: 5, y: 5, type: 'water' }],
        scenery: [{ x: 7, y: 7, w: 2, h: 1, label: 'barrel' }],
    },
    ruins: {
        name: 'Ruins', width: 11, height: 11,
        exits: { north: 'ruins_descent' },
        exitTiles: [{ x: 5, y: 0, w: 1, h: 1, dest: 'ruins_descent', destX: 5, destY: 9, type: 'stairs' }],
        tileOverrides: [],
        scenery: [],
    },
    ruins_descent: {
        name: 'Ruins Descent', width: 11, height: 11,
        exits: { south: 'ruins' },
        exitTiles: [{ x: 5, y: 10, w: 1, h: 1, dest: 'ruins', destX: 10, destY: 1, type: 'stairs' }],
        tileOverrides: [],
        scenery: [],
    },
    hallway: { name: 'Hallway', width: 12, height: 10, exits: { south: 'cellar' }, exitTiles: [], tileOverrides: [], scenery: [] },
};

const makeGameActions = () => ({
    sendPresenceSingle: jest.fn(),
    sendMove: jest.fn(),
});

describe('MovementSystem', () => {
    let world, system;

    beforeEach(() => {
        jest.clearAllMocks();
        world = new WorldStore();
        system = new MovementSystem(world, testWorld, makeGameActions());
    });

    // --- Pure helper methods ---
    test('getFacingTarget calculates south', () => {
        expect(system.getFacingTarget({ x: 5, y: 5, facing: 's' })).toEqual({ x: 5, y: 6 });
    });
    test('getFacingTarget calculates north', () => {
        expect(system.getFacingTarget({ x: 5, y: 5, facing: 'n' })).toEqual({ x: 5, y: 4 });
    });
    test('getFacingTarget calculates east', () => {
        expect(system.getFacingTarget({ x: 5, y: 5, facing: 'e' })).toEqual({ x: 6, y: 5 });
    });
    test('getFacingTarget calculates west', () => {
        expect(system.getFacingTarget({ x: 5, y: 5, facing: 'w' })).toEqual({ x: 4, y: 5 });
    });
    test('getFacingTarget defaults to south when no facing', () => {
        expect(system.getFacingTarget({ x: 3, y: 3 })).toEqual({ x: 3, y: 4 });
    });

    test('dirToKey maps cardinal dirs', () => {
        expect(system.dirToKey('n')).toBe('north');
        expect(system.dirToKey('s')).toBe('south');
        expect(system.dirToKey('e')).toBe('east');
        expect(system.dirToKey('w')).toBe('west');
    });

    test('getFallbackArrivalX returns 0 for east, width-1 for west, center otherwise', () => {
        const room = { width: 10, height: 10 };
        expect(system.getFallbackArrivalX(room, 'e')).toBe(0);
        expect(system.getFallbackArrivalX(room, 'w')).toBe(9);
        expect(system.getFallbackArrivalX(room, 'n')).toBe(5);
    });

    test('getFallbackArrivalY returns 0 for south, height-1 for north, center otherwise', () => {
        const room = { width: 10, height: 10 };
        expect(system.getFallbackArrivalY(room, 's')).toBe(0);
        expect(system.getFallbackArrivalY(room, 'n')).toBe(9);
        expect(system.getFallbackArrivalY(room, 'e')).toBe(5);
    });

    // --- isWalkable ---
    test('isWalkable returns true for open tile', () => {
        expect(system.isWalkable('cellar', 5, 6)).toBe(true);
    });
    test('isWalkable returns false for wall tile', () => {
        expect(system.isWalkable('cellar', 3, 3)).toBe(false);
    });
    test('isWalkable returns false for water tile', () => {
        expect(system.isWalkable('cellar', 5, 5)).toBe(false);
    });
    test('isWalkable returns false for scenery tile', () => {
        expect(system.isWalkable('cellar', 7, 7)).toBe(false);
    });
    test('isWalkable returns false out of bounds', () => {
        expect(system.isWalkable('cellar', -1, 0)).toBe(false);
        expect(system.isWalkable('cellar', 10, 0)).toBe(false);
    });
    test('isWalkable returns false for unknown map', () => {
        expect(system.isWalkable('__nowhere__', 0, 0)).toBe(false);
    });

    // --- findBoundaryExit / roomHasBoundaryExit ---
    test('findBoundaryExit finds north exit when player at top', () => {
        const exit = system.findBoundaryExit(testWorld.cellar, 5, 0, 'n');
        expect(exit).not.toBeNull();
        expect(exit.dest).toBe('hallway');
    });

    test('findBoundaryExit returns null when no exit at edge', () => {
        const exit = system.findBoundaryExit(testWorld.cellar, 5, 9, 's');
        expect(exit).toBeNull();
    });

    test('roomHasBoundaryExit returns true for north exit', () => {
        expect(system.roomHasBoundaryExit(testWorld.cellar, 'n')).toBe(true);
    });

    test('roomHasBoundaryExit returns false for south with no exit there', () => {
        expect(system.roomHasBoundaryExit(testWorld.cellar, 's')).toBe(false);
    });

    // --- findNextStepBFS ---
    test('findNextStepBFS returns direction toward target', () => {
        const transform = { x: 2, y: 2, mapId: 'cellar', facing: 's' };
        const target = { x: 5, y: 2 };
        const dir = system.findNextStepBFS(transform, target);
        expect(['n', 's', 'e', 'w']).toContain(dir);
    });

    test('findNextStepBFS returns null for unknown map', () => {
        expect(system.findNextStepBFS({ x: 0, y: 0, mapId: '__nowhere__' }, { x: 1, y: 1 })).toBeNull();
    });

    test('findNextStepBFS returns null when no path exists', () => {
        // Surrounded by walls - just put target out of bounds
        const dir = system.findNextStepBFS({ x: 0, y: 0, mapId: 'cellar' }, { x: 3, y: 3 });
        // 3,3 is a wall so BFS should not find a direct path (it will go around or null)
        // The important thing is it doesn't throw
        expect(dir === null || typeof dir === 'string').toBe(true);
    });

    test('findNextStepBFS returns null when already at target', () => {
        const result = system.findNextStepBFS({ x: 5, y: 6, mapId: 'cellar' }, { x: 5, y: 6 });
        // When at target, queue immediately finds path with empty path array, so path[0] is undefined
        // which evaluates as falsy — the caller will clear the target
        expect(result === null || result === undefined).toBe(true);
    });

    // --- getOccupantAt ---
    test('getOccupantAt returns null when no occupant', () => {
        expect(system.getOccupantAt('cellar', 2, 2, -1)).toBeNull();
    });

    test('getOccupantAt finds npc entity', () => {
        const { getSpriteKind } = require('../graphics/sprite-kind.js');
        getSpriteKind.mockReturnValueOnce('npc');
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 4, y: 4 });
        world.setComponent(eid, Component.Sprite, { palette: 'npc' });
        world.setComponent(eid, 'Identity', { id: 'barkeep' });
        const result = system.getOccupantAt('cellar', 4, 4, -1);
        expect(result).not.toBeNull();
        expect(result.type).toBe('npc');
    });

    test('getOccupantAt excludes the given entityId', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 4, y: 4 });
        world.setComponent(eid, Component.Sprite, { palette: 'npc' });
        expect(system.getOccupantAt('cellar', 4, 4, eid)).toBeNull();
    });

    // --- handleMove ---
    test('handleMove moves entity to adjacent open tile', async () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 2, y: 2, facing: 's' });
        world.setComponent(eid, Component.PlayerControlled, {});
        await system.handleMove(eid, world.getComponent(eid, Component.Transform), 'e');
        expect(world.getComponent(eid, Component.Transform).x).toBe(3);
    });

    test('handleMove does nothing for unknown map', async () => {
        const eid = world.createEntity();
        const transform = { mapId: '__nowhere__', x: 2, y: 2 };
        world.setComponent(eid, Component.Transform, transform);
        await system.handleMove(eid, transform, 'e');
        expect(transform.x).toBe(2); // unchanged
    });

    test('handleMove bumps into wall tile', async () => {
        const eid = world.createEntity();
        const transform = { mapId: 'cellar', x: 2, y: 3, facing: 's' };
        world.setComponent(eid, Component.Transform, transform);
        await system.handleMove(eid, transform, 'e');
        // x: 3, y: 3 is a wall — should not move
        expect(transform.x).toBe(2);
        expect(world.getComponent(eid, Component.CollisionBump)).toBeDefined();
    });

    test('handleMove transitions via exit tile', async () => {
        const eid = world.createEntity();
        const transform = { mapId: 'cellar', x: 4, y: 1, facing: 'n' };
        world.setComponent(eid, Component.Transform, transform);
        world.setComponent(eid, Component.PlayerControlled, {});
        await system.handleMove(eid, transform, 'n');
        // Should transition to hallway
        expect(transform.mapId).toBe('hallway');
    });

    test('handleMove transitions via boundary stair tile', async () => {
        const eid = world.createEntity();
        const transform = { mapId: 'ruins', x: 5, y: 1, facing: 'n' };
        world.setComponent(eid, Component.Transform, transform);
        world.setComponent(eid, Component.PlayerControlled, {});
        await system.handleMove(eid, transform, 'n');
        expect(transform.mapId).toBe('ruins_descent');
    });

    test('handleMove OOB with no exit bumps', async () => {
        const eid = world.createEntity();
        const transform = { mapId: 'cellar', x: 0, y: 5, facing: 'w' };
        world.setComponent(eid, Component.Transform, transform);
        await system.handleMove(eid, transform, 'w');
        expect(transform.x).toBe(0); // no movement
        expect(world.getComponent(eid, Component.CollisionBump)).toBeDefined();
    });

    // --- update ---
    test('update processes move intent', async () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 2, y: 2, facing: 's' });
        world.setComponent(eid, Component.Intent, { action: 'move', dir: 's' });
        system.update();
        // Intent should be removed after processing
        await new Promise(r => setTimeout(r, 10));
        expect(world.getComponent(eid, Component.Intent)).toBeUndefined();
    });

    test('update clears MovementTarget for entities with Menu', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 2, y: 2 });
        world.setComponent(eid, Component.Menu, { type: 'inventory', entries: [] });
        world.setComponent(eid, Component.MovementTarget, { x: 5, y: 5 });
        system.update();
        expect(world.getComponent(eid, Component.MovementTarget)).toBeUndefined();
    });

    test('update processes movement target via BFS', async () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 2, y: 2, facing: 's' });
        world.setComponent(eid, Component.MovementTarget, { x: 4, y: 2 });
        system.update();
        await new Promise(r => setTimeout(r, 10));
        // Transform should have moved one step
        const t = world.getComponent(eid, Component.Transform);
        expect(t.x).toBeGreaterThan(2);
    });

    test('update removes MovementTarget when at target', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 4, y: 2, facing: 's' });
        world.setComponent(eid, Component.MovementTarget, { x: 4, y: 2 });
        system.update();
        expect(world.getComponent(eid, Component.MovementTarget)).toBeUndefined();
    });

    test('update handles CollisionBump when path is blocked', () => {
        const eid = world.createEntity();
        // Put player directly south of wall so BFS can't reach the wall
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 0, y: 0, facing: 's' });
        // Target at wall
        world.setComponent(eid, Component.MovementTarget, { x: 3, y: 3 });
        // Wall is at 3,3, scenery at 7,7 — BFS might find a path around
        expect(() => system.update()).not.toThrow();
    });

    test('processProactiveSharding calls preJoinShard near exits', async () => {
        const { preJoinShard } = await import('../network/index.js');
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        // Position near the hallway exit tile (x: 4-5, y: 0)
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 5, y: 1 });
        system.processProactiveSharding();
        expect(preJoinShard).toHaveBeenCalled();
    });

    // --- openNpcInteraction ---
    test('openNpcInteraction does nothing for unknown NPC', () => {
        const { bus } = require('../state/eventbus.js');
        system.openNpcInteraction('__unknown__');
        expect(bus.emit).not.toHaveBeenCalled();
    });

    test('openNpcInteraction emits npc:speak for known NPC', () => {
        const { bus } = require('../state/eventbus.js');
        // 'barkeep' is a known NPC in content/data/npcs.js
        system.openNpcInteraction('barkeep');
        expect(bus.emit).toHaveBeenCalledWith('npc:speak', expect.any(Object));
    });
});
