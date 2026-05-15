import { jest } from '@jest/globals';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { MovementSystem } from '../systems/movement-system.js';
import { TweenSystem } from '../systems/tween-system.js';
import { bus } from '../state/eventbus.js';

describe('Phase 8.5a: Movement Feel and Touch Affordances', () => {
    let world, movementSystem, tweenSystem, worldData, emitSpy;

    beforeEach(() => {
        world = new WorldStore();
        worldData = {
            'room1': {
                width: 10,
                height: 10,
                tileOverrides: [{ x: 5, y: 5, type: 'wall' }]
            }
        };
        emitSpy = jest.spyOn(bus, 'emit');
        movementSystem = new MovementSystem(world, worldData, {});
        tweenSystem = new TweenSystem(world);
    });

    afterEach(() => {
        emitSpy.mockRestore();
    });

    test('CollisionBump is added when moving into a wall', () => {
        const player = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 4, y: 5, facing: 'e' });
        world.setComponent(player, Component.Intent, { action: 'move', dir: 'e' });

        movementSystem.update();

        const bump = world.getComponent(player, Component.CollisionBump);
        expect(bump).toBeDefined();
        expect(bump.dir).toBe('e');
        expect(bump.progress).toBe(0);
        
        // Transform should NOT have changed
        const transform = world.getComponent(player, Component.Transform);
        expect(transform.x).toBe(4);
        expect(transform.y).toBe(5);
    });

    test('CollisionBump progresses in TweenSystem', () => {
        const player = world.createEntity();
        world.setComponent(player, Component.CollisionBump, { dir: 'n', progress: 0 });

        tweenSystem.update(0.01); // 10ms

        const bump = world.getComponent(player, Component.CollisionBump);
        expect(bump.progress).toBeGreaterThan(0);
    });

    test('MovementTarget results in multi-tile movement over time', () => {
        const player = world.createEntity();
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 0, y: 0, facing: 's' });
        world.setComponent(player, Component.MovementTarget, { x: 2, y: 0 });

        // First update should start first step
        movementSystem.update();
        
        const transform = world.getComponent(player, Component.Transform);
        const tween = world.getComponent(player, Component.Tweenable);
        
        expect(transform.x).toBe(1); // logical move
        expect(tween).toBeDefined(); // visual move started
        expect(tween.targetX).toBe(1);

        // While tweening, MovementSystem should wait
        movementSystem.update();
        expect(transform.x).toBe(1);

        // Finish tween
        world.removeComponent(player, Component.Tweenable);
        
        // Second step
        movementSystem.update();
        expect(transform.x).toBe(2);
        
        // Finish second tween
        world.removeComponent(player, Component.Tweenable);
        
        // Target reached, component should be removed
        movementSystem.update();
        expect(world.getComponent(player, Component.MovementTarget)).toBeUndefined();
    });
    
    test('MovementTarget is cancelled by blocked move', () => {
        const player = world.createEntity();
        // Surround target at 6,5 so it is unreachable from 4,5
        worldData['room1'].tileOverrides = [
            { x: 5, y: 5, type: 'wall' },
            { x: 6, y: 4, type: 'wall' },
            { x: 6, y: 6, type: 'wall' },
            { x: 7, y: 5, type: 'wall' }
        ];
        world.setComponent(player, Component.Transform, { mapId: 'room1', x: 4, y: 5, facing: 'e' });
        world.setComponent(player, Component.MovementTarget, { x: 6, y: 5 });

        movementSystem.update(); // Tries to pathfind, should fail immediately

        expect(world.getComponent(player, Component.CollisionBump)).toBeDefined();
        expect(world.getComponent(player, Component.MovementTarget)).toBeUndefined();
        expect(emitSpy).not.toHaveBeenCalledWith('log', expect.objectContaining({ msg: 'Path blocked.' }));
    });

    test('enemy movement uses the same tween speed as player movement', () => {
        const enemy = world.createEntity();
        world.setComponent(enemy, Component.Transform, { mapId: 'room1', x: 0, y: 0, facing: 'e' });
        world.setComponent(enemy, Component.Sprite, { type: 'goblin', palette: 'enemy', seed: 1 });

        movementSystem.handleMove(enemy, world.getComponent(enemy, Component.Transform), 'e');

        const tween = world.getComponent(enemy, Component.Tweenable);
        expect(tween.speed).toBeCloseTo(9.0);
    });
});
