import { defineRoom } from '../content/define.js';
import { validateContent } from '../content/validate.js';
import { SCENERY_DIMENSIONS } from '../infra/graphics-constants.js';

describe('Phase 8.5c: Constrained Terrain Generation', () => {
    const roomConfig = {
        id: 'test_gen_room',
        width: 10,
        height: 10,
        exits: { north: 'other', south: 'other' },
        terrain: { floor: 'grass', density: 20, clutter: ['tree', 'shrub'] }
    };

    test('Generation is deterministic', () => {
        const room1 = defineRoom('test_gen_room', { ...roomConfig });
        const room2 = defineRoom('test_gen_room', { ...roomConfig });

        expect(room1.tileOverrides).toEqual(room2.tileOverrides);
        expect(room1.scenery).toEqual(room2.scenery);
    });

    test('Boundary walls respect exits', () => {
        const room = defineRoom('test_gen_room', { ...roomConfig });
        
        // North exit at (5,0) should be walkable
        const northExit = room.tileOverrides.find(t => t.x === 5 && t.y === 0 && t.type === 'wall');
        expect(northExit).toBeUndefined();

        // Corner (0,0) should be a wall
        const corner = room.tileOverrides.find(t => t.x === 0 && t.y === 0 && t.type === 'wall');
        expect(corner).toBeDefined();
    });

    test('Generated rooms pass traversability validation', () => {
        const room = defineRoom('forest_test', {
            id: 'forest_test',
            width: 15,
            height: 15,
            exits: { north: 'other', south: 'other', east: 'other', west: 'other' },
            terrain: { floor: 'grass', density: 30, clutter: ['tree'] }
        });

        // Mock a full definition set for validateContent
        const defs = {
            itemDefinitions: [],
            enemyDefinitions: [],
            roomDefinitions: [room, { id: 'other', width: 10, height: 10 }],
            npcDefinitions: [],
            questDefinitions: [],
            recipeDefinitions: []
        };

        const result = validateContent(defs);
        if (!result.ok) {
            console.log('Traversability failed for generated room:', result.problems);
        }
        expect(result.ok).toBe(true);
    });

    test('Paths between multiple exitTiles are preserved', () => {
        const room = defineRoom('path_test', {
            id: 'path_test',
            width: 20,
            height: 20,
            exitTiles: [
                { x: 2, y: 2, dest: 'a' },
                { x: 17, y: 17, dest: 'b' }
            ],
            terrain: { floor: 'stone_floor', density: 40, clutter: ['rock'] }
        });

        // Ensure no walls or scenery block (2,2) or (17,17)
        const blockA = room.tileOverrides.find(t => t.x === 2 && t.y === 2 && t.type === 'wall') ||
                       room.scenery.find(s => s.x === 2 && s.y === 2);
        const blockB = room.tileOverrides.find(t => t.x === 17 && t.y === 17 && t.type === 'wall') ||
                       room.scenery.find(s => s.x === 17 && s.y === 17);

        expect(blockA).toBeFalsy();
        expect(blockB).toBeFalsy();
    });

    test('generated clutter uses canonical dimensions instead of tiny fallback props', () => {
        const room = defineRoom('generated_scale_test', {
            id: 'generated_scale_test',
            width: 20,
            height: 20,
            exits: { north: 'other', south: 'other' },
            terrain: { floor: 'forest', density: 50, clutter: ['tree', 'shrub'] }
        });

        const generatedTree = room.scenery.find((s) => s.label === 'tree');
        const generatedShrub = room.scenery.find((s) => s.label === 'shrub');

        expect(generatedTree).toBeDefined();
        expect(generatedTree.w).toBe(SCENERY_DIMENSIONS.tree[0]);
        expect(generatedTree.h).toBe(SCENERY_DIMENSIONS.tree[1]);
        expect(generatedShrub).toBeDefined();
        expect(generatedShrub.w).toBe(SCENERY_DIMENSIONS.shrub[0]);
        expect(generatedShrub.h).toBe(SCENERY_DIMENSIONS.shrub[1]);
    });

    test('generated scenery never overlaps exits or static entities', () => {
        const room = defineRoom('occupied_path_test', {
            id: 'occupied_path_test',
            width: 12,
            height: 12,
            exits: { north: 'other', south: 'other', east: 'other', west: 'other' },
            exitTiles: [{ x: 5, y: 0, dest: 'other', destX: 5, destY: 11 }],
            staticEntities: [{ id: 'npc1', x: 6, y: 6 }],
            terrain: { floor: 'grass', density: 80, clutter: ['tree', 'shrub', 'rock'] }
        });

        const blocked = new Set([
            '5,0',
            '6,6',
        ]);

        room.scenery.forEach((s) => {
            for (let dy = 0; dy < s.h; dy++) {
                for (let dx = 0; dx < s.w; dx++) {
                    expect(blocked.has(`${s.x + dx},${s.y + dy}`)).toBe(false);
                }
            }
        });
    });

    test('generated scenery fits inside room bounds', () => {
        const room = defineRoom('edge_fit_test', {
            id: 'edge_fit_test',
            width: 11,
            height: 11,
            exits: { north: 'other', south: 'other' },
            terrain: { floor: 'forest', density: 100, clutter: ['tree', 'shrub'] }
        });

        room.scenery.forEach((s) => {
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.y).toBeGreaterThanOrEqual(0);
            expect(s.x + s.w).toBeLessThanOrEqual(room.width);
            expect(s.y + s.h).toBeLessThanOrEqual(room.height);
        });
    });

});
