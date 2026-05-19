import { jest } from '@jest/globals';
import { bus } from '../state/eventbus.js';
import { ACTION } from '../engine/input.js';
import { appRuntime } from '../app/runtime.js';
import { Component } from '../domain/components.js';
import { localPlayer } from '../state/store.js';

// We need to mock things that events.js depends on
jest.mock('../state/persistence.js', () => ({
    saveLocalState: jest.fn()
}));

jest.mock('../graphics/renderer.js', () => ({
    renderWorld: jest.fn(),
    setVisualRefreshCallback: jest.fn(),
    setLogicalRefreshCallback: jest.fn(),
    triggerHitFlash: jest.fn(),
    showFloatingText: jest.fn(),
    showDialogue: jest.fn(),
    showToast: jest.fn(),
    showLevelUp: jest.fn(),
    showItemFanfare: jest.fn(),
    showRoomBanner: jest.fn(),
    advanceDialogue: jest.fn(),
    isDialogueOpen: jest.fn(() => false)
}));

jest.mock('../ui/index.js', () => ({
    renderActionButtons: jest.fn(),
    log: jest.fn()
}));

jest.mock('../commands/index.js', () => ({
    handleCommand: jest.fn().mockResolvedValue(true),
    getPlayerName: jest.fn(),
    startStateChannel: jest.fn(),
    resolveRound: jest.fn(),
    grantItem: jest.fn()
}));

// Mock graphics to avoid OffscreenCanvas
jest.mock('../graphics/graphics.js', () => ({
    drawTile: jest.fn(),
    applyPalette: jest.fn(),
    PALETTES: {},
    getGrayscaleTemplate: jest.fn()
}));

import { setupGlobalEvents, triggerVisualRefresh, resetVisualRefreshTimer } from '../main/events.js';
import { handleCommand } from '../commands/index.js';
import { renderWorld, showRoomBanner, showToast } from '../graphics/renderer.js';

describe('Input Interaction (Cross-platform)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetVisualRefreshTimer();
        global.requestAnimationFrame = (cb) => { cb(); return 1; };
        setupGlobalEvents();
        // Setup a mock player with a menu
        appRuntime.playerEntityId = 1;
        appRuntime.world.setComponent = jest.fn();
        appRuntime.world.removeComponent = jest.fn();
        appRuntime.world.query = jest.fn((components) => {
            if (components.includes(Component.Menu)) return [1];
            return [];
        });
    });

    test('Keyboard/Gamepad: CONFIRM action activates selected menu entry', () => {
        const mockMenu = {
            type: 'shop',
            selectedIndex: 1,
            entries: [
                { label: 'Item 1', action: { kind: 'command', command: 'buy item1' } },
                { label: 'Item 2', action: { kind: 'command', command: 'buy item2' } }
            ]
        };
        appRuntime.world.getComponent = jest.fn((id, comp) => {
            if (comp === Component.Menu) return mockMenu;
            return null;
        });

        bus.emit('input:action', { action: ACTION.CONFIRM, type: 'down' });

        expect(handleCommand).toHaveBeenCalledWith('buy item2');
    });

    test('Mouse/Touch: ui:menu-select activates specific menu entry', () => {
        const mockMenu = {
            type: 'shop',
            selectedIndex: 0,
            entries: [
                { label: 'Item 1', action: { kind: 'command', command: 'buy item1' } },
                { label: 'Item 2', action: { kind: 'command', command: 'buy item2' } }
            ]
        };
        appRuntime.world.getComponent = jest.fn((id, comp) => {
            if (comp === Component.Menu) return mockMenu;
            return null;
        });

        bus.emit('ui:menu-select', { index: 1 });

        expect(handleCommand).toHaveBeenCalledWith('buy item2');
    });

    test('Keyboard: MOVE_S changes selectedIndex', () => {
        const mockMenu = {
            type: 'shop',
            selectedIndex: 0,
            entries: [
                { label: 'Item 1', disabled: false },
                { label: 'Item 2', disabled: false }
            ]
        };
        appRuntime.world.getComponent = jest.fn((id, comp) => {
            if (comp === Component.Menu) return mockMenu;
            return null;
        });

        bus.emit('input:action', { action: ACTION.MOVE_S, type: 'down' });

        expect(mockMenu.selectedIndex).toBe(1);
    });

    test('ui:back closes dialogue without advancing it', () => {
        const { showDialogue, advanceDialogue } = jest.requireMock('../graphics/renderer.js');
        appRuntime.world.query = jest.fn(() => []);
        appRuntime.world.getComponent = jest.fn(() => null);

        bus.emit('ui:back', {});

        expect(advanceDialogue).not.toHaveBeenCalled();
        expect(showDialogue).toHaveBeenCalledWith(null, null);
    });

    test('ui:queue-menu opens immediately when no dialogue is active', () => {
        appRuntime.world.query = jest.fn(() => []);
        appRuntime.world.getComponent = jest.fn(() => null);

        bus.emit('ui:queue-menu', { type: 'crafting', context: {} });

        expect(appRuntime.world.setComponent).toHaveBeenCalledWith(1, Component.Menu, expect.objectContaining({
            type: 'crafting',
        }));
    });

    test('player:move clears the current menu selection', () => {
        appRuntime.world.getComponent = jest.fn((id, comp) => {
            if (comp === Component.Menu) {
                return { type: 'shop', entries: [], selectedIndex: 0 };
            }
            return null;
        });

        bus.emit('player:move', { from: 'market', to: 'tavern' });

        expect(appRuntime.world.removeComponent).toHaveBeenCalledWith(1, Component.Menu);
    });

    test('player:move does not stack a room banner over the persistent room header', () => {
        appRuntime.world.getComponent = jest.fn(() => null);

        bus.emit('player:move', { from: 'forest_edge', to: 'forest_depths' });

        expect(showRoomBanner).not.toHaveBeenCalled();
    });

    test('log events can opt out of toasts for room-entry flavor text', () => {
        bus.emit('log', { msg: 'Spring, weary. Day 7.', color: '#556', toast: false });

        expect(showToast).not.toHaveBeenCalledWith('Spring, weary. Day 7.');
    });

    test('resource fat-finger click walks to actual resource tile', () => {
        localPlayer.location = 'forest_edge';
        appRuntime.world.getComponent = jest.fn((_id, comp) => {
            if (comp === Component.Transform) return { mapId: 'forest_edge', x: 1, y: 1 };
            return null;
        });

        triggerVisualRefresh();
        const clickHandler = renderWorld.mock.calls.at(-1)[1];
        clickHandler(4, 5, { type: 'resource', id: 'resource:forest_edge:5,5', x: 5, y: 5 });

        expect(appRuntime.world.setComponent).toHaveBeenCalledWith(1, Component.MovementTarget, { x: 5, y: 5 });
        expect(appRuntime.world.setComponent).toHaveBeenCalledWith(1, Component.PendingInteract, { x: 5, y: 5, mapId: 'forest_edge' });
    });
});
