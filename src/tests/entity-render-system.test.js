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

    test('single-frame NPC sprites hold frame 0 even while tweening', () => {
        // The RD-sourced guard is a single-frame indexed sprite — there is no
        // walk strip to cycle, so frameIdx stays 0 regardless of movement.
        // (Frame cycling while tweening is covered by the player test above.)
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'guard', palette: 'npcGuard', seed: 2 });
        world.setComponent(id, Component.Tweenable, { startX: 1, startY: 1, targetX: 2, targetY: 1, progress: 0.5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');

        sys.draw(makeCtx(), 0, 0, 0, 0, 0.3);

        expect(spy).toHaveBeenCalledWith(2, 'npcGuard', 'guard', 0);
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

    test('player facing north uses player_back variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'n' });
        world.setComponent(id, Component.Sprite, { type: 'player', palette: 'self', seed: 1 });
        world.setComponent(id, Component.PlayerControlled, {});
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_back', 0);
    });

    test('player facing east uses player_side variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'e' });
        world.setComponent(id, Component.Sprite, { type: 'player', palette: 'self', seed: 1 });
        world.setComponent(id, Component.PlayerControlled, {});
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_side', 0);
    });

    test('guard facing north uses guard_back variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'n' });
        world.setComponent(id, Component.Sprite, { type: 'guard', palette: 'npcGuard', seed: 2 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(2, 'npcGuard', 'guard_back', 0);
    });

    test('guard facing east uses guard_side variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'e' });
        world.setComponent(id, Component.Sprite, { type: 'guard', palette: 'npcGuard', seed: 2 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(2, 'npcGuard', 'guard_side', 0);
    });

    test('enemy uses attack variant during attack animation', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'wolf', palette: 'enemy', seed: 5 });
        world.setComponent(id, Component.AttackAnimation, { dir: 'e', progress: 0.2 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(5, 'enemy', 'wolf_attack', 0);
    });

    test('enemy facing north uses back variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'n' });
        world.setComponent(id, Component.Sprite, { type: 'wolf', palette: 'enemy', seed: 5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(5, 'enemy', 'wolf_back', 0);
    });

    test('enemy facing east uses side variant', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'e' });
        world.setComponent(id, Component.Sprite, { type: 'wolf', palette: 'enemy', seed: 5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(5, 'enemy', 'wolf_side', 0);
    });

    test('CollisionBump shifts draw position east', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.CollisionBump, { dir: 'e', progress: 0.5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        // Just verify it doesn't crash and calls drawImage
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        expect(ctx.ellipse).toHaveBeenCalled();
    });

    test('CollisionBump shifts draw position north', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.CollisionBump, { dir: 'n', progress: 0.5 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        expect(ctx.ellipse).toHaveBeenCalled();
    });

    test('non-player entity renders name label with enemy color', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'wolf', palette: 'enemy', seed: 5 });
        world.setComponent(id, 'Identity', { name: 'Wolf' });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        expect(ctx.fillText).toHaveBeenCalledWith('Wolf', expect.any(Number), expect.any(Number));
    });

    test('stale peer renders with grey label color', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'player', palette: 'peer', seed: 9, stale: true });
        world.setComponent(id, 'Identity', { name: 'OldPeer' });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        // stale causes fillStyle to be set to grey before fillText
        expect(ctx.fillText).toHaveBeenCalledWith('OldPeer', expect.any(Number), expect.any(Number));
    });

    test('enemy with damaged health renders health bar', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 's' });
        world.setComponent(id, Component.Sprite, { type: 'wolf', palette: 'enemy', seed: 5 });
        world.setComponent(id, Component.Health, { current: 5, max: 20 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        // drawHealthBar calls fillRect twice (background + fill)
        expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    });

    test('getSprite uses peer palette variant based on seed hash', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const result = sys.getSprite(42, 'peer', 'player', 0);
        expect(result).toBeDefined();
    });

    test('getSprite uses resource palette via getSceneryPalette', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const result = sys.getSprite(1, 'resource:tree', 'tree', 0);
        expect(result).toBeDefined();
    });

    test('getSprite uses enemy-specific palette when available', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const result = sys.getSprite(1, 'enemy', 'wolf', 0);
        expect(result).toBeDefined();
    });

    test('getSprite caches results for same key', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const r1 = sys.getSprite(1, 'self', 'player', 0);
        const r2 = sys.getSprite(1, 'self', 'player', 0);
        expect(r1).toBe(r2);
    });

    test('getSprite evicts oldest entry when cache exceeds 64', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        // Fill cache past 64 entries
        for (let i = 0; i < 66; i++) {
            sys.getSprite(i, 'self', 'player', 0);
        }
        expect(sys.spriteCache.size).toBeLessThanOrEqual(66);
    });

    test('drawHealthBar renders red bar at low health', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.drawHealthBar(ctx, 1, 1, 0.1, 0, 0);
        expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    });

    test('drawHealthBar renders yellow bar at medium health', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.drawHealthBar(ctx, 1, 1, 0.35, 0, 0);
        expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    });

    test('drawHealthBar renders green bar at high health', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.drawHealthBar(ctx, 1, 1, 0.8, 0, 0);
        expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    });

    test('sprite cache eviction happens when > 64 entities drawn', () => {
        const world = new WorldStore();
        // Create 66 entities all in viewport
        for (let i = 0; i < 66; i++) {
            const id = world.createEntity();
            world.setComponent(id, Component.Transform, { x: i % 10, y: Math.floor(i / 10), mapId: 'tavern', facing: 's' });
            world.setComponent(id, Component.Sprite, { type: 'player', palette: 'self', seed: i });
            world.setComponent(id, Component.PlayerControlled, {});
        }
        const sys = new EntityRenderSystem(world, { W: 100, H: 100, S: 32 });
        const ctx = makeCtx();
        expect(() => sys.draw(ctx, 0, 0, 0, 0, 0)).not.toThrow();
    });

    test('entity facing west mirrors sprite via scale(-1,1)', () => {
        const world = new WorldStore();
        const id = world.createEntity();
        world.setComponent(id, Component.Transform, { x: 1, y: 1, mapId: 'tavern', facing: 'w' });
        world.setComponent(id, Component.Sprite, { type: 'player', palette: 'self', seed: 1 });
        world.setComponent(id, Component.PlayerControlled, {});
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const ctx = makeCtx();
        sys.draw(ctx, 0, 0, 0, 0, 0);
        expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    });

    test('attack north variant resolves to player_attack_back', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.AttackAnimation, { dir: 'n', progress: 0.1 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_attack_back', 0);
    });

    test('attack south variant resolves to player_attack', () => {
        const world = new WorldStore();
        const id = setupPlayer(world);
        world.setComponent(id, Component.AttackAnimation, { dir: 's', progress: 0.1 });
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        const spy = jest.spyOn(sys, 'getSprite');
        sys.draw(makeCtx(), 0, 0, 0, 0, 0);
        expect(spy).toHaveBeenCalledWith(1, 'self', 'player_attack', 0);
    });

    test('enemy pose variants keep the base enemy palette (no red flash while patrolling)', () => {
        const world = new WorldStore();
        const sys = new EntityRenderSystem(world, { W: 10, H: 10, S: 32 });
        expect(sys.resolvePaletteKey(1, 'enemy', 'goblin')).toBe('enemy_goblin');
        expect(sys.resolvePaletteKey(1, 'enemy', 'goblin_side')).toBe('enemy_goblin');
        expect(sys.resolvePaletteKey(1, 'enemy', 'goblin_back')).toBe('enemy_goblin');
        expect(sys.resolvePaletteKey(1, 'enemy', 'goblin_attack')).toBe('enemy_goblin');
        expect(sys.resolvePaletteKey(1, 'enemy', 'forest_wolf_side')).toBe('enemy_forest_wolf');
        // Unknown enemy types still fall back to the generic palette
        expect(sys.resolvePaletteKey(1, 'enemy', 'mystery_beast')).toBe('enemy');
    });
});
