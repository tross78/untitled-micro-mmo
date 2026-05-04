import { commandDefinitions } from '../content/commands.js';
import { ITEMS, SCARCITY_ITEMS } from '../content/data.js';
import { validateContent } from '../content/validate.js';
import { getCommandDefinition, parseCommandInput } from '../commands/registry.js';
import * as defs from '../content/index.js';

describe('content validation', () => {
    test('current content definitions validate cleanly', () => {
        const result = validateContent(defs);
        if (!result.ok) {
            console.log('Validation problems:', JSON.stringify(result.problems, null, 2));
        }
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
    });

    test('scarcity items all resolve to defined item ids', () => {
        SCARCITY_ITEMS.forEach((itemId) => {
            expect(ITEMS[itemId]).toBeDefined();
        });
    });

    test('fetch quest targets must have at least one acquisition source', () => {
        const result = validateContent({
            itemDefinitions: [{ id: 'mystery_box' }],
            enemyDefinitions: [],
            roomDefinitions: [],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [{
                id: 'bad_fetch',
                giver: null,
                receiver: null,
                objective: { type: 'fetch', target: 'mystery_box', count: 1 },
                reward: {},
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Quest "bad_fetch" targets item "mystery_box" but no acquisition source is defined');
    });

    test('forage sources only count when a room actually authors sceneryScatter', () => {
        const missingForage = validateContent({
            itemDefinitions: [{ id: 'herbs' }],
            enemyDefinitions: [],
            roomDefinitions: [],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [{
                id: 'herb_fetch',
                giver: null,
                receiver: null,
                objective: { type: 'fetch', target: 'herbs', count: 1 },
                reward: {},
            }],
        });
        expect(missingForage.ok).toBe(false);
        expect(missingForage.problems).toContain('Quest "herb_fetch" targets item "herbs" but no acquisition source is defined');

        const withForage = validateContent({
            itemDefinitions: [{ id: 'herbs' }],
            enemyDefinitions: [],
            roomDefinitions: [{
                id: 'meadow',
                width: 5,
                height: 5,
                sceneryScatter: [{ type: 'flora', label: 'herbs', count: [1, 1] }],
            }],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [{
                id: 'herb_fetch',
                giver: null,
                receiver: null,
                objective: { type: 'fetch', target: 'herbs', count: 1 },
                reward: {},
            }],
        });
        expect(withForage.problems).not.toContain('Quest "herb_fetch" targets item "herbs" but no acquisition source is defined');
    });
});

describe('command registry', () => {
    test('canonical command ids are unique', () => {
        const ids = commandDefinitions.map((definition) => definition.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('aliases resolve to canonical definitions', () => {
        expect(getCommandDefinition('get')?.id).toBe('pickup');
        expect(getCommandDefinition('go')?.id).toBe('move');
    });

    test('pruned social commands are no longer part of the public command surface', () => {
        expect(getCommandDefinition('say')).toBeUndefined();
        expect(getCommandDefinition('wave')).toBeUndefined();
        expect(getCommandDefinition('bow')).toBeUndefined();
        expect(getCommandDefinition('cheer')).toBeUndefined();
        expect(getCommandDefinition('vision')).toBeUndefined();
    });

    test('command input parser strips slash and lowercases lookup id', () => {
        const parsed = parseCommandInput('/Go North');
        expect(parsed.raw).toBe('Go North');
        expect(parsed.commandId).toBe('go');
        expect(parsed.args).toEqual(['Go', 'North']);
    });
});
