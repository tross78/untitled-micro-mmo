import { jest } from '@jest/globals';
import { handleMiscCommands } from '../commands/misc.js';
import { log } from '../ui/index.js';

jest.mock('../ui/index.js', () => ({
    log: jest.fn(),
    printStatus: jest.fn()
}));

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
