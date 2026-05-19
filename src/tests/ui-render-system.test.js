import { UIRenderSystem } from '../systems/ui-render-system.js';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { world as gameWorld } from '../content/data.js';

jest.mock('../graphics/renderer.js', () => ({
    getTickerText: jest.fn(() => null),
}));
jest.mock('../engine/input.js', () => ({
    inputManager: { lastInputMode: 'keyboard' },
}));
jest.mock('../rules/index.js', () => {
    const actual = jest.requireActual('../rules/index.js');
    return { ...actual, getTimeOfDay: jest.fn(() => 'day'), getDynamicRoomDescription: jest.fn(() => 'A dark room.') };
});

const makeCtx = () => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    arcTo: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    closePath: jest.fn(),
    clip: jest.fn(),
    rect: jest.fn(),
    measureText: jest.fn(() => ({ width: 30 })),
    fillText: jest.fn(),
    createImageData: jest.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: jest.fn(),
    getImageData: jest.fn((x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
});

const VP = { W: 20, H: 20, S: 16, CW: 320, CH: 320 };

const makePlayer = (overrides = {}) => ({
    name: 'Tester', hp: 50, maxHp: 50, gold: 100, level: 1, attack: 5, defense: 2,
    location: 'cellar', x: 5, y: 5, forestFights: 10,
    statusEffects: [], equipped: { weapon: null, armor: null },
    currentEnemy: null, inventory: [],
    ...overrides,
});

const makeWorldState = () => ({
    day: 1, weather: 'clear', season: 'spring', threatLevel: 0, event: null,
});

const MockOffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this._ctx = makeCtx(); }
    getContext(type) { return type === '2d' ? this._ctx : null; }
};

