/**
 * @jest-environment jsdom
 *
 * Tests for src/ui.js — uiState lifecycle and the room-transition
 * submenu-freeze bug fixed in Phase 7.88.
 */

import { jest } from '@jest/globals';

jest.mock('@trystero-p2p/torrent', () => ({
    joinRoom: jest.fn(),
    selfId: 'test-peer-id',
}));

import { bus } from '../state/eventbus.js';
import { renderActionButtons, _getUiState, _resetUiState } from '../ui/index.js';
import { world, NPCS, ENEMIES, ITEMS, QUESTS } from '../engine/data.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDOM() {
    document.body.innerHTML = `
        <div id="action-buttons"></div>
        <div id="status-left"></div>
        <div id="status-center"></div>
        <div id="status-right"></div>
        <div id="debug-console" class="is-hidden"></div>
    `;
}

function makeCtx(locOverride = 'tavern', playerOverrides = {}, extra = {}) {
    return {
        localPlayer: {
            name: 'Tester', location: locOverride,
            x: 5, y: 5, level: 1, xp: 0, hp: 50, maxHp: 50, gold: 100,
            forestFights: 15, inventory: [], quests: {}, equipped: {},
            statusEffects: [], buffs: {}, currentEnemy: null,
            ...playerOverrides,
        },
        world,
        NPCS,
        worldState: { seed: 'test', day: 1, mood: 'calm', season: 'spring', seasonNumber: 1, threatLevel: 1, scarcity: [], event: null, weather: 'clear' },
        getNPCLocation: (id) => NPCS[id]?.home ?? null,
        ENEMIES, ITEMS, QUESTS,
        pendingTrade: null,
        pendingDuel: null,
        players: new Map(),
        shardEnemies: new Map(),
        ...extra,
    };
}

function actionButtons() {
    return Array.from(document.querySelectorAll('.action-btn')).map(b => b.textContent);
}

function clickBtn(label) {
    const el = Array.from(document.querySelectorAll('.action-btn')).find(b => b.textContent === label);
    if (!el) throw new Error(`Button not found: "${label}" — visible: [${actionButtons().join(', ')}]`);
    el.click();
}

// ── uiState bus wiring ────────────────────────────────────────────────────────

describe('uiState bus wiring', () => {
    beforeEach(() => { 
        setupDOM(); 
        _resetUiState(); 
        // Need to ensure setupGlobalEvents is called if we want to test the actual listener,
        // but here we just want to test if the toggle logic works.
    });

    test('starts at root', () => {
        expect(_getUiState()).toBe('root');
    });

    test('Tilde (~) toggles debug-console visibility', () => {
        const consoleEl = document.getElementById('debug-console');
        // Initial state from shell.js (is-hidden by default)
        consoleEl.classList.add('is-hidden');
        
        const event = new KeyboardEvent('keydown', { key: '~' });
        
        // Since setupGlobalEvents is a side-effect, we can manually trigger it
        // or just test the logic. Let's test if the listener we added works.
        // We need to re-import or trigger the setup.
        const { setupGlobalEvents } = require('../main/events.js');
        setupGlobalEvents();
        
        window.dispatchEvent(event);
        expect(consoleEl.classList.contains('is-hidden')).toBe(false);
        
        window.dispatchEvent(event);
        expect(consoleEl.classList.contains('is-hidden')).toBe(true);
    });

    test('ui:back resets to root from any state', () => {
        renderActionButtons(makeCtx(), jest.fn());
        clickBtn('Move 🧭');
        expect(_getUiState()).toBe('move');
        bus.emit('ui:back', {});
        expect(_getUiState()).toBe('root');
    });

    test('player:move resets to root — Phase 7.88 regression', () => {
        // Simulate being in a submenu before a room transition
        renderActionButtons(makeCtx('market'), jest.fn());
        clickBtn('Buy 💰');
        expect(_getUiState()).toBe('buy');

        // Room transition fires — must reset to root
        bus.emit('player:move', { from: 'market', to: 'tavern' });
        expect(_getUiState()).toBe('root');
    });

    test('player:move from root stays at root', () => {
        expect(_getUiState()).toBe('root');
        bus.emit('player:move', { from: 'tavern', to: 'market' });
        expect(_getUiState()).toBe('root');
    });
});

// ── renderActionButtons DOM output ────────────────────────────────────────────

describe('renderActionButtons DOM output', () => {
    beforeEach(() => { setupDOM(); _resetUiState(); });

    test('root state always includes Move and Say', () => {
        renderActionButtons(makeCtx('tavern'), jest.fn());
        const btns = actionButtons();
        expect(btns).toContain('Move 🧭');
        expect(btns).toContain('Say 🗣️');
    });

    test('talk submenu in tavern shows NPC names then Back', () => {
        renderActionButtons(makeCtx('tavern'), jest.fn());
        clickBtn('Move 🧭');   // move to move state to confirm submenus work
        bus.emit('ui:back', {});
        renderActionButtons(makeCtx('tavern'), jest.fn());
        clickBtn('Talk 💬');
        const btns = actionButtons();
        expect(btns).toContain('Barkeep');
        expect(btns).toContain('Back ⬅️');
        expect(btns).not.toContain('Move 🧭');
    });

    test('buy submenu in market shows merchant shop items', () => {
        renderActionButtons(makeCtx('market'), jest.fn());
        clickBtn('Buy 💰');
        const btns = actionButtons();
        expect(btns.some(b => b.startsWith('Iron Sword'))).toBe(true);
        expect(btns).toContain('Back ⬅️');
    });

    test('pending duel renders accept and decline buttons on root', () => {
        renderActionButtons(makeCtx('tavern', {}, {
            pendingDuel: {
                challengerId: 'peer-123',
                challengerName: 'Rival',
                expiresAt: Date.now() + 60000,
                day: 1,
            }
        }), jest.fn());

        const btns = actionButtons();
        expect(btns.some(b => b.startsWith('Accept Duel vs Rival'))).toBe(true);
        expect(btns).toContain('Decline Duel');
    });

    test('no Buy button in rooms with no shop NPC', () => {
        renderActionButtons(makeCtx('forest_edge'), jest.fn());
        expect(actionButtons()).not.toContain('Buy 💰');
    });

    test('move submenu lists room exits with Back', () => {
        renderActionButtons(makeCtx('tavern'), jest.fn());
        clickBtn('Move 🧭');
        const btns = actionButtons();
        expect(btns).toContain('Back ⬅️');
        // At least one directional button must exist
        const dirLabels = ['North', 'South', 'East', 'West', 'Up', 'Down'];
        expect(btns.some(b => dirLabels.some(d => b.includes(d)))).toBe(true);
    });

    test('renderActionButtons does not throw for any room in world', () => {
        Object.keys(world).forEach(roomId => {
            _resetUiState();
            expect(() => renderActionButtons(makeCtx(roomId), jest.fn())).not.toThrow();
        });
    });

    test('after player:move reset, root state renders correctly in new room', () => {
        // Enter buy submenu in market
        renderActionButtons(makeCtx('market'), jest.fn());
        clickBtn('Buy 💰');
        expect(_getUiState()).toBe('buy');

        // Room transition resets state
        bus.emit('player:move', { from: 'market', to: 'tavern' });
        expect(_getUiState()).toBe('root');

        // Re-render in new room — should show root buttons
        renderActionButtons(makeCtx('tavern'), jest.fn());
        const btns = actionButtons();
        expect(btns).toContain('Move 🧭');
        expect(btns).toContain('Say 🗣️');
        expect(btns).toContain('Rest 💤');
    });
});
