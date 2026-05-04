import { defineRoom } from '../content/define.js';
describe('Phase 8.55c: Scenery Scale and Size Classes', () => {
    test('defineRoom applies canonical dimensions to scenery string', () => {
        const room = defineRoom('test', {
            width: 10, height: 10,
            scenery: "1,1,bookshelf|5,5,tree"
        });

        const shelf = room.scenery.find(s => s.label === 'bookshelf');
        const tree = room.scenery.find(s => s.label === 'tree');

        expect(shelf.w).toBe(2);
        expect(shelf.h).toBe(1);
        expect(tree.w).toBe(3);
        expect(tree.h).toBe(3);
    });

    test('defineRoom applies canonical dimensions to scenery array', () => {
        const room = defineRoom('test', {
            width: 10, height: 10,
            scenery: [{ x: 2, y: 2, label: 'table' }]
        });

        const table = room.scenery.find(s => s.label === 'table');
        expect(table.w).toBe(2);
        expect(table.h).toBe(1);
    });

    test('defineRoom respects explicit size overrides', () => {
        const room = defineRoom('test', {
            width: 10, height: 10,
            scenery: "1,1,tree,5,5" // Explicitly massive tree
        });

        const tree = room.scenery.find(s => s.label === 'tree');
        expect(tree.w).toBe(5);
        expect(tree.h).toBe(5);
    });
});
