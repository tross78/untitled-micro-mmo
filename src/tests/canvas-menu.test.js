import { buildCanvasMenu, findNearestEnabledIndex } from '../ui/canvas-menu.js';
import { world, NPCS } from '../content/data.js';
import { worldState } from '../state/store.js';

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

const makeCtx = (player, timeOfDay = 'day') => ({
    localPlayer: player,
    world,
    getNPCsAt: (location) => {
        const room = world[location];
        return (room?.staticEntities || []).map((entry) => entry.id);
    },
    getTimeOfDay: () => timeOfDay,
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

    test('inventory menu turns consumables into actionable entries', () => {
        const menu = buildCanvasMenu('inventory', {}, makeCtx(makePlayer({ inventory: ['potion', 'iron_sword'] })));
        expect(menu.entries.find((entry) => entry.label.startsWith('Health Potion')).action.command).toBe('use health potion');
        expect(menu.entries.find((entry) => entry.label.startsWith('Iron Sword')).action.command).toBe('equip iron sword');
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
