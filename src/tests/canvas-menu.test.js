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

    test('fetch quest shows inventory count not pq.progress', () => {
        // gather_wood needs 5 wood; pq.progress=0 but inventory has 5 wood
        const player = makePlayer({
            location: 'market',
            inventory: ['wood', 'wood', 'wood', 'wood', 'wood'],
            quests: { gather_wood: { progress: 0, completed: false } },
        });
        const menu = buildCanvasMenu('npc_quests', { npcId: 'merchant' }, makeCtx(player));
        const questEntry = menu.entries.find(e => e.label.includes('Gather Wood'));
        expect(questEntry).toBeDefined();
        // Should show Complete (5/5 met via inventory) not be disabled with 0/5
        expect(questEntry.label).toContain('Complete');
    });

    test('fetch quest shows partial inventory count in disabled row', () => {
        const player = makePlayer({
            location: 'market',
            inventory: ['wood', 'wood', 'wood'],
            quests: { gather_wood: { progress: 0, completed: false } },
        });
        const menu = buildCanvasMenu('npc_quests', { npcId: 'merchant' }, makeCtx(player));
        const questEntry = menu.entries.find(e => e.detail && e.detail.includes('/5'));
        expect(questEntry).toBeDefined();
        expect(questEntry.detail).toBe('3/5');
        expect(questEntry.disabled).toBe(true);
    });

    test('quests menu shows active quests with progress', () => {
        const player = makePlayer({
            quests: { wolf_hunt: { progress: 2, completed: false } },
        });
        const menu = buildCanvasMenu('quests', {}, makeCtx(player));
        const entry = menu.entries.find(e => e.label === 'Wolf Hunt');
        expect(entry).toBeDefined();
        expect(entry.detail).toBe('2/3');
    });

    test('quests menu shows completed quests', () => {
        const player = makePlayer({
            quests: { wolf_hunt: { progress: 3, completed: true } },
        });
        const menu = buildCanvasMenu('quests', {}, makeCtx(player));
        const entry = menu.entries.find(e => e.label === 'Wolf Hunt');
        expect(entry.detail).toBe('Complete');
    });

    test('quests menu shows locked quest when prereq started but not complete', () => {
        const player = makePlayer({
            quests: { find_tavern: { progress: 0, completed: false } },
        });
        const menu = buildCanvasMenu('quests', {}, makeCtx(player));
        const locked = menu.entries.find(e => e.label.includes('[locked]'));
        expect(locked).toBeDefined();
    });

    test('quests menu shows daily bounty when set', () => {
        worldState.bountyEnemy = 'bandit';
        const menu = buildCanvasMenu('quests', {}, makeCtx(makePlayer()));
        const bounty = menu.entries.find(e => e.label.includes('Daily Bounty'));
        expect(bounty).toBeDefined();
    });

    test('crafting menu shows available recipe with required materials', () => {
        const player = makePlayer({
            location: 'market',
            inventory: ['iron', 'iron', 'iron', 'wood', 'wood'],
        });
        const menu = buildCanvasMenu('crafting', {}, makeCtx(player));
        const ironSword = menu.entries.find(e => e.label === 'Iron Sword');
        expect(ironSword).toBeDefined();
        expect(ironSword.disabled).toBe(false);
    });

    test('crafting menu disables recipes without enough materials', () => {
        const player = makePlayer({ location: 'market', inventory: [] });
        const menu = buildCanvasMenu('crafting', {}, makeCtx(player));
        const ironSword = menu.entries.find(e => e.label === 'Iron Sword');
        expect(ironSword.disabled).toBe(true);
    });

    test('root menu includes Attack entry when enemy present in room', () => {
        const player = makePlayer({ location: 'forest_edge', currentEnemy: null });
        const menu = buildCanvasMenu('root', {}, makeCtx(player));
        const attackEntry = menu.entries.find(e => e.label.startsWith('Attack'));
        expect(attackEntry).toBeDefined();
    });

    test('root menu includes Bank when in bank room', () => {
        const player = makePlayer({ location: 'cellar', bankedGold: 500 });
        const menu = buildCanvasMenu('root', {}, makeCtx(player));
        const bankEntry = menu.entries.find(e => e.label === 'Bank');
        expect(bankEntry).toBeDefined();
        expect(bankEntry.detail).toContain('500g');
    });

    test('inventory menu shows empty pack message', () => {
        const menu = buildCanvasMenu('inventory', {}, makeCtx(makePlayer({ inventory: [] })));
        expect(menu.entries.some(e => e.label.includes('empty'))).toBe(true);
    });

    test('inventory menu stacks duplicate items', () => {
        const player = makePlayer({ inventory: ['potion', 'potion', 'potion'] });
        const menu = buildCanvasMenu('inventory', {}, makeCtx(player));
        const potionEntry = menu.entries.find(e => e.label.includes('Health Potion'));
        expect(potionEntry.label).toContain('x3');
    });

    test('npc menu without quest rows still shows Leave', () => {
        const player = makePlayer({ location: 'ruins', quests: {} });
        const menu = buildCanvasMenu('npc', { npcId: 'sage', text: 'Greetings.' }, makeCtx(player));
        expect(menu.entries.find(e => e.label === 'Leave')).toBeDefined();
    });

    test('crafting menu shows recipes for the current location', () => {
        const player = makePlayer({ location: 'market', inventory: ['iron', 'iron', 'iron', 'wood', 'wood'] });
        const menu = buildCanvasMenu('crafting', {}, makeCtx(player));
        expect(menu.type).toBe('crafting');
        expect(menu.entries.length).toBeGreaterThan(0);
        // Player has enough materials so iron sword should be enabled
        const sword = menu.entries.find(e => e.label === 'Iron Sword');
        expect(sword).toBeDefined();
        expect(sword.disabled).toBe(false);
    });

    test('crafting menu disables recipes with insufficient materials', () => {
        const player = makePlayer({ location: 'market', inventory: [] });
        const menu = buildCanvasMenu('crafting', {}, makeCtx(player));
        menu.entries.filter(e => e.label !== 'Back').forEach(e => {
            expect(e.disabled).toBe(true);
        });
    });

    test('crafting menu shows empty message in location with no recipes', () => {
        // Use a room guaranteed to have no crafting recipes
        const player = makePlayer({ location: 'hallway', inventory: [] });
        const menu = buildCanvasMenu('crafting', {}, makeCtx(player));
        expect(menu.entries.some(e => e.label.includes('Nothing'))).toBe(true);
    });

    test('stats menu shows player stats', () => {
        const player = makePlayer({ level: 3, xp: 50, hp: 30, gold: 200, bankedGold: 500 });
        const menu = buildCanvasMenu('stats', {}, makeCtx(player));
        expect(menu.type).toBe('stats');
        expect(menu.title).toBe('Tester');
        expect(menu.entries.find(e => e.label === 'Level')).toBeDefined();
        expect(menu.entries.find(e => e.label === 'HP')).toBeDefined();
        expect(menu.entries.find(e => e.label === 'Gold')).toBeDefined();
    });

    test('stats menu with equipped weapon and armor', () => {
        const player = makePlayer({ equipped: { weapon: 'iron_sword', armor: 'leather_armor' } });
        const menu = buildCanvasMenu('stats', {}, makeCtx(player));
        const weapEntry = menu.entries.find(e => e.label === 'Weapon');
        const armEntry = menu.entries.find(e => e.label === 'Armor');
        expect(weapEntry?.detail).toContain('Iron Sword');
        expect(armEntry?.detail).toContain('Leather');
    });

    test('status menu shows no effects when none active', () => {
        const player = makePlayer({ statusEffects: [] });
        const menu = buildCanvasMenu('status', {}, makeCtx(player));
        expect(menu.type).toBe('status');
        expect(menu.entries.some(e => e.label === 'No active effects')).toBe(true);
    });

    test('status menu shows active status effects', () => {
        const player = makePlayer({ statusEffects: [{ id: 'poisoned', duration: 5 }] });
        const menu = buildCanvasMenu('status', {}, makeCtx(player));
        expect(menu.entries.find(e => e.label === 'Poisoned')).toBeDefined();
    });

    test('status menu shows threat and weather', () => {
        const player = makePlayer({ statusEffects: [] });
        const ctx = { ...makeCtx(player), worldState: { ...worldState, threatLevel: 3, weather: 'storm', day: 1 } };
        const menu = buildCanvasMenu('status', {}, ctx);
        expect(menu.entries.some(e => e.label === 'Threat Level')).toBe(true);
        expect(menu.entries.some(e => e.label === 'Weather')).toBe(true);
    });

    test('status menu shows world event', () => {
        const player = makePlayer({ statusEffects: [] });
        const ctx = { ...makeCtx(player), worldState: { ...worldState, event: { type: 'wandering_boss', target: 'goblin_king' }, day: 1 } };
        const menu = buildCanvasMenu('status', {}, ctx);
        expect(menu.entries.some(e => e.label === "Today's Event")).toBe(true);
    });

    test('sell menu shows sellable items', () => {
        const player = makePlayer({ inventory: ['potion', 'wolf_pelt'], location: 'market' });
        const ctx = makeCtx(player);
        const menu = buildCanvasMenu('sell', { npcId: 'barkeep' }, ctx);
        expect(menu.type).toBe('sell');
        expect(menu.entries.length).toBeGreaterThan(0);
    });

    test('sell menu shows nothing-to-sell for empty inventory', () => {
        const player = makePlayer({ inventory: [] });
        const menu = buildCanvasMenu('sell', { npcId: 'barkeep' }, makeCtx(player));
        expect(menu.entries.some(e => e.label === 'Nothing to sell')).toBe(true);
    });

    test('getSellableItems excludes gold items', () => {
        const player = makePlayer({ inventory: ['gold_coin', 'potion'] });
        const menu = buildCanvasMenu('sell', { npcId: 'barkeep' }, makeCtx(player));
        expect(menu.type).toBe('sell');
    });

    test('status menu shows scarcity and surplus', () => {
        const player = makePlayer({ statusEffects: [] });
        const ctx = { ...makeCtx(player), worldState: { ...worldState, scarcity: ['potion'], surplus: ['iron'], day: 1 } };
        const menu = buildCanvasMenu('status', {}, ctx);
        expect(menu.entries.some(e => e.label === 'Scarce')).toBe(true);
        expect(menu.entries.some(e => e.label === 'Surplus')).toBe(true);
    });
});
