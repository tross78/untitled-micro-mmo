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

    test('npc definitions require compiled sprite ids', () => {
        const result = validateContent({
            itemDefinitions: [],
            enemyDefinitions: [],
            roomDefinitions: [],
            npcDefinitions: [{ id: 'broken_npc', name: 'Broken', sprite: 'missing_sprite' }],
            recipeDefinitions: [],
            questDefinitions: [],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('NPC "broken_npc" references missing compiled sprite "missing_sprite"');
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

    test('recipes must reference existing inputs, outputs, and optional locations', () => {
        const result = validateContent({
            itemDefinitions: [{ id: 'wood' }, { id: 'iron' }],
            enemyDefinitions: [],
            roomDefinitions: [],
            npcDefinitions: [],
            recipeDefinitions: [{
                id: 'bad_recipe',
                name: 'Bad Recipe',
                inputs: { wood: 1, missing_ingot: 2 },
                output: 'missing_output',
                location: 'missing_room',
            }],
            questDefinitions: [],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Recipe "bad_recipe" references missing location "missing_room"');
        expect(result.problems).toContain('Recipe "bad_recipe" references missing output item "missing_output"');
        expect(result.problems).toContain('Recipe "bad_recipe" references missing input item "missing_ingot"');
    });

    test('quest references must resolve to authored NPCs and rooms', () => {
        const result = validateContent({
            itemDefinitions: [{ id: 'potion' }],
            enemyDefinitions: [],
            roomDefinitions: [{ id: 'room1', width: 5, height: 5 }],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [{
                id: 'bad_quest',
                giver: 'missing_giver',
                receiver: 'missing_receiver',
                objective: { type: 'explore', target: 'missing_room', count: 1 },
                reward: { item: 'missing_item' },
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Quest "bad_quest" references missing giver "missing_giver"');
        expect(result.problems).toContain('Quest "bad_quest" references missing receiver "missing_receiver"');
        expect(result.problems).toContain('Quest "bad_quest" references missing room target "missing_room"');
        expect(result.problems).toContain('Quest "bad_quest" references missing reward item "missing_item"');
    });

    test('room topology rejects overlapping or out-of-bounds exit footprints', () => {
        const result = validateContent({
            itemDefinitions: [],
            enemyDefinitions: [],
            roomDefinitions: [
                {
                    id: 'bad_room',
                    width: 4,
                    height: 4,
                    exits: { east: 'other_room' },
                    exitTiles: [
                        { x: 3, y: 1, dest: 'other_room', destX: 0, destY: 0, w: 2, h: 1 },
                        { x: 3, y: 1, dest: 'other_room', destX: 0, destY: 0, w: 1, h: 1 },
                    ],
                    scenery: [],
                },
                {
                    id: 'other_room',
                    width: 4,
                    height: 4,
                },
            ],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Room "bad_room" exitTile footprint exceeds source room bounds');
        expect(result.problems).toContain('Room "bad_room" has overlapping exitTiles at "3,1"');
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
