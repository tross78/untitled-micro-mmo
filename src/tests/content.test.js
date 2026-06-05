import { commandDefinitions } from '../content/commands.js';
import { ITEMS, SCARCITY_ITEMS, QUESTS, NPCS, world as ROOMS } from '../content/data.js';
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

    test('placement integrity flags overlaps, water/wall props, and covered exits', () => {
        const result = validateContent({
            itemDefinitions: [],
            enemyDefinitions: [],
            npcDefinitions: [],
            recipeDefinitions: [],
            questDefinitions: [],
            roomDefinitions: [{
                id: 'qa_room', name: 'QA', zone: 'dungeon', width: 5, height: 5,
                exits: {},
                tileOverrides: [{ x: 2, y: 2, type: 'wall' }, { x: 3, y: 3, type: 'water' }],
                scenery: [
                    { x: 1, y: 1, label: 'rock', w: 1, h: 1 },
                    { x: 1, y: 1, label: 'bones', w: 1, h: 1 },
                    { x: 3, y: 3, label: 'rock', w: 1, h: 1 },
                    { x: 2, y: 2, label: 'crate', w: 1, h: 1 },
                    { x: 3, y: 1, label: 'bookshelf', w: 2, h: 1 },
                    { x: 3, y: 0, label: 'barrel', w: 1, h: 1 },
                ],
                staticEntities: [{ id: 'qa_npc', x: 2, y: 2 }],
                enemy: 'qa_enemy', enemyX: 3, enemyY: 3,
                exitTiles: [{ x: 2, y: 2, dest: 'qa_room', destX: 3, destY: 3, type: 'edge', w: 1, h: 1 }],
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Room "qa_room" has overlapping scenery at (1,1): "rock" and "bones"');
        expect(result.problems).toContain('Room "qa_room" places "rock" on a water tile at (3,3)');
        expect(result.problems).toContain('Room "qa_room" NPC "qa_npc" stands on a wall tile at (2,2)');
        expect(result.problems).toContain('Room "qa_room" enemy "qa_enemy" spawns in water at (3,3)');
        expect(result.problems).toContain('Room "qa_room" exit to "qa_room" is covered by a wall at (2,2)');
        expect(result.problems).toContain('Room "qa_room" exit to "qa_room" lands the player in water at (3,3)');
        expect(result.problems).toContain('Room "qa_room" places solid prop "crate" inside a wall at (2,2)');
        expect(result.problems).toContain('Room "qa_room" tall prop "bookshelf" at (3,1) is overlapped by "barrel" directly above at (3,0)');
    });

    test('clutter validator flags an over-propped room', () => {
        const result = validateContent({
            itemDefinitions: [], enemyDefinitions: [], npcDefinitions: [], recipeDefinitions: [], questDefinitions: [],
            roomDefinitions: [{
                id: 'cram', name: 'Cram', zone: 'town', width: 4, height: 4, exits: {},
                scenery: [
                    { x: 0, y: 0, label: 'rock', w: 1, h: 1 }, { x: 1, y: 0, label: 'rock', w: 1, h: 1 },
                    { x: 2, y: 0, label: 'rock', w: 1, h: 1 }, { x: 0, y: 1, label: 'rock', w: 1, h: 1 },
                    { x: 2, y: 1, label: 'rock', w: 1, h: 1 }, { x: 0, y: 2, label: 'rock', w: 1, h: 1 },
                    { x: 1, y: 2, label: 'rock', w: 1, h: 1 }, { x: 3, y: 3, label: 'rock', w: 1, h: 1 },
                ],
            }],
        });
        expect(result.ok).toBe(false);
        expect(result.problems.some((p) => p.startsWith('Room "cram" is overcluttered'))).toBe(true);
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

describe('contract: room exit resolution', () => {
    test('every room exit id resolves to a defined room', () => {
        const roomIds = new Set(Object.keys(ROOMS));
        const broken = [];
        for (const [roomId, room] of Object.entries(ROOMS)) {
            for (const [dir, targetId] of Object.entries(room.exits || {})) {
                if (!roomIds.has(targetId)) {
                    broken.push(`Room "${roomId}" exit "${dir}" → "${targetId}" does not exist`);
                }
            }
        }
        expect(broken).toEqual([]);
    });
});

describe('contract: NPC shop stock integrity', () => {
    test('every item id in NPC shop arrays exists in ITEMS', () => {
        const broken = [];
        for (const [npcId, npc] of Object.entries(NPCS)) {
            for (const itemId of npc.shop || []) {
                if (!ITEMS[itemId]) {
                    broken.push(`NPC "${npcId}" shop lists item "${itemId}" which is not in ITEMS`);
                }
            }
        }
        expect(broken).toEqual([]);
    });
});

describe('contract: quest prerequisite resolution', () => {
    test('every quest prerequisite id resolves to a defined quest', () => {
        const questIds = new Set(Object.keys(QUESTS));
        const broken = [];
        for (const [questId, quest] of Object.entries(QUESTS)) {
            const prereqs = Array.isArray(quest.prerequisite)
                ? quest.prerequisite
                : quest.prerequisite ? [quest.prerequisite] : [];
            for (const prereqId of prereqs) {
                if (!questIds.has(prereqId)) {
                    broken.push(`Quest "${questId}" prerequisite "${prereqId}" does not exist`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    test('explore quests do not target the room where their giver is authored', () => {
        const npcAuthoredRooms = new Map();
        for (const [roomId, room] of Object.entries(ROOMS)) {
            for (const entry of room.staticEntities || []) {
                if (!npcAuthoredRooms.has(entry.id)) npcAuthoredRooms.set(entry.id, new Set());
                npcAuthoredRooms.get(entry.id).add(roomId);
            }
        }
        for (const [npcId, npc] of Object.entries(NPCS)) {
            if (!npcAuthoredRooms.has(npcId)) npcAuthoredRooms.set(npcId, new Set());
            if (npc.home) npcAuthoredRooms.get(npcId).add(npc.home);
        }

        const broken = [];
        for (const [questId, quest] of Object.entries(QUESTS)) {
            if (quest.objective?.type !== 'explore' || !quest.giver) continue;
            const giverRooms = npcAuthoredRooms.get(quest.giver) || new Set();
            if (giverRooms.has(quest.objective.target)) {
                broken.push(`Quest "${questId}" explores giver "${quest.giver}" room "${quest.objective.target}"`);
            }
        }
        expect(broken).toEqual([]);
    });

    test('fetch and craft quests do not reward the same item they ask for', () => {
        const broken = [];
        for (const [questId, quest] of Object.entries(QUESTS)) {
            if (!['fetch', 'craft'].includes(quest.objective?.type)) continue;
            if (quest.reward?.item === quest.objective.target) {
                broken.push(`Quest "${questId}" rewards objective item "${quest.objective.target}"`);
            }
        }
        expect(broken).toEqual([]);
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