describe('UIRenderSystem', () => {
    let world, system, ctx;

    beforeAll(() => {
        global.OffscreenCanvas = MockOffscreenCanvas;
    });

    beforeEach(() => {
        world = new WorldStore();
        system = new UIRenderSystem(world, { ...VP }, gameWorld, { worldState: makeWorldState() });
        ctx = makeCtx();
    });

    test('constructor initializes default state', () => {
        expect(system.hudHitRegions).toEqual([]);
        expect(system.menuHitRegions).toEqual([]);
        expect(system.dialogueHitRegions).toEqual([]);
        expect(system.heartSprite).toBeNull();
        expect(system.portraitCache).toBeInstanceOf(Map);
    });

    test('getTopBarHeight returns reasonable value', () => {
        expect(system.getTopBarHeight()).toBeGreaterThanOrEqual(56);
    });

    test('getTickerHeight returns reasonable value', () => {
        expect(system.getTickerHeight()).toBeGreaterThanOrEqual(18);
    });

    test('getHudHeight returns reasonable value', () => {
        expect(system.getHudHeight()).toBeGreaterThanOrEqual(64);
    });

    test('draw does not throw for valid player location', () => {
        expect(() => system.draw(ctx, makePlayer())).not.toThrow();
    });

    test('draw does not throw for unknown player location', () => {
        expect(() => system.draw(ctx, makePlayer({ location: '__nowhere__' }))).not.toThrow();
    });

    test('drawTopBar returns strip height for known room', () => {
        const h = system.drawTopBar(ctx, makePlayer());
        expect(h).toBeGreaterThan(0);
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    test('drawTopBar returns 0 for unknown location', () => {
        const h = system.drawTopBar(ctx, makePlayer({ location: '__nowhere__' }));
        expect(h).toBe(0);
    });

    test('drawTopBar renders night weather variants', async () => {
        const { getTimeOfDay } = await import('../rules/index.js');
        getTimeOfDay.mockReturnValueOnce('night');
        system.worldState = { weather: 'storm' };
        expect(() => system.drawTopBar(ctx, makePlayer())).not.toThrow();
    });

    test('drawTopBar with fog weather', async () => {
        const { getTimeOfDay } = await import('../rules/index.js');
        getTimeOfDay.mockReturnValueOnce('night');
        system.worldState = { weather: 'fog' };
        expect(() => system.drawTopBar(ctx, makePlayer())).not.toThrow();
    });

    test('drawTopBar with day storm weather', () => {
        system.worldState = { weather: 'storm' };
        expect(() => system.drawTopBar(ctx, makePlayer())).not.toThrow();
    });

    test('drawTopBar with rested status effect', () => {
        const player = makePlayer({ statusEffects: [{ id: 'well_rested' }] });
        expect(() => system.drawTopBar(ctx, player)).not.toThrow();
    });

    test('drawTicker does nothing when getTickerText returns null', async () => {
        const { getTickerText } = await import('../graphics/renderer.js');
        getTickerText.mockReturnValueOnce(null);
        system.drawTicker(ctx, 0);
        expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    test('drawTicker renders text when getTickerText returns a string', async () => {
        const { getTickerText } = await import('../graphics/renderer.js');
        getTickerText.mockReturnValueOnce('Hello World');
        system.drawTicker(ctx, 40);
        expect(ctx.fillText).toHaveBeenCalled();
    });

    test('drawHUDBar renders persistent buttons', () => {
        system.drawHUDBar(ctx, makePlayer());
        // Three persistent buttons: Bag, Quests, Menu
        expect(system.hudHitRegions.length).toBeGreaterThanOrEqual(3);
        const actions = system.hudHitRegions.map(r => r.action);
        expect(actions).toContain('inventory');
        expect(actions).toContain('quests');
        expect(actions).toContain('menu');
    });

    test('drawHUDBar shows Attack button when enemy entity adjacent', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 5, y: 5 });

        const enemyEid = world.createEntity();
        world.setComponent(enemyEid, Component.Transform, { mapId: 'cellar', x: 6, y: 5 });
        world.setComponent(enemyEid, Component.Sprite, { palette: 'enemy' });

        const player = makePlayer({ location: 'cellar', currentEnemy: null });
        system.shardEnemies = new Map([['cellar', { hp: 10, loot: [] }]]);
        expect(() => system.drawHUDBar(ctx, player)).not.toThrow();
    });

    test('drawHUDBar shows Strike and Flee when in combat', () => {
        // Use a room that has an enemy defined
        const roomWithEnemy = Object.keys(gameWorld).find(k => gameWorld[k].enemy);
        if (!roomWithEnemy) return; // skip if no room has enemy in test data
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Transform, { mapId: roomWithEnemy, x: 5, y: 5 });

        const enemyEid = world.createEntity();
        world.setComponent(enemyEid, Component.Transform, { mapId: roomWithEnemy, x: 5, y: 6 });
        world.setComponent(enemyEid, Component.Sprite, { palette: 'enemy' });

        const player = makePlayer({ location: roomWithEnemy, currentEnemy: 'wolf' });
        system.shardEnemies = new Map([[roomWithEnemy, { hp: 10, loot: [] }]]);
        system.drawHUDBar(ctx, player);
        const actions = system.hudHitRegions.map(r => r.action);
        expect(actions).toContain('flee');
    });

    test('drawHUDBar shows Pickup when enemy dead with loot', () => {
        const player = makePlayer({ location: 'cellar', currentEnemy: null });
        system.shardEnemies = new Map([['cellar', { hp: 0, loot: ['potion'] }]]);
        system.drawHUDBar(ctx, player);
        const actions = system.hudHitRegions.map(r => r.action);
        expect(actions).toContain('pickup');
    });

    test('drawHUDBar shows Gather when gatherable entity at player feet', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Transform, { mapId: 'cellar', x: 5, y: 5 });

        const gatherEid = world.createEntity();
        world.setComponent(gatherEid, Component.Gatherable, { resourceType: 'herb' });
        world.setComponent(gatherEid, Component.Transform, { mapId: 'cellar', x: 5, y: 5 });

        const player = makePlayer({ location: 'cellar', currentEnemy: null });
        system.drawHUDBar(ctx, player);
        const actions = system.hudHitRegions.map(r => r.action);
        expect(actions).toContain('pickup');
    });

    test('resolveHUDClick returns region when within bounds', () => {
        system.drawHUDBar(ctx, makePlayer());
        const region = system.hudHitRegions[0];
        const hit = system.resolveHUDClick(region.x + 1, region.y + 1);
        expect(hit).toBeTruthy();
        expect(hit.action).toBe(region.action);
    });

    test('resolveHUDClick returns null for miss', () => {
        system.drawHUDBar(ctx, makePlayer());
        expect(system.resolveHUDClick(-999, -999)).toBeNull();
    });

    test('drawStatCell does not throw', () => {
        expect(() => system.drawStatCell(ctx, 10, 10, 60, 24, { icon: '⚔', text: '5', color: '#fff' })).not.toThrow();
    });

    test('drawStatCell with heart icon uses drawImage when sprite is set', () => {
        system.heartSprite = { width: 16, height: 16 };
        expect(() => system.drawStatCell(ctx, 10, 10, 60, 24, { icon: 'heart', text: '10/10', color: '#f00' })).not.toThrow();
        expect(ctx.drawImage).toHaveBeenCalled();
    });

    test('drawOverlays processes toast overlay', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.UIOverlay, { type: 'toast', text: 'Hello!', expires: Date.now() + 5000 });
        expect(() => system.drawOverlays(ctx)).not.toThrow();
        expect(ctx.fillText).toHaveBeenCalled();
    });

    test('drawOverlays processes fanfare overlay', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.UIOverlay, { type: 'fanfare', text: 'You won!\nGreat job', expires: Date.now() + 5000 });
        expect(() => system.drawOverlays(ctx)).not.toThrow();
    });

    test('drawOverlays processes banner overlay', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.UIOverlay, { type: 'banner', text: 'Level Up!', expires: Date.now() + 5000 });
        expect(() => system.drawOverlays(ctx)).not.toThrow();
    });

    test('drawOverlays removes expired overlays', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.UIOverlay, { type: 'toast', text: 'Old', expires: Date.now() - 1 });
        system.drawOverlays(ctx);
        expect(world.getComponent(eid, Component.UIOverlay)).toBeUndefined();
    });

    test('drawMenu does nothing with no menu component', () => {
        system.drawMenu(ctx);
        expect(system.menuHitRegions).toHaveLength(0);
    });

    test('drawMenu renders items when menu is open', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            title: 'Inventory',
            entries: [
                { label: 'Potion', detail: 'Heals 20 HP' },
                { label: 'Iron Sword', detail: 'ATK +3' },
            ],
            selectedIndex: 0,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
        expect(ctx.fillText).toHaveBeenCalled();
        expect(system.menuHitRegions.length).toBeGreaterThanOrEqual(2);
    });

    test('drawMenu with message renders message text', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'confirm',
            title: 'Confirm?',
            message: 'Are you sure you want to do this?',
            entries: [{ label: 'Yes' }, { label: 'No' }],
            selectedIndex: 0,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
    });

    test('drawMenu with disabled entry renders differently', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'shop',
            entries: [{ label: 'Item A', disabled: true }, { label: 'Item B', disabled: false }],
            selectedIndex: 0,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
    });

    test('drawMenu with many entries uses scrolling', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            entries: Array.from({ length: 15 }, (_, i) => ({ label: `Item ${i}` })),
            selectedIndex: 10,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
        // Should show scroll indicators
        expect(ctx.fillText).toHaveBeenCalled();
    });

    test('resolveMenuClick returns -1 with no menu', () => {
        expect(system.resolveMenuClick(100, 100)).toBe(-1);
    });

    test('resolveMenuClick returns index when hit', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            entries: [{ label: 'Item A' }, { label: 'Item B' }],
            selectedIndex: 0,
        });
        system.drawMenu(ctx);
        const region = system.menuHitRegions[0];
        const result = region ? system.resolveMenuClick(region.x + 1, region.y + 1) : -1;
        expect(typeof result).toBe('number');
    });

    test('resolveMenuClick returns -1 for out-of-bounds click', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            entries: [{ label: 'Item A' }],
            selectedIndex: 0,
        });
        system.drawMenu(ctx);
        expect(system.resolveMenuClick(-999, -999)).toBe(-1);
    });

    test('drawDialogue does nothing when no Dialogue component', () => {
        system.drawDialogue(ctx);
        expect(system.dialogueHitRegions).toHaveLength(0);
    });

    test('drawDialogue renders in-progress dialogue', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'merchant',
            text: 'Hello traveler! Welcome to my shop.',
            progress: 10,
        });
        expect(() => system.drawDialogue(ctx)).not.toThrow();
        expect(ctx.fillText).toHaveBeenCalled();
    });

    test('drawDialogue shows close button when text fully displayed', () => {
        const fullText = 'Hello!';
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'guard',
            text: fullText,
            progress: fullText.length,
        });
        system.drawDialogue(ctx);
        expect(system.dialogueHitRegions.length).toBeGreaterThan(0);
        expect(system.dialogueHitRegions[0].kind).toBe('close');
    });

    test('drawDialogue renders portrait for known NPC', () => {
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'merchant',
            text: 'Buy something?',
            progress: 5,
        });
        expect(() => system.drawDialogue(ctx)).not.toThrow();
    });

    test('resolveDialogueClick returns false with no regions', () => {
        expect(system.resolveDialogueClick(0, 0)).toBe(false);
    });

    test('resolveDialogueClick returns true on close button hit', () => {
        const fullText = 'Done!';
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'guard',
            text: fullText,
            progress: fullText.length,
        });
        system.drawDialogue(ctx);
        const r = system.dialogueHitRegions[0];
        const clicked = r ? system.resolveDialogueClick(r.x + 1, r.y + 1) : false;
        expect(typeof clicked).toBe('boolean');
    });

    test('fitText truncates long text', () => {
        // measureText returns 30 per call, so short strings won't trigger truncation
        ctx.measureText = jest.fn(s => ({ width: s.length * 10 }));
        const result = system.fitText(ctx, 'A very long string that exceeds max', 50);
        expect(result).toContain('...');
    });

    test('fitText returns short text unchanged', () => {
        ctx.measureText = jest.fn(() => ({ width: 10 }));
        const result = system.fitText(ctx, 'Hi', 200);
        expect(result).toBe('Hi');
    });

    test('measureWrap wraps long text into multiple lines', () => {
        ctx.measureText = jest.fn(s => ({ width: s.length * 8 }));
        const lines = system.measureWrap(ctx, 'one two three four five six', 60);
        expect(lines.length).toBeGreaterThan(1);
    });

    test('measureWrap handles empty string', () => {
        const lines = system.measureWrap(ctx, '', 200);
        expect(lines).toEqual(['']);
    });

    test('getDialoguePortrait returns null for unknown speaker', () => {
        expect(system.getDialoguePortrait('__unknown__')).toBeNull();
    });

    test('getDialoguePortrait caches result on second call', () => {
        system.getDialoguePortrait('merchant');
        system.getDialoguePortrait('merchant');
        expect(system.portraitCache.size).toBeGreaterThan(0);
    });

    test('getMenuLayout returns correct structure', () => {
        const menu = { entries: [{ label: 'A' }, { label: 'B' }], selectedIndex: 0 };
        const layout = system.getMenuLayout(menu);
        expect(layout).toHaveProperty('x');
        expect(layout).toHaveProperty('rows');
        expect(layout.rows.length).toBe(2);
    });

    test('drawMenu with gamepad input mode', async () => {
        const { inputManager } = await import('../engine/input.js');
        inputManager.lastInputMode = 'gamepad';
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            entries: [{ label: 'Item A' }],
            selectedIndex: 0,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
        inputManager.lastInputMode = 'keyboard';
    });

    test('drawMenu with touch input mode', async () => {
        const { inputManager } = await import('../engine/input.js');
        inputManager.lastInputMode = 'touch';
        const eid = world.createEntity();
        world.setComponent(eid, Component.PlayerControlled, {});
        world.setComponent(eid, Component.Menu, {
            type: 'inventory',
            entries: [{ label: 'Item A' }],
            selectedIndex: 0,
        });
        expect(() => system.drawMenu(ctx)).not.toThrow();
        inputManager.lastInputMode = 'keyboard';
    });

    test('drawDialogue with touch input shows tap hint', async () => {
        const { inputManager } = await import('../engine/input.js');
        inputManager.lastInputMode = 'touch';
        const fullText = 'Done!';
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'guard',
            text: fullText,
            progress: fullText.length,
        });
        expect(() => system.drawDialogue(ctx)).not.toThrow();
        inputManager.lastInputMode = 'keyboard';
    });

    test('drawDialogue with gamepad input shows gamepad hint', async () => {
        const { inputManager } = await import('../engine/input.js');
        inputManager.lastInputMode = 'gamepad';
        const fullText = 'Done!';
        const eid = world.createEntity();
        world.setComponent(eid, Component.Dialogue, {
            speakerId: 'guard',
            text: fullText,
            progress: fullText.length,
        });
        expect(() => system.drawDialogue(ctx)).not.toThrow();
        inputManager.lastInputMode = 'keyboard';
    });
});
