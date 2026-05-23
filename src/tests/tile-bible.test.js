import { TILE_TAXONOMY } from '../infra/graphics-constants.js';
import { TILE_BIBLE, SCENERY_AUTHORING_RULES } from '../content/data/tile-bible.js';
import { validateContent } from '../content/validate.js';

describe('tile bible', () => {
    test('covers every tile taxonomy entry with a descriptive guide', () => {
        const tileIds = Object.values(TILE_TAXONOMY).flat();
        tileIds.forEach((tileId) => {
            expect(TILE_BIBLE[tileId]).toBeDefined();
            expect(TILE_BIBLE[tileId].description).toEqual(expect.any(String));
            expect(TILE_BIBLE[tileId].description.length).toBeGreaterThan(10);
        });
    });

    test('covers the common authored scenery set with placement rules', () => {
        ['tree', 'shrub', 'torch', 'barrel', 'bookshelf', 'well', 'stairs'].forEach((label) => {
            expect(SCENERY_AUTHORING_RULES[label]).toBeDefined();
            expect(SCENERY_AUTHORING_RULES[label].description).toEqual(expect.any(String));
        });
    });
});

describe('tile placement validation', () => {
    const baseDefs = () => ({
        itemDefinitions: [],
        enemyDefinitions: [],
        roomDefinitions: [],
        npcDefinitions: [],
        recipeDefinitions: [],
        questDefinitions: [],
    });

    test('flags an indoor shrub as visually out of place', () => {
        const result = validateContent({
            ...baseDefs(),
            roomDefinitions: [{
                id: 'tavern',
                zone: 'town',
                width: 8,
                height: 8,
                scenery: [{ x: 3, y: 3, label: 'shrub' }],
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('Room "tavern" places "shrub" in a context the tile bible does not support');
    });

    test('flags a centered torch as a bad placement', () => {
        const result = validateContent({
            ...baseDefs(),
            roomDefinitions: [{
                id: 'hallway',
                zone: 'town',
                width: 9,
                height: 9,
                scenery: [{ x: 4, y: 4, label: 'torch' }],
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('[warn] Room "hallway" places "torch" away from a wall or edge');
    });

    test('flags an isolated one-tile water speck', () => {
        const result = validateContent({
            ...baseDefs(),
            roomDefinitions: [{
                id: 'lake',
                zone: 'wilderness',
                width: 7,
                height: 7,
                tileOverrides: [{ x: 3, y: 3, type: 'water' }],
            }],
        });

        expect(result.ok).toBe(false);
        expect(result.problems).toContain('[warn] Room "lake" contains an isolated one-tile water patch at (3,3)');
    });
});
