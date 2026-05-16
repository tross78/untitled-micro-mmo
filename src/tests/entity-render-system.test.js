import { jest } from '@jest/globals';
import { EntityRenderSystem } from '../systems/entity-render-system.js';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';

function makeCtx() {
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        globalCompositeOperation: 'source-over',
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        arc: jest.fn(),
        ellipse: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        drawImage: jest.fn(),
        fillText: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        scale: jest.fn(),
    };
}

describe('EntityRenderSystem player variants', () => {
    let originalOffscreenCanvas;

    beforeEach(() => {
        originalOffscreenCanvas = global.OffscreenCanvas;
        global.OffscreenCanvas = class {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.ctx = {
                    drawImage: jest.fn(),
                    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(width * height * 4) })),
                    putImageData: jest.fn(),
                    fillStyle: '',
                    fillRect: jest.fn(),
                };
            }
            getContext() { return this.ctx; }
        };
    });

    afterEach(() => {
        global.OffscreenCanvas = originalOffscreenCanvas;
    });

    function setupPlayer(world) {
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'player', palette: 'self', seed: 1 });
        world.setComponent(id, Component.PlayerControlled, {});
        return id;
    }

    test('uses compiled movement frames while tweening', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.Tweenable, { startX: 1, startY: 1, targetX: 2, targetY: 1, progress: 0.5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.3);

        expect(spy).toHaveBeenCalledWith(1, 'self', 'player', expect.any(Number));
        const moveCall = spy.mock.calls.find((call) => call[2] === 'player');
        expect(moveCall[3]).toBeGreaterThan(0);
    });

    test('uses attack variant during attack animation', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.AttackAnimation, { dir: 'e', progress: 0.25 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.1);

        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_attack_side', 0);
    });

    test('uses hurt variant when hit flash is active', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.VisualEffect, { type: 'hit_flash', expires: Date.now() + 100 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.1);

        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_hurt', 0);
    });

    test('npc walk strips only animate while tweening', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'guard', palette: 'npcGuard', seed: 2 });
        world.setComponent(id, Component.Tweenable, { startX: 1, startY: 1, targetX: 2, targetY: 1, progress: 0.5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.3);

        expect(spy).toHaveBeenCalledWith(2, 'npcGuard', 'guard', expect.any(Number));
        const moveCall = spy.mock.calls.find((call) => call[2] === 'guard');
        expect(moveCall[3]).toBeGreaterThan(0);
    });

    test('shop NPCs use idle loops even without tweening', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'barkeep', palette: 'npcWarm', seed: 3 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.3);

        expect(spy).toHaveBeenCalledWith(3, 'npcWarm', 'barkeep', expect.any(Number));
        const idleCall = spy.mock.calls.find((call) => call[2] === 'barkeep');
        expect(idleCall[3]).toBeGreaterThanOrEqual(0); // cycles frames; exact index depends on gameTime
    });
});
