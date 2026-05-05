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

    test('Environment bar uses UI_PALETTE overlay color', () => {
        sys.drawEnvironmentBar(ctx, { location: 'tavern' });
        // The last fillStyle set is used for descriptions
        expect(ctx.fillStyle).toBe(UI_PALETTE.textLo);
    });

    test('HUD uses UI_PALETTE constants', () => {
        sys.drawHUD(ctx, { hp: 10, gold: 50 });
        // fights label is the last thing drawn in drawHUD
        expect(ctx.fillStyle).toBe(UI_PALETTE.textLo);
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
        // Hint text is last
        expect(ctx.fillStyle).toContain('rgba(255, 221, 85');
    });
});
