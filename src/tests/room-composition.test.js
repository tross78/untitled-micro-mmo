import { ROOM_BIBLE, world as ROOMS } from '../content/data.js';

const getLabels = (room) => new Set((room.scenery || []).map((sc) => sc.label));
const getWaterTiles = (room) => (room.tileOverrides || []).filter((tile) => tile.type === 'water');

describe('room composition contract', () => {
    const cases = [
        ['tavern', ['counter', 'fireplace', 'table', 'chair']],
        ['market', ['well', 'stall']],
        ['crossroads', ['sign']],
        ['mill', ['wheel']],
        ['herbalist_hut', ['cauldron', 'bookshelf']],
        ['cave', ['ore', 'rock']],
        ['harbour', ['anchor', 'crate']],
        ['sea_cave', ['shell', 'rock']],
        ['ruins', ['altar', 'pillar']],
        ['catacombs', ['candle', 'grave']],
        ['throne_room', ['crown', 'pillar']],
    ];

    test.each(cases)('%s keeps the intended anchor props', (roomId, expectedLabels) => {
        const room = ROOMS[roomId];
        expect(room).toBeDefined();
        expect(ROOM_BIBLE[roomId]).toBeDefined();

        const labels = getLabels(room);
        for (const label of expectedLabels) {
            expect(labels.has(label)).toBe(true);
        }
    });

    test('cave water footprint stays irregular rather than filling a rectangle', () => {
        const room = ROOMS.cave;
        expect(room).toBeDefined();

        const water = getWaterTiles(room);
        expect(water.length).toBeGreaterThan(0);

        const xs = water.map((t) => t.x);
        const ys = water.map((t) => t.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);

        expect(water.length).toBeLessThan(bboxArea);
    });
});
