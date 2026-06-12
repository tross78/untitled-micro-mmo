import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { PatrolSystem } from '../systems/patrol-system.js';

describe('PatrolSystem', () => {
    let world;
    let system;

    beforeEach(() => {
        world = new WorldStore();
        system = new PatrolSystem(world);
    });

    it('should move entity along path', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
        world.setComponent(id, Component.Transform, { x: 0, y: 0, mapId: 'test' });
        world.setComponent(id, Component.Patrol, { path, index: 0, dir: 1, waitTicks: 0 });

        // First update: should advance to next point in path
        system.update();
        const patrol = world.getComponent(id, Component.Patrol);
        expect(patrol.index).toBe(1);

        // Next update: should set intent to move toward point 1
        system.update();
        const intent = world.getComponent(id, Component.Intent);
        expect(intent).toEqual({ action: 'move', dir: 'e' });
    });

    it('should pause at endpoints', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
        world.setComponent(id, Component.Transform, { x: 1, y: 0, mapId: 'test' });
        world.setComponent(id, Component.Patrol, { path, index: 1, dir: 1, waitTicks: 0 });

        system.update();
        const patrol = world.getComponent(id, Component.Patrol);
        expect(patrol.dir).toBe(-1);
        expect(patrol.waitTicks).toBe(60);
    });

    it('should loop patrol paths instead of ping-pong when mode is loop', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'test' });
        world.setComponent(id, Component.Patrol, { path, index: 2, dir: 1, waitTicks: 0, mode: 'loop', pauseTicks: 24 });

        system.update();
        const patrol = world.getComponent(id, Component.Patrol);
        expect(patrol.index).toBe(0);
        expect(patrol.waitTicks).toBe(24);
    });

    it('skips an unreachable waypoint after repeated blocked attempts', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
        world.setComponent(id, Component.Transform, { x: 0, y: 0, mapId: 'test' });
        world.setComponent(id, Component.Patrol, { path, index: 1, dir: 1, waitTicks: 0, mode: 'loop', stepPauseTicks: 0, pauseTicks: 0 });

        // Simulate the move being rejected every tick (e.g. a player standing in
        // the way): the transform never changes, intents pile up unprocessed.
        for (let i = 0; i < 4; i++) system.update();

        const patrol = world.getComponent(id, Component.Patrol);
        expect(patrol.index).toBe(0); // gave up on waypoint 1, moved on
    });

    it('resets the stuck counter once movement makes progress', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 3, y: 0 }];
        const transform = { x: 0, y: 0, mapId: 'test' };
        world.setComponent(id, Component.Transform, transform);
        world.setComponent(id, Component.Patrol, { path, index: 1, dir: 1, waitTicks: 0, mode: 'loop', stepPauseTicks: 0 });

        system.update(); // issues intent, records position
        system.update(); // still at 0,0 -> stuck = 1
        expect(world.getComponent(id, Component.Patrol).stuck).toBe(1);

        transform.x = 1; // the move succeeded this time
        system.update();
        expect(world.getComponent(id, Component.Patrol).stuck).toBe(0);
    });

    it('should apply a step pause after issuing patrol movement intent', () => {
        const id = world.createEntity();
        const path = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
        world.setComponent(id, Component.Transform, { x: 0, y: 0, mapId: 'test' });
        world.setComponent(id, Component.Patrol, { path, index: 1, dir: 1, waitTicks: 0, mode: 'loop', stepPauseTicks: 10 });

        system.update();

        expect(world.getComponent(id, Component.Intent)).toEqual({ action: 'move', dir: 's' });
        expect(world.getComponent(id, Component.Patrol).waitTicks).toBe(10);
    });
});
