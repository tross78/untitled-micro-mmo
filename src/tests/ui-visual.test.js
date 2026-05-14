import { jest } from '@jest/globals';
import { UIRenderSystem } from '../systems/ui-render-system.js';
import { UI_PALETTE } from '../infra/graphics-constants.js';
import { WorldStore } from '../domain/ecs.js';

function makeCtx() {
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        globalAlpha: 1.0,
        imageSmoothingEnabled: false,
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
        measureText: jest.fn(() => ({ width: 50 })),
        fillText: jest.fn(),
        closePath: jest.fn(),
        getImageData: jest.fn(() => ({
            data: new Uint8ClampedArray(16 * 16 * 4)
        })),
        putImageData: jest.fn(),
    };
}

describe('Phase 8.55e: UI Visual Cohesion', () => {
    let world, vp, sys, ctx, originalOffscreenCanvas;

    beforeEach(() => {
        originalOffscreenCanvas = global.OffscreenCanvas;
        global.OffscreenCanvas = class {
            constructor(width, height) { this.width = width; this.height = height; }
            getContext() { return makeCtx(); }
        };
        world = new WorldStore();
        vp = { CW: 800, CH: 600, S: 32 };
        sys = new UIRenderSystem(world, vp, { 'tavern': { name: 'Tavern', description: 'Cozy' } });
        ctx = makeCtx();
    });

    afterEach(() => {
        global.OffscreenCanvas = originalOffscreenCanvas;
    });

    test('Top bar uses UI_PALETTE constants', () => {
        sys.drawTopBar(ctx, { location: 'tavern', hp: 10, gold: 50 });
        // accent color used for gold/hunts is the last fillStyle set in drawTopBar
        expect(ctx.fillStyle).toBe(UI_PALETTE.accent);
    });

    test('chrome heights stay compact relative to tile size', () => {
        vp = { CW: 1200, CH: 600, S: 46 };
        sys = new UIRenderSystem(world, vp, { tavern: { name: 'Tavern', description: 'Cozy' } });

        expect(sys.getTopBarHeight()).toBeLessThan(80);
        expect(sys.getTickerHeight()).toBeLessThan(24);
        expect(sys.getHudHeight()).toBeLessThan(90);
    });

    test('top bar keeps stat text inside a dedicated right-side panel on narrow viewports', () => {
        vp = { CW: 404, CH: 581, S: 39 };
        sys = new UIRenderSystem(world, vp, {
            tavern: {
                name: 'The Forest Depths',
                description: 'Ancient trees block the sky. Goblins lurk in the brush.',
            }
        });
        ctx = makeCtx();

        sys.drawTopBar(ctx, {
            location: 'tavern',
            hp: 5,
            maxHp: 90,
            attack: 18,
            defense: 7,
            gold: 8,
            forestFights: 15,
            statusEffects: [],
            level: 1
        });

        const calls = ctx.fillText.mock.calls;
        const statTexts = new Set(['5/90', '18', '7', '8', '15 hunts']);
        const statCalls = calls.filter(([text]) => statTexts.has(text));
        expect(statCalls).toHaveLength(5);

        const panelX = vp.CW - Math.min(Math.floor(vp.CW * 0.42), Math.max(180, Math.floor(vp.S * 5.1))) - Math.max(10, Math.floor(vp.S * 0.24));
        statCalls.forEach(([, x]) => {
            expect(x).toBeGreaterThanOrEqual(panelX);
        });
    });

    test('Toasts use UI_PALETTE and rounded rects', () => {
        sys.drawToast(ctx, 'Hello', Date.now(), Date.now() + 1000);
        expect(ctx.fillStyle).toBe(UI_PALETTE.textHi); // Last style set for text
        expect(ctx.strokeStyle).toBe(UI_PALETTE.border);
        expect(ctx.arcTo).toHaveBeenCalled(); // via roundRect
    });

    test('Dialogue box uses UI_PALETTE', () => {
        const id = world.createEntity();
        world.setComponent(id, 'Dialogue', { speakerId: 'Guard', text: 'Stop!', progress: 5 });
        sys.drawDialogue(ctx);
        expect(ctx.fillStyle).toBe(UI_PALETTE.textHi);
        expect(sys.dialogueHitRegions.length).toBeGreaterThan(0);
        const closeBtn = sys.dialogueHitRegions[0];
        expect(sys.resolveDialogueClick(closeBtn.x + 1, closeBtn.y + 1)).toBe(true);
    });

    test('mobile dialogue close affordance stays within a narrow viewport', () => {
        vp = { CW: 360, CH: 640, S: 40 };
        sys = new UIRenderSystem(world, vp, { tavern: { name: 'Tavern', description: 'Cozy' } });
        const id = world.createEntity();
        world.setComponent(id, 'Dialogue', { speakerId: 'Guard', text: 'Stop!', progress: 5 });

        sys.drawDialogue(ctx);

        expect(sys.dialogueHitRegions).toHaveLength(1);
        const closeBtn = sys.dialogueHitRegions[0];
        expect(closeBtn.x).toBeGreaterThanOrEqual(0);
        expect(closeBtn.y).toBeGreaterThanOrEqual(0);
        expect(closeBtn.x + closeBtn.w).toBeLessThanOrEqual(vp.CW);
        expect(closeBtn.y + closeBtn.h).toBeLessThanOrEqual(vp.CH);
        expect(closeBtn.w).toBeGreaterThan(40);
        expect(closeBtn.h).toBeGreaterThan(20);
    });

    test('mobile menu layout keeps hit regions inside the viewport', () => {
        vp = { CW: 360, CH: 640, S: 40 };
        sys = new UIRenderSystem(world, vp, { tavern: { name: 'Tavern', description: 'Cozy' } });
        const id = world.createEntity();
        world.setComponent(id, 'PlayerControlled', {});
        world.setComponent(id, 'Menu', {
            type: 'root',
            title: 'Adventurer Menu',
            message: 'Select an action.',
            selectedIndex: 0,
            entries: [
                { label: 'Inventory', detail: '0 items', action: {} },
                { label: 'Quests', detail: '2 active', action: {} },
                { label: 'Map', detail: 'Connected locations', action: {} },
                { label: 'Audio', detail: 'Muted', action: {} },
            ]
        });

        sys.drawMenu(ctx);

        expect(sys.menuHitRegions.length).toBe(4);
        sys.menuHitRegions.forEach((row) => {
            expect(row.x).toBeGreaterThanOrEqual(0);
            expect(row.y).toBeGreaterThanOrEqual(0);
            expect(row.x + row.w).toBeLessThanOrEqual(vp.CW);
            expect(row.y + row.h).toBeLessThanOrEqual(vp.CH);
        });
        const first = sys.menuHitRegions[0];
        expect(sys.resolveMenuClick(first.x + 1, first.y + 1)).toBe(0);
    });
});
