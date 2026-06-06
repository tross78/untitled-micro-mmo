import { jest } from '@jest/globals';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { MovementSystem } from '../systems/movement-system.js';
import { bus } from '../state/eventbus.js';
import { sceneryBlocksCell } from '../infra/graphics-constants.js';

describe('sceneryBlocksCell footprint masks', () => {
    test('a tree blocks its canopy/trunk plus-shape but not its transparent corners', () => {
        const tree = { x: 4, y: 4, w: 3, h: 3, label: 'tree' };
        // Four corners of the 3x3 footprint are walkable (the "invisible" cells).
        for (const [cx, cy] of [[4, 4], [6, 4], [4, 6], [6, 6]]) {
            expect(sceneryBlocksCell(tree, cx, cy)).toBe(false);
        }
        // Canopy mass (middle row), top-centre, and trunk (bottom-centre) still block.
        for (const [cx, cy] of [[5, 4], [4, 5], [5, 5], [6, 5], [5, 6]]) {
            expect(sceneryBlocksCell(tree, cx, cy)).toBe(true);
        }
        // Outside the footprint is never blocking.
        expect(sceneryBlocksCell(tree, 3, 4)).toBe(false);
        expect(sceneryBlocksCell(tree, 7, 6)).toBe(false);
    });

    test('a prop without a mask blocks its whole footprint', () => {
        const rock = { x: 5, y: 5, w: 1, h: 1, label: 'rock' };
        expect(sceneryBlocksCell(rock, 5, 5)).toBe(true);
        expect(sceneryBlocksCell(rock, 6, 5)).toBe(false);
    });
});

describe('movement collisions against occupants and scenery', () => {
    let world;
    let movementSystem;
    let emitSpy;

    beforeEach(() => {
        world = new WorldStore();
        emitSpy = jest.spyOn(bus, 'emit');
        movementSystem = new MovementSystem(world, {
            room: {
                width: 10,
                height: 10,
                scenery: [{ x: 5, y: 5, label: 'rock' }],
            },
        }, {});
    });

    afterEach(() => {
        emitSpy.mockRestore();
    });

    test('moving into an NPC opens interaction instead of stepping through', async () => {
        const player = world.createEntity();
        const npc = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room', x: 4, y: 5, facing: 'e' });
        world.setComponent(player, Component.MovementTarget, { x: 5, y: 5 });
        world.setComponent(player, Component.PendingInteract, { x: 5, y: 5, mapId: 'room' });
        world.setComponent(npc, Component.Transform, { mapId: 'room', x: 5, y: 5, facing: 's' });
        world.setComponent(npc, Component.Sprite, { type: 'npc', palette: 'npc-guard' });
        world.setComponent(npc, 'Identity', { id: 'guard' });

        await movementSystem.handleMove(player, world.getComponent(player, Component.Transform), 'e');

        expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({
            npcName: expect.any(String),
            text: expect.any(String),
        }));
        expect(world.getComponent(player, Component.Transform)).toMatchObject({ x: 4, y: 5, mapId: 'room' });
        expect(world.getComponent(player, Component.Tweenable)).toBeUndefined();
        expect(world.getComponent(player, Component.MovementTarget)).toBeUndefined();
        expect(world.getComponent(player, Component.PendingInteract)).toBeUndefined();
    });

    test('moving into an enemy triggers attack instead of movement', async () => {
        const player = world.createEntity();
        const enemy = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room', x: 4, y: 5, facing: 'e' });
        world.setComponent(enemy, Component.Transform, { mapId: 'room', x: 5, y: 5, facing: 's' });
        world.setComponent(enemy, Component.Sprite, { type: 'enemy', palette: 'enemy' });

        await movementSystem.handleMove(player, world.getComponent(player, Component.Transform), 'e');

        expect(emitSpy).toHaveBeenCalledWith('input:action', { action: 'attack', type: 'down' });
        expect(world.getComponent(player, Component.Transform)).toMatchObject({ x: 4, y: 5, mapId: 'room' });
    });

    test('moving into scenery bumps and clears the target path', async () => {
        const player = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room', x: 4, y: 5, facing: 'e' });
        world.setComponent(player, Component.MovementTarget, { x: 5, y: 5 });

        await movementSystem.handleMove(player, world.getComponent(player, Component.Transform), 'e');

        expect(world.getComponent(player, Component.CollisionBump)).toMatchObject({ dir: 'e', progress: 0 });
        expect(world.getComponent(player, Component.MovementTarget)).toBeUndefined();
        expect(world.getComponent(player, Component.Transform)).toMatchObject({ x: 4, y: 5, mapId: 'room' });
        expect(emitSpy).not.toHaveBeenCalledWith('log', expect.objectContaining({ msg: 'Blocked.' }));
    });

    test('player can step into a tree corner but is bumped by the trunk', async () => {
        const treeSystem = new MovementSystem(world, {
            room: { width: 10, height: 10, scenery: [{ x: 4, y: 4, w: 3, h: 3, label: 'tree' }] },
        }, {});

        // Corner cell (4,4) is the transparent NW corner of the footprint — should be walkable.
        const a = world.createEntity();
        world.setComponent(a, Component.Transform, { mapId: 'room', x: 3, y: 4, facing: 'e' });
        await treeSystem.handleMove(a, world.getComponent(a, Component.Transform), 'e');
        expect(world.getComponent(a, Component.Transform)).toMatchObject({ x: 4, y: 4 });

        // Trunk cell (5,6) is the bottom-centre of the footprint — should still block.
        const b = world.createEntity();
        world.setComponent(b, Component.Transform, { mapId: 'room', x: 4, y: 6, facing: 'e' });
        await treeSystem.handleMove(b, world.getComponent(b, Component.Transform), 'e');
        expect(world.getComponent(b, Component.Transform)).toMatchObject({ x: 4, y: 6 });
        expect(world.getComponent(b, Component.CollisionBump)).toMatchObject({ dir: 'e' });
    });
});
