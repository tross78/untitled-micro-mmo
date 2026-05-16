import { rooms } from '../content/data/rooms.js';
import { SPAWN_ROOM_ID } from '../content/data.js';

const VALID_ZONES = new Set(['town', 'wilderness', 'dungeon']);
const ZONE_RANK = { town: 0, wilderness: 1, dungeon: 2 };

const roomIds = Object.keys(rooms);

describe('Room connection integrity', () => {
    test('ruins descent stairs no longer trigger catacombs from the north wall', () => {
        const room = rooms.ruins_descent;
        const catacombsExit = (room.exitTiles || []).find((ex) => ex.dest === 'catacombs');

        expect(catacombsExit).toMatchObject({ x: 5, y: 2, type: 'stairs' });
        expect(catacombsExit.y).not.toBe(0);
    });

    test('catacombs separates the central ruins staircase from the north cemetery corridor', () => {
        const room = rooms.catacombs;
        const ruinsExit = (room.exitTiles || []).find((ex) => ex.dest === 'ruins_descent');
        const cemeteryExit = (room.exitTiles || []).find((ex) => ex.dest === 'cemetery');

        expect(ruinsExit).toMatchObject({ x: 7, y: 6, type: 'stairs' });
        expect(cemeteryExit).toMatchObject({ x: 7, y: 0, type: 'edge', w: 3, h: 1 });
        expect(ruinsExit.y).toBeGreaterThan(cemeteryExit.y);
    });

    test('all exit destinations reference existing rooms', () => {
        const broken = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const [dir, dest] of Object.entries(room.exits || {})) {
                if (!rooms[dest]) broken.push(`${id} exits.${dir} → "${dest}" (not found)`);
            }
            for (const ex of room.exitTiles || []) {
                if (!rooms[ex.dest]) broken.push(`${id} exitTile at (${ex.x},${ex.y}) → "${ex.dest}" (not found)`);
            }
        }
        expect(broken).toEqual([]);
    });

    test('all exits have a reciprocal in the destination room', () => {
        const oneWay = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const [dir, dest] of Object.entries(room.exits || {})) {
                if (!rooms[dest]) continue;
                const destExits = rooms[dest].exits || {};
                const hasReturn = Object.values(destExits).includes(id);
                if (!hasReturn) oneWay.push(`${id} → ${dest} (${dir}) has no return exit`);
            }
        }
        expect(oneWay).toEqual([]);
    });

    test('exits logical object and exitTiles agree on destinations', () => {
        const mismatches = [];
        for (const [id, room] of Object.entries(rooms)) {
            const exitDestSet = new Set(Object.values(room.exits || {}));
            const tileDestSet = new Set((room.exitTiles || []).map(e => e.dest));

            for (const dest of exitDestSet) {
                if (!tileDestSet.has(dest)) {
                    mismatches.push(`${id}: exits.* includes "${dest}" but no exitTile references it`);
                }
            }
            for (const dest of tileDestSet) {
                if (!exitDestSet.has(dest)) {
                    mismatches.push(`${id}: exitTile references "${dest}" but exits.* does not include it`);
                }
            }
        }
        expect(mismatches).toEqual([]);
    });

    test('exit tiles lie within this room bounds', () => {
        const oob = [];
        for (const [id, room] of Object.entries(rooms)) {
            const { width: W, height: H } = room;
            for (const ex of room.exitTiles || []) {
                const x2 = ex.x + (ex.w || 1) - 1;
                const y2 = ex.y + (ex.h || 1) - 1;
                if (ex.x < 0 || ex.y < 0 || x2 >= W || y2 >= H) {
                    oob.push(`${id} exitTile → "${ex.dest}" at (${ex.x},${ex.y}) w=${ex.w} h=${ex.h} is outside ${W}×${H}`);
                }
            }
        }
        expect(oob).toEqual([]);
    });

    test('exit tile landing coords lie within destination room bounds', () => {
        const oob = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const ex of room.exitTiles || []) {
                const dest = rooms[ex.dest];
                if (!dest) continue;
                if (ex.destX < 0 || ex.destY < 0 || ex.destX >= dest.width || ex.destY >= dest.height) {
                    oob.push(`${id} exitTile → "${ex.dest}" lands at (${ex.destX},${ex.destY}) but "${ex.dest}" is ${dest.width}×${dest.height}`);
                }
            }
        }
        expect(oob).toEqual([]);
    });

    test('no duplicate exit tiles pointing to the same destination', () => {
        const dupes = [];
        for (const [id, room] of Object.entries(rooms)) {
            const seen = new Map();
            for (const ex of room.exitTiles || []) {
                if (seen.has(ex.dest)) {
                    dupes.push(`${id} has multiple exitTiles pointing to "${ex.dest}"`);
                }
                seen.set(ex.dest, true);
            }
        }
        expect(dupes).toEqual([]);
    });

    test('every room declares a valid zone', () => {
        const bad = [];
        for (const [id, room] of Object.entries(rooms)) {
            if (!VALID_ZONES.has(room.zone)) {
                bad.push(`${id}: zone="${room.zone}" (must be town | wilderness | dungeon)`);
            }
        }
        expect(bad).toEqual([]);
    });

    test('zone transitions never skip a tier', () => {
        const skips = [];
        for (const [id, room] of Object.entries(rooms)) {
            const fromRank = ZONE_RANK[room.zone] ?? 1;
            for (const dest of Object.values(room.exits || {})) {
                const destRoom = rooms[dest];
                if (!destRoom) continue;
                const toRank = ZONE_RANK[destRoom.zone] ?? 1;
                if (Math.abs(fromRank - toRank) > 1) {
                    skips.push(`${id} [${room.zone}] → ${dest} [${destRoom.zone}]`);
                }
            }
        }
        expect(skips).toEqual([]);
    });

    test('all exit landing tiles are passable and have at least one passable neighbor', () => {
        const isBlocked = (room, x, y) => {
            if (x < 0 || y < 0 || x >= room.width || y >= room.height) return true;
            const ov = (room.tileOverrides || []).find(o => o.x === x && o.y === y);
            if (ov?.type === 'wall') return true;
            return (room.scenery || []).some(s =>
                x >= s.x && x < s.x + (s.w || 1) && y >= s.y && y < s.y + (s.h || 1)
            );
        };

        const blocked = [], trapped = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const ex of room.exitTiles || []) {
                const dest = rooms[ex.dest];
                if (!dest) continue;
                const lx = ex.destX, ly = ex.destY;
                if (isBlocked(dest, lx, ly)) {
                    blocked.push(`${id}→${ex.dest} landing (${lx},${ly}) is inside a wall or scenery`);
                } else {
                    const passableNeighbors = [[lx-1,ly],[lx+1,ly],[lx,ly-1],[lx,ly+1]]
                        .filter(([nx, ny]) => !isBlocked(dest, nx, ny));
                    if (passableNeighbors.length === 0) {
                        trapped.push(`${id}→${ex.dest} landing (${lx},${ly}) has no passable neighbors (player trapped)`);
                    }
                }
            }
        }
        expect(blocked).toEqual([]);
        expect(trapped).toEqual([]);
    });

    test('exit tiles in the source room are not themselves wall tiles', () => {
        const bad = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const ex of room.exitTiles || []) {
                // Command-triggered exits (stairs, up/down portals) don't require a walkable tile
                if (['up', 'down', 'stairs'].includes(ex.type)) continue;
                for (let dx = 0; dx < (ex.w || 1); dx++) {
                    for (let dy = 0; dy < (ex.h || 1); dy++) {
                        const x = ex.x + dx, y = ex.y + dy;
                        const ov = (room.tileOverrides || []).find(o => o.x === x && o.y === y);
                        if (ov?.type === 'wall') {
                            bad.push(`${id}: exit tile to "${ex.dest}" at (${x},${y}) is a wall tile — unreachable`);
                        }
                    }
                }
            }
        }
        expect(bad).toEqual([]);
    });

    test('cardinal exit directions have matching opposite reciprocals', () => {
        const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
        const mismatched = [];
        const seen = new Set();
        for (const [id, room] of Object.entries(rooms)) {
            for (const [dir, dest] of Object.entries(room.exits || {})) {
                if (!OPPOSITE[dir]) continue; // skip up/down/custom
                const pairKey = [id, dest].sort().join('|');
                if (seen.has(pairKey)) continue;
                seen.add(pairKey);
                const destRoom = rooms[dest];
                if (!destRoom) continue;
                const returnDir = Object.entries(destRoom.exits || {}).find(([, v]) => v === id)?.[0];
                if (returnDir && returnDir !== OPPOSITE[dir]) {
                    mismatched.push(`${id} (${dir}) → ${dest} returns via (${returnDir}), expected (${OPPOSITE[dir]})`);
                }
            }
        }
        expect(mismatched).toEqual([]);
    });

    test('exit landing coords do not fall on an exit tile in the destination room', () => {
        const bounces = [];
        for (const [id, room] of Object.entries(rooms)) {
            for (const ex of room.exitTiles || []) {
                const dest = rooms[ex.dest];
                if (!dest) continue;
                const lx = ex.destX, ly = ex.destY;
                for (const dex of dest.exitTiles || []) {
                    const x2 = dex.x + (dex.w || 1) - 1;
                    const y2 = dex.y + (dex.h || 1) - 1;
                    if (lx >= dex.x && lx <= x2 && ly >= dex.y && ly <= y2) {
                        bounces.push(`${id}→${ex.dest} lands at (${lx},${ly}) which is on exit tile to ${dex.dest} — player bounces immediately`);
                    }
                }
            }
        }
        expect(bounces).toEqual([]);
    });

    test('every room with spawn feature exists and spawn room is reachable', () => {
        expect(rooms[SPAWN_ROOM_ID]).toBeDefined();
        const spawnRooms = Object.values(rooms).filter(r => r.features?.includes('spawn'));
        expect(spawnRooms.length).toBeGreaterThanOrEqual(1);
    });

    test('all rooms are reachable from the spawn room', () => {
        const visited = new Set();
        const queue = [SPAWN_ROOM_ID];
        visited.add(SPAWN_ROOM_ID);
        while (queue.length) {
            const id = queue.shift();
            const room = rooms[id];
            if (!room) continue;
            for (const dest of Object.values(room.exits || {})) {
                if (!visited.has(dest) && rooms[dest]) {
                    visited.add(dest);
                    queue.push(dest);
                }
            }
        }
        const unreachable = roomIds.filter(id => !visited.has(id));
        expect(unreachable).toEqual([]);
    });
});
