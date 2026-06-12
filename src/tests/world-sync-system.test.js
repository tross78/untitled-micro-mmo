import { WorldSyncSystem } from '../systems/world-sync-system.js';

// Only the pure placement/path helpers are under test — no stores needed.
const makeSystem = () => new WorldSyncSystem({}, {}, {});

const room = {
    width: 10,
    height: 10,
    tileOverrides: [
        { x: 3, y: 3, type: 'wall' },
        { x: 5, y: 5, type: 'water' },
        { x: 5, y: 6, type: 'water' },
    ],
    exitTiles: [{ x: 4, y: 0, w: 2, h: 1, dest: 'elsewhere' }],
    scenery: [{ x: 7, y: 7, w: 2, h: 1, label: 'barrel' }],
};

describe('WorldSyncSystem placement helpers', () => {
    test('isWalkable blocks walls, water, scenery, exit tiles, and OOB', () => {
        const walkable = makeSystem().isWalkable(room);
        expect(walkable(2, 2)).toBe(true);
        expect(walkable(3, 3)).toBe(false);  // wall
        expect(walkable(5, 5)).toBe(false);  // water — movement rejects it, so placement must too
        expect(walkable(7, 7)).toBe(false);  // scenery footprint
        expect(walkable(4, 0)).toBe(false);  // exit tile — NPC/enemy must never path onto a portal
        expect(walkable(5, 0)).toBe(false);  // exit tile (w:2)
        expect(walkable(-1, 0)).toBe(false);
        expect(walkable(0, 10)).toBe(false);
    });

    test('generatePatrol only emits cells movement will accept', () => {
        const system = makeSystem();
        const walkable = system.isWalkable(room);
        for (const seed of [1, 7, 12345, 0xffffffff]) {
            const path = system.generatePatrol(2, 2, seed, room);
            expect(path.length).toBeGreaterThan(0);
            for (const p of path.slice(1)) {
                expect(walkable(p.x, p.y)).toBe(true);
            }
        }
    });

    test('dynamicNpcPosition stays in bounds for hash values >= 2^31 (guard/cellar regression)', () => {
        const system = makeSystem();
        // Before the >>> fix, hash('guard' + 'cellar') >> 4 went negative and the
        // guard was placed at y = -3 — out of bounds and invisible.
        const pos = system.dynamicNpcPosition('guard', 'cellar', room);
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x).toBeLessThan(room.width);
        expect(pos.y).toBeGreaterThanOrEqual(0);
        expect(pos.y).toBeLessThan(room.height);
        expect(system.isWalkable(room)(pos.x, pos.y)).toBe(true);
    });

    test('dynamicNpcPosition lands on a walkable cell for every patrol NPC/room combo', async () => {
        const { NPCS } = await import('../content/data/npcs.js');
        const { rooms } = await import('../content/data/rooms.js');
        const system = makeSystem();
        for (const [id, npc] of Object.entries(NPCS)) {
            for (const rid of npc.patrol || []) {
                const r = rooms[rid];
                if (!r) continue;
                if ((r.staticEntities || []).some((se) => se.id === id)) continue;
                const pos = system.dynamicNpcPosition(id, rid, r);
                expect(system.isWalkable(r)(pos.x, pos.y)).toBe(true);
            }
        }
    });
});
