import { jest } from '@jest/globals';
import { handleMiscCommands } from '../commands/misc.js';
import { handleInventoryCommands } from '../commands/inventory.js';
import { log } from '../ui/index.js';

jest.mock('../ui/index.js', () => ({
    log: jest.fn(),
    printStatus: jest.fn()
}));

jest.mock('../state/persistence.js', () => ({ saveLocalState: jest.fn() }));
jest.mock('../graphics/renderer.js', () => ({
    showItemFanfare: jest.fn(),
    showToast: jest.fn(),
}));
jest.mock('../state/eventbus.js', () => ({ bus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() } }));

describe('Phase 8.5e: Onboarding and Help', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('help command outputs movement, combat, and NPC sections', async () => {
        await handleMiscCommands('help', []);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Movement'), '#ffa500');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Combat'), '#ffa500');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('NPC'), '#ffa500');
    });

    test('help command does not mention removed commands', async () => {
        await handleMiscCommands('help', []);
        const calls = log.mock.calls.map(c => c[0]).join('\n');
        expect(calls).not.toMatch(/\bvision\b/);
        expect(calls).not.toMatch(/\bsay\b/);
        expect(calls).not.toMatch(/\bemote\b/);
        expect(calls).not.toMatch(/\btrade\b/);
        expect(calls).not.toMatch(/\bduel\b/);
    });

    test('help-controls is a recognized command definition', async () => {
        const { commandDefinitions } = await import('../content/commands.js');
        const controls = commandDefinitions.find(c => c.id === 'help-controls');
        expect(controls).toBeDefined();
        expect(controls.category).toBe('misc');
    });

    test('cellar room has a static NPC to guide new players', async () => {
        const { world } = await import('../content/data.js');
        const cellar = world['cellar'];
        expect(cellar).toBeDefined();
        expect(cellar.staticEntities).toBeDefined();
        expect(cellar.staticEntities.length).toBeGreaterThan(0);
    });

    test('cellar guard NPC exists with onboarding dialogue', async () => {
        const { NPCS } = await import('../content/data.js');
        const guide = NPCS['cellar_guard'];
        expect(guide).toBeDefined();
        expect(guide.baseDialogue).toMatch(/north|tavern/i);
    });

    test('intended first-session rooms all exist and are connected', async () => {
        const { world } = await import('../content/data.js');
        const arc = ['cellar', 'hallway', 'tavern', 'market', 'herbalist_hut', 'forest_edge', 'ruins'];
        for (const locId of arc) {
            expect(world[locId]).toBeDefined();
        }
        // cellar -> hallway
        expect(world['cellar'].exits?.north).toBe('hallway');
        // hallway -> tavern
        expect(world['hallway'].exits?.north).toBe('tavern');
        // tavern -> market
        expect(Object.values(world['tavern'].exits || {})).toContain('market');
        // crossroads connects to forest and herbalist
        expect(Object.values(world['crossroads'].exits || {})).toContain('forest_edge');
        expect(Object.values(world['crossroads'].exits || {})).toContain('herbalist_hut');
        // forest_edge connects to ruins
        expect(Object.values(world['forest_edge'].exits || {})).toContain('ruins');
    });

    test('map command lists visited rooms', async () => {
        await handleMiscCommands('map', []);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('WORLD MAP'), '#ffa500');
    });
});

describe('Phase 8.5e: Core sustain loop — bread-baking → herbalist → forest', () => {
    let localPlayer;

    beforeEach(async () => {
        jest.clearAllMocks();
        const store = await import('../state/store.js');
        localPlayer = store.localPlayer;
        localPlayer.location = 'mill';
        localPlayer.inventory = ['wheat', 'wheat'];
        localPlayer.quests = {};
        localPlayer.hp = 50;
        localPlayer.maxHp = 50;
        localPlayer.forestFights = 15;
    });

    test('craft bread at the mill consumes wheat and adds bread to inventory', async () => {
        await handleInventoryCommands('craft', ['craft', 'bread']);
        expect(localPlayer.inventory).toContain('bread');
        expect(localPlayer.inventory.filter(id => id === 'wheat').length).toBe(0);
    });

    test('herbalist_hut exists and sells potion (healing item for forest loop)', async () => {
        const { world, NPCS } = await import('../content/data.js');
        expect(world['herbalist_hut']).toBeDefined();
        const herbalist = Object.values(NPCS).find(n => n.home === 'herbalist_hut');
        expect(herbalist).toBeDefined();
        expect(herbalist.shop).toBeDefined();
        const { ITEMS } = await import('../content/data.js');
        const healItems = herbalist.shop.filter(id => ITEMS[id]?.heal > 0);
        expect(healItems.length).toBeGreaterThan(0);
    });

    test('forest_edge room exists, has an enemy, and connects to ruins', async () => {
        const { world } = await import('../content/data.js');
        const forest = world['forest_edge'];
        expect(forest).toBeDefined();
        expect(forest.enemy).toBeDefined();
        expect(Object.values(forest.exits || {})).toContain('ruins');
    });

    test('bread heals player hp (usable as sustain item in forest loop)', async () => {
        const { ITEMS } = await import('../content/data.js');
        expect(ITEMS['bread']).toBeDefined();
        expect(ITEMS['bread'].heal).toBeGreaterThan(0);
    });
});
