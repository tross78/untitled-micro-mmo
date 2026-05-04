import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { MovementSystem } from '../systems/movement-system.js';

describe('Movement Pathfinding (Obstacle-Aware Tap Movement)', () => {
    let world, movementSystem, worldData;

    beforeEach(() => {
        world = new WorldStore();
        worldData = {
            'room1': {
                width: 10,
                height: 10,
                tileOverrides: [{ x: 5, y: 5, type: 'wall' }] // Central obstacle
            }
        };
        movementSystem = new MovementSystem(world, worldData, {});
    });

    test('finds path around single blocker', () => {
        const player = world.createEntity();
        // Start at 4,5, Target at 6,5. Obstacle at 5,5.
        // Greedy would hit 5,5. BFS should go around.
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 4, y: 5, facing: 'e' });
        world.setComponent(player, Component.MovementTarget, { x: 6, y: 5 });

        // Update 1: Should move to a neighbor to avoid 5,5
        movementSystem.update();
        
        const transform = world.getComponent(player, Component.Transform);
        expect(transform.x).toBe(4);
        expect(transform.y).not.toBe(5); // Moved away from obstacle row
    });

    test('stops and provides feedback when no path exists', () => {
        // Enclose target in walls
        worldData['room1'].tileOverrides = [
            { x: 8, y: 8, type: 'wall' },
            { x: 9, y: 8, type: 'wall' },
            { x: 8, y: 9, type: 'wall' }
        ];
        
        const player = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 0, y: 0, facing: 's' });
        world.setComponent(player, Component.MovementTarget, { x: 9, y: 9 });

        // Process until done or failed
        for(let i=0; i<50; i++) {
            movementSystem.update();
            // Manual removal of tweenable to simulate time passing for test
            if (world.getComponent(player, Component.Tweenable)) {
                world.removeComponent(player, Component.Tweenable);
            }
            if (!world.getComponent(player, Component.MovementTarget)) break;
        }

        expect(world.getComponent(player, Component.MovementTarget)).toBeUndefined();
        expect(world.getComponent(player, Component.CollisionBump)).toBeDefined();
    });

    test('clears target on arrival', () => {
        const player = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 0, y: 0, facing: 's' });
        world.setComponent(player, Component.MovementTarget, { x: 1, y: 0 });

        movementSystem.update();
        // Manual removal of tweenable
        world.removeComponent(player, Component.Tweenable);
        
        movementSystem.update();
        const mt = world.getComponent(player, Component.MovementTarget);
        expect(mt).toBeUndefined();
    });
});
