import { jest } from '@jest/globals';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { MovementSystem } from '../systems/movement-system.js';
import { bus } from '../state/eventbus.js';

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
});
