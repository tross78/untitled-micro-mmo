import { validateContent } from '../content/validate.js';

describe('Phase 8.5 corrective: Unified Traversability Validation', () => {
    const mockData = {
        itemDefinitions: [],
        enemyDefinitions: [],
        roomDefinitions: [
            {
                id: 'room_a',
                width: 10,
                height: 10,
                exits: { east: 'room_b' },
                exitTiles: [
                    { x: 5, y: 5, dest: 'room_b', destX: 2, destY: 2 } // Has safe landing nearby
                ],
                tileOverrides: [],
                scenery: []
            },
            {
                id: 'room_b',
                width: 5,
                height: 5,
                exits: { west: 'room_a' },
                tileOverrides: [
                    { x: 2, y: 2, type: 'wall' } // 2,2 is blocked but neighbors are open
                ],
                scenery: []
            },
            {
                id: 'heavily_blocked_room',
                width: 10,
                height: 10,
                exitTiles: [
                    { x: 5, y: 5, dest: 'wall_room', destX: 5, destY: 5 } 
                ],
                tileOverrides: [],
                scenery: []
            },
            {
                id: 'wall_room',
                width: 11,
                height: 11,
                tileOverrides: [
                    // Surround (5,5) with a 7x7 block of walls (radius 3+)
                    { x: 2, y: 2, type: 'wall' }, { x: 3, y: 2, type: 'wall' }, { x: 4, y: 2, type: 'wall' }, { x: 5, y: 2, type: 'wall' }, { x: 6, y: 2, type: 'wall' }, { x: 7, y: 2, type: 'wall' }, { x: 8, y: 2, type: 'wall' },
                    { x: 2, y: 3, type: 'wall' }, { x: 3, y: 3, type: 'wall' }, { x: 4, y: 3, type: 'wall' }, { x: 5, y: 3, type: 'wall' }, { x: 6, y: 3, type: 'wall' }, { x: 7, y: 3, type: 'wall' }, { x: 8, y: 3, type: 'wall' },
                    { x: 2, y: 4, type: 'wall' }, { x: 3, y: 4, type: 'wall' }, { x: 4, y: 4, type: 'wall' }, { x: 5, y: 4, type: 'wall' }, { x: 6, y: 4, type: 'wall' }, { x: 7, y: 4, type: 'wall' }, { x: 8, y: 4, type: 'wall' },
                    { x: 2, y: 5, type: 'wall' }, { x: 3, y: 5, type: 'wall' }, { x: 4, y: 5, type: 'wall' }, { x: 5, y: 5, type: 'wall' }, { x: 6, y: 5, type: 'wall' }, { x: 7, y: 5, type: 'wall' }, { x: 8, y: 5, type: 'wall' },
                    { x: 2, y: 6, type: 'wall' }, { x: 3, y: 6, type: 'wall' }, { x: 4, y: 6, type: 'wall' }, { x: 5, y: 6, type: 'wall' }, { x: 6, y: 6, type: 'wall' }, { x: 7, y: 6, type: 'wall' }, { x: 8, y: 6, type: 'wall' },
                    { x: 2, y: 7, type: 'wall' }, { x: 3, y: 7, type: 'wall' }, { x: 4, y: 7, type: 'wall' }, { x: 5, y: 7, type: 'wall' }, { x: 6, y: 7, type: 'wall' }, { x: 7, y: 7, type: 'wall' }, { x: 8, y: 7, type: 'wall' },
                    { x: 2, y: 8, type: 'wall' }, { x: 3, y: 8, type: 'wall' }, { x: 4, y: 8, type: 'wall' }, { x: 5, y: 8, type: 'wall' }, { x: 6, y: 8, type: 'wall' }, { x: 7, y: 8, type: 'wall' }, { x: 8, y: 8, type: 'wall' }
                ],
                scenery: []
            }
        ],
        npcDefinitions: [],
        questDefinitions: [],
        recipeDefinitions: []
    };

    test('passes if exit lands near walkable tile via findSafeArrival', () => {
        const result = validateContent(mockData);
        // room_a -> room_b lands at (2,2) which is a wall, but findSafeArrival finds (2,1)
        const problem = result.problems.find(p => p.includes('room_a') && p.includes('no safe landing'));
        expect(problem).toBeUndefined();
    });

    test('detects exit with NO safe landing nearby', () => {
        const result = validateContent(mockData);
        const problem = result.problems.find(p => p.includes('heavily_blocked_room') && p.includes('no safe landing'));
        expect(problem).toBeDefined();
    });

    test('detects blocked cardinal exit source', () => {
        const wallRoomData = {
            ...mockData,
            roomDefinitions: [
                {
                    id: 'blocked_source',
                    width: 5, height: 5,
                    exits: { north: 'room_a' },
                    tileOverrides: [
                        { x: 0, y: 0, type: 'wall' }, { x: 1, y: 0, type: 'wall' }, { x: 2, y: 0, type: 'wall' },
                        { x: 3, y: 0, type: 'wall' }, { x: 4, y: 0, type: 'wall' },
                        { x: 0, y: 1, type: 'wall' }, { x: 1, y: 1, type: 'wall' }, { x: 2, y: 1, type: 'wall' }, { x: 3, y: 1, type: 'wall' }, { x: 4, y: 1, type: 'wall' },
                        { x: 0, y: 2, type: 'wall' }, { x: 1, y: 2, type: 'wall' }, { x: 2, y: 2, type: 'wall' }, { x: 3, y: 2, type: 'wall' }, { x: 4, y: 2, type: 'wall' },
                        { x: 0, y: 3, type: 'wall' }, { x: 1, y: 3, type: 'wall' }, { x: 2, y: 3, type: 'wall' }, { x: 3, y: 3, type: 'wall' }, { x: 4, y: 3, type: 'wall' }
                    ]
                },
                mockData.roomDefinitions[0]
            ]
        };
        const result = validateContent(wallRoomData);
        expect(result.problems.find(p => p.includes('blocked_source') && p.includes('north exit source center is blocked'))).toBeDefined();
    });
});
