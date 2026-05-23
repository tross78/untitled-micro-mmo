import { defineRoom, shapePool } from '../content/define.js';
import { validateContent } from '../content/validate.js';
import { SCENERY_DIMENSIONS } from '../infra/graphics-constants.js';
import { getScatteredContent } from '../rules/world.js';

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
            exitTiles: [
                { x: 7, y: 0, dest: 'other', destX: 5, destY: 9 },
                { x: 7, y: 14, dest: 'other', destX: 5, destY: 0 },
                { x: 14, y: 7, dest: 'other', destX: 0, destY: 5 },
                { x: 0, y: 7, dest: 'other', destX: 9, destY: 5 }
            ],
            terrain: { floor: 'grass', density: 30, clutter: ['tree'] }
        });

        // Mock a full definition set for validateContent
        const defs = {
            itemDefinitions: [],
            enemyDefinitions: [],
            roomDefinitions: [
                room, 
                { 
                    id: 'other', width: 10, height: 10,
                    exits: { south: 'forest_test', north: 'forest_test', west: 'forest_test', east: 'forest_test' },
                    exitTiles: [{ x: 5, y: 5, dest: 'forest_test' }]
                }
            ],
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

    test('pool shaping generates deterministic irregular pools', () => {
        const pool = { x: 5, y: 5, rx: 3, ry: 2, taper: 'south', irregularity: 0.2 };
        const a = shapePool(pool, 'pool_test');
        const b = shapePool(pool, 'pool_test');

        expect(a).toEqual(b);
        expect(a.length).toBeGreaterThan(0);
        expect(a.length).toBeLessThan(25);
        expect(a.some((cell) => cell.x === 5 && cell.y === 5 && cell.type === 'water')).toBe(true);
        expect(a.some((cell) => cell.x === 1 && cell.y === 1)).toBe(false);
    });

    test('pool shaping preserves custom pool types', () => {
        const icePool = shapePool({ x: 5, y: 5, rx: 3, ry: 2, type: 'ice' }, 'ice_pool_test');
        const sandPool = shapePool({ x: 5, y: 5, rx: 3, ry: 2, type: 'sand' }, 'sand_pool_test');

        expect(icePool.every((cell) => cell.type === 'ice')).toBe(true);
        expect(sandPool.every((cell) => cell.type === 'sand')).toBe(true);
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

    test('generated clutter applies composition caps to avoid prop spam', () => {
        const room = defineRoom('rock_spam_test', {
            id: 'rock_spam_test',
            width: 25,
            height: 25,
            exits: { north: 'other', south: 'other', east: 'other', west: 'other' },
            terrain: { floor: 'forest', density: 100, clutter: ['rock'] }
        });

        const rocks = room.scenery.filter((s) => s.label === 'rock');
        expect(rocks.length).toBeGreaterThan(0);
        expect(rocks.length).toBeLessThanOrEqual(10);
    });

    test('weekly scatter avoids walls, exits, static entities, and scenery footprints', () => {
        const room = defineRoom('scatter_guard_test', {
            id: 'scatter_guard_test',
            width: 9,
            height: 9,
            exitTiles: [{ x: 4, y: 0, dest: 'other', destX: 4, destY: 8, w: 1, h: 1 }],
            staticEntities: [{ id: 'npc1', x: 2, y: 2 }],
            scenery: [{ x: 5, y: 4, label: 'tree' }],
            tileOverrides: [
                { x: 0, y: 0, type: 'wall' },
                { x: 1, y: 0, type: 'wall' },
                { x: 7, y: 7, type: 'water' }
            ],
            sceneryScatter: [{ type: 'flora', label: 'mushroom', count: [12, 12] }]
        });

        const blocked = new Set(['4,0', '2,2', '0,0', '1,0', '7,7']);
        for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 3; dx++) blocked.add(`${5 + dx},${4 + dy}`);
        }

        const scattered = getScatteredContent(room.id, 7, room);
        scattered.forEach((entry) => {
            expect(blocked.has(`${entry.x},${entry.y}`)).toBe(false);
        });
    });

});
