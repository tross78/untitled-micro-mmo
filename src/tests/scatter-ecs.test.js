/**
 * Tests for ECS-based scattered resources (Phase 8.7x).
 */
import { jest } from '@jest/globals';
import { Component } from '../domain/components.js';
import { WorldStore } from '../domain/ecs.js';
import { WorldSyncSystem } from '../systems/world-sync-system.js';
import { worldState } from '../state/store.js';
import { bus } from '../state/eventbus.js';

describe('Scattered Resources ECS Sync', () => {
    let world;
    let stores;
    let worldData;
    let system;

    beforeEach(() => {
        world = new WorldStore();
        stores = {
            localPlayer: { location: 'forest_edge', gatheredNodes: { day: 1, nodes: new Set() } },
            players: new Map(),
            shardEnemies: new Map(),
            NPCS: {}
        };
        worldData = {
            forest_edge: {
                id: 'forest_edge',
                width: 10,
                height: 10,
                sceneryScatter: [
                    { type: 'resource', label: 'log', count: [2, 2] }
                ]
            },
            market: {
                id: 'market',
                width: 5,
                height: 5,
                sceneryScatter: []
            }
        };
        worldState.day = 1;
        worldState.seed = 'test-seed';
        
        system = new WorldSyncSystem(world, stores, worldData);
    });

    test('entities spawn on room enter', () => {
        system.update();
        const gatherables = world.query([Component.Gatherable]);
        expect(gatherables.length).toBe(2);
        
        const first = world.getComponent(gatherables[0], Component.Gatherable);
        expect(first.label).toBe('log');
        expect(first.locId).toBe('forest_edge');
    });

    test('entities despawn on room leave', () => {
        system.update();
        expect(world.query([Component.Gatherable]).length).toBe(2);

        stores.localPlayer.location = 'market';
        system.update();

        expect(world.query([Component.Gatherable]).length).toBe(0);
    });

    test('gathered nodes do not spawn same day', async () => {
        const { getScatteredContent } = await import('../rules/index.js');
        const nodes = getScatteredContent('forest_edge', 1, worldData.forest_edge);
        const firstNodeKey = `forest_edge:${nodes[0].x},${nodes[0].y}`;

        stores.localPlayer.gatheredNodes = { day: 1, nodes: new Set([firstNodeKey]) };
        
        system.update();
        expect(world.query([Component.Gatherable]).length).toBe(1);
    });

    test('day rollover re-spawns nodes (even if same room)', () => {
        system.update();
        const initialEntities = world.query([Component.Gatherable]);
        expect(initialEntities.length).toBe(2);

        // Simulate day change
        worldState.day = 2;
        system.update();

        // Should still have 2 (might be different positions, but same count)
        expect(world.query([Component.Gatherable]).length).toBe(2);
    });

    test('resource nodes keep type-specific sprite palettes', () => {
        stores.localPlayer.location = 'forest_edge';
        worldData.forest_edge.sceneryScatter = [
            { type: 'resource', label: 'log', count: [1, 1] },
            { type: 'resource', label: 'ore', count: [1, 1] },
        ];
        system.update();

        const gatherables = world.query([Component.Gatherable, Component.Sprite]);
        const sprites = gatherables.map(id => world.getComponent(id, Component.Sprite));
        const palettes = new Set(sprites.map(sprite => sprite.palette));

        expect(palettes).toEqual(new Set(['resource:log', 'resource:ore']));
    });

    test('PendingInteract resolves to ACTION.INTERACT on arrival', async () => {
        const { MovementSystem } = await import('../systems/movement-system.js');
        const entityId = world.createEntity();
        const transform = { mapId: 'forest_edge', x: 2, y: 3, facing: 'e' };
        world.setComponent(entityId, Component.Transform, transform);
        world.setComponent(entityId, Component.PendingInteract, { x: 3, y: 3, mapId: 'forest_edge' });
        
        const system = new MovementSystem(world, worldData, {});
        const busEmitSpy = jest.spyOn(bus, 'emit');
        
        await system.handleMove(entityId, transform, 'e');
        
        expect(busEmitSpy).toHaveBeenCalledWith('input:action', expect.objectContaining({ action: 'interact' }));
        expect(world.getComponent(entityId, Component.PendingInteract)).toBeUndefined();
    });
});
