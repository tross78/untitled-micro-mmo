import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { MovementSystem } from '../systems/movement-system.js';
import { findSafeArrival } from '../rules/index.js';

describe('Phase 8.5 Tightening: Exit Safety and Safe Arrival', () => {
    let world, movementSystem, worldData;

    beforeEach(() => {
        world = new WorldStore();
        worldData = {
            'room_safe': {
                id: 'room_safe',
                width: 5, height: 5,
                tileOverrides: []
            },
            'room_blocked': {
                id: 'room_blocked',
                width: 5, height: 5,
                tileOverrides: [
                    { x: 1, y: 1, type: 'wall' },
                    { x: 1, y: 2, type: 'wall' },
                    { x: 2, y: 1, type: 'wall' }
                ]
            }
        };
        movementSystem = new MovementSystem(world, worldData, {});
    });

    test('findSafeArrival returns original if walkable', () => {
        const pos = findSafeArrival(1, 1, 5, 5, (_x, _y) => true);
        expect(pos).toEqual({ x: 1, y: 1 });
    });

    test('findSafeArrival finds nearest walkable tile when blocked', () => {
        const isW = (x, y) => {
            const blocked = [[1,1], [1,2], [2,1]];
            return !blocked.some(b => b[0] === x && b[1] === y);
        };
        const pos = findSafeArrival(1, 1, 5, 5, isW);
        expect(pos).not.toEqual({ x: 1, y: 1 });
        // Neighbors of 1,1: 1,0 (N), 1,2 (S-blocked), 2,1 (E-blocked), 0,1 (W)
        // 1,0 is the first neighbor in order that is walkable
        expect(pos).toEqual({ x: 1, y: 0 });
    });

    test('performTransition applies safe arrival logic', async () => {
        const player = world.createEntity();
        const transform = { mapId: 'room_safe', x: 0, y: 0 };
        world.setComponent(player, Component.Transform, transform);

        // Transition to blocked tile 1,1 in room_blocked
        await movementSystem.performTransition(player, transform, 'room_blocked', 1, 1);

        expect(transform.mapId).toBe('room_blocked');
        expect(transform.x).toBe(1);
        expect(transform.y).toBe(0); // Safe neighbor found via shared findSafeArrival
    });

    test('boundary edge exits use authored exit tiles instead of preserving arbitrary edge offset', async () => {
        worldData.room_safe.exitTiles = [
            { x: 0, y: 2, dest: 'room_blocked', destX: 1, destY: 1, w: 1, h: 1 }
        ];
        worldData.room_safe.exits = { west: 'room_blocked' };

        const player = world.createEntity();
        const transform = { mapId: 'room_safe', x: 0, y: 2, facing: 'w' };
        world.setComponent(player, Component.Transform, transform);

        await movementSystem.handleMove(player, transform, 'w');

        expect(transform.mapId).toBe('room_blocked');
        expect(transform.x).toBe(1);
        expect(transform.y).toBe(0);
    });

    test('boundary edge with authored exit elsewhere does not allow arbitrary off-edge transition', async () => {
        worldData.room_safe.exitTiles = [
            { x: 0, y: 4, dest: 'room_blocked', destX: 1, destY: 1, w: 1, h: 1 }
        ];
        worldData.room_safe.exits = { west: 'room_blocked' };

        const player = world.createEntity();
        const transform = { mapId: 'room_safe', x: 0, y: 1, facing: 'w' };
        world.setComponent(player, Component.Transform, transform);

        await movementSystem.handleMove(player, transform, 'w');

        expect(transform.mapId).toBe('room_safe');
        expect(transform.x).toBe(0);
        expect(transform.y).toBe(1);
    });
});
