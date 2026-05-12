import { buildCanvasMenu, findNearestEnabledIndex } from '../ui/canvas-menu.js';
import { world, NPCS } from '../content/data.js';
import { worldState } from '../state/store.js';
import { getAudioSettings } from '../engine/audio.js';

jest.mock('../engine/audio.js', () => ({
    getAudioSettings: jest.fn(() => ({ muted: false, music: 0.5, sfx: 0.7 })),
}));

const makePlayer = (overrides = {}) => ({
    name: 'Tester',
    location: 'market',
    x: 8,
    y: 7,
    level: 1,
    hp: 50,
    maxHp: 50,
    gold: 100,
    inventory: [],
    quests: {},
    currentEnemy: null,
    bankedGold: 0,
    ...overrides,
});

const makeCtx = (player, timeOfDay = 'day', extra = {}) => ({
    localPlayer: player,
    world,
    getNPCsAt: (location) => {
        const room = world[location];
        return (room?.staticEntities || []).map((entry) => entry.id);
    },
    getTimeOfDay: () => timeOfDay,
    ...extra,
});

describe('canvas menu builder', () => {
    beforeEach(() => {
        worldState.scarcity = [];
        worldState.event = null;
    });

    test('merchant npc menu exposes buy path', () => {
        const menu = buildCanvasMenu('npc', { npcId: 'merchant', text: 'Finest wares.' }, makeCtx(makePlayer()));
        expect(menu.title).toBe(NPCS.merchant.name);
        expect(menu.entries.some((entry) => entry.label === 'Buy')).toBe(true);
    });

    test('shop menu disables items the player cannot afford', () => {
        const menu = buildCanvasMenu('shop', { npcId: 'merchant' }, makeCtx(makePlayer({ gold: 5 })));
        const sword = menu.entries.find((entry) => entry.label.startsWith('Iron Sword'));
        expect(sword.disabled).toBe(true);
    });

    test('shop menu reflects scarcity-adjusted prices', () => {
        worldState.scarcity = ['wheat'];
        const menu = buildCanvasMenu('shop', { npcId: 'merchant' }, makeCtx(makePlayer({ gold: 4 })));
        const wheat = menu.entries.find((entry) => entry.label.startsWith('Wheat Bundle'));
        expect(wheat.label).toBe('Wheat Bundle - 5g');
        expect(wheat.detail).toContain('scarce');
        expect(wheat.disabled).toBe(true);
    });

    test('wandering_trader adds rare wares to the merchant shop menu', () => {
        worldState.event = { type: 'wandering_trader' };
        const menu = buildCanvasMenu('shop', { npcId: 'merchant' }, makeCtx(makePlayer({ gold: 500 })));
        expect(menu.entries.some((entry) => entry.label.startsWith('Old Tome'))).toBe(true);
        expect(menu.entries.some((entry) => entry.label.startsWith('Steel Sword'))).toBe(true);
    });

    test('inventory menu turns consumables into actionable entries', () => {
        const menu = buildCanvasMenu('inventory', {}, makeCtx(makePlayer({ inventory: ['potion', 'iron_sword'] })));
        expect(menu.entries.find((entry) => entry.label.startsWith('Health Potion')).action.command).toBe('use health potion');
        expect(menu.entries.find((entry) => entry.label.startsWith('Iron Sword')).action.command).toBe('equip iron sword');
    });

    test('root menu exposes core actions and close affordance', () => {
        const player = makePlayer({
            location: 'market',
            inventory: ['potion'],
            currentEnemy: null,
            level: 4,
        });
        const menu = buildCanvasMenu('root', {}, makeCtx(player));

        expect(menu.entries.map((entry) => entry.label)).toEqual(expect.arrayContaining([
            'Inventory',
            'Quests',
            'Craft',
            'Rest',
            'Stats',
            'Status',
            'Map',
            'Audio',
            'Close',
        ]));
    });

    test('move menu only includes supported directions plus back', () => {
        const menu = buildCanvasMenu('move', {}, makeCtx(makePlayer({ location: 'cellar' })));
        expect(menu.entries.map((entry) => entry.label)).toEqual(expect.arrayContaining(['North', 'Back']));
        expect(menu.entries.some((entry) => entry.label === 'South')).toBe(false);
    });

    test('status menu surfaces threat, scarcity, and surplus state', () => {
        worldState.scarcity = ['wheat'];
        worldState.surplus = ['potion'];
        const player = makePlayer({ location: 'market' });
        const menu = buildCanvasMenu('status', {}, makeCtx(player, 'day', { worldState: { threatLevel: 1, scarcity: ['wheat'], surplus: ['potion'] } }));

        expect(menu.entries.some((entry) => entry.label === 'Threat Level')).toBe(true);
        expect(menu.entries.some((entry) => entry.label === 'Scarce')).toBe(true);
        expect(menu.entries.some((entry) => entry.label === 'Surplus')).toBe(true);
    });

    test('audio menu reflects mute state and returns back', () => {
        getAudioSettings.mockReturnValueOnce({ muted: true, music: 0.25, sfx: 0.5 });
        const menu = buildCanvasMenu('audio', {}, makeCtx(makePlayer()));

        expect(menu.entries[0].label).toBe('Unmute Audio');
        expect(menu.entries.some((entry) => entry.label === 'Back')).toBe(true);
    });

    test('sell menu lists tradable inventory items', () => {
        const menu = buildCanvasMenu('sell', { npcId: 'merchant' }, makeCtx(makePlayer({ inventory: ['potion', 'iron_sword', 'gold'] })));
        expect(menu.entries.some((entry) => entry.label.startsWith('Health Potion'))).toBe(true);
        expect(menu.entries.some((entry) => entry.label.startsWith('Iron Sword'))).toBe(true);
        expect(menu.entries.some((entry) => entry.label === 'Back')).toBe(true);
    });

    test('selection skips disabled rows', () => {
        const entries = [
            { label: 'A', disabled: false },
            { label: 'B', disabled: true },
            { label: 'C', disabled: false },
        ];
        expect(findNearestEnabledIndex(entries, 0, 1)).toBe(2);
        expect(findNearestEnabledIndex(entries, 2, -1)).toBe(0);
    });
});
