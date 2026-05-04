import { jest } from '@jest/globals';
import { UIRenderSystem } from '../systems/ui-render-system.js';
import { inputManager } from '../engine/input.js';

// Mock graphics to avoid OffscreenCanvas issues
jest.mock('../graphics/graphics.js', () => ({
    drawLargeTree: jest.fn(),
    getGrayscaleTemplate: jest.fn(),
    getSceneryPalette: jest.fn(),
    applyPalette: jest.fn(),
    roundRect: jest.fn(),
    PALETTES: { self: ['#000'], npc: ['#000'], enemy: ['#000'] }
}));

// Mock renderer to avoid dependencies
jest.mock('../graphics/renderer.js', () => ({
    getTickerText: jest.fn(() => '')
}));

// Mock dom/shell to avoid errors
const mockDiv = document.createElement('div');
jest.mock('../adapters/dom/shell.js', () => ({
    getGameAreaEl: jest.fn(() => mockDiv)
}));

function makeCtx() {
    return {
        save: jest.fn(),
        restore: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        fillText: jest.fn(),
        measureText: jest.fn(() => ({ width: 100 })),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        clip: jest.fn(),
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        textAlign: '',
        textBaseline: '',
        canvas: { width: 800, height: 600 }
    };
}

describe('UIRenderSystem Input Mode Hints', () => {
    let world;
    let uiSystem;
    let ctx;
    const vp = { CW: 800, CH: 600, S: 32, W: 25, H: 18 };

    beforeAll(() => {
        inputManager.init();
    });

    beforeEach(() => {
        world = {
            query: jest.fn(() => []),
            getComponent: jest.fn(),
            removeComponent: jest.fn(),
            setComponent: jest.fn()
        };
        uiSystem = new UIRenderSystem(world, vp, {});
        ctx = makeCtx();
    });

    test('updates hint to keyboard on keydown', () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
        expect(inputManager.lastInputMode).toBe('keyboard');

        const menu = { type: 'npc', title: 'Test', entries: [{ label: 'A', action: {} }], selectedIndex: 0 };
        world.query.mockReturnValue([1]);
        world.getComponent.mockReturnValue(menu);

        uiSystem.drawMenu(ctx, menu);
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('WASD to navigate'),
            expect.any(Number), expect.any(Number)
        );
    });

    test('updates hint to touch on touchstart', () => {
        const event = new CustomEvent('touchstart');
        // @ts-ignore
        event.touches = [{ clientX: 0, clientY: 0 }];
        window.dispatchEvent(event); // InputManager listens on window for some, but canvas for touch
        // Wait, InputManager.init attaches to getGameAreaEl()
        const gameArea = require('../adapters/dom/shell.js').getGameAreaEl();
        gameArea.dispatchEvent(event);

        expect(inputManager.lastInputMode).toBe('touch');

        const menu = { type: 'npc', title: 'Test', entries: [{ label: 'A', action: {} }], selectedIndex: 0 };
        world.query.mockReturnValue([1]);
        world.getComponent.mockReturnValue(menu);

        uiSystem.drawMenu(ctx, menu);
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('Tap to choose'),
            expect.any(Number), expect.any(Number)
        );
    });

    test('updates hint to gamepad on button press (simulated)', () => {
        // Gamepad is polled, so we simulate the internal state update
        inputManager.lastInputMode = 'gamepad';
        expect(inputManager.lastInputMode).toBe('gamepad');

        const menu = { type: 'npc', title: 'Test', entries: [{ label: 'A', action: {} }], selectedIndex: 0 };
        world.query.mockReturnValue([1]);
        world.getComponent.mockReturnValue(menu);

        uiSystem.drawMenu(ctx, menu);
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('(A) to confirm'),
            expect.any(Number), expect.any(Number)
        );
    });

    test('renders dialogue hints matching input mode', () => {
        const dialogue = { speakerId: 'Sage', text: 'Hello', progress: 5 };
        world.query.mockReturnValue([1]);
        world.getComponent.mockReturnValue(dialogue);

        // Keyboard mode
        inputManager.lastInputMode = 'keyboard';
        uiSystem.drawDialogue(ctx);
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('Space/Enter to advance'),
            expect.any(Number), expect.any(Number)
        );

        // Touch mode
        inputManager.lastInputMode = 'touch';
        uiSystem.drawDialogue(ctx);
        expect(ctx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('Tap to advance'),
            expect.any(Number), expect.any(Number)
        );
    });
});
