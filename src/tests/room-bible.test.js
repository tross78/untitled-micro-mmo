import { ROOM_BIBLE, world as ROOMS } from '../content/data.js';

describe('room bible coverage', () => {
    test('every authored room has a room bible entry with core fields', () => {
        const missing = [];
        for (const roomId of Object.keys(ROOMS)) {
            const brief = ROOM_BIBLE[roomId];
            if (!brief) {
                missing.push(roomId);
                continue;
            }
            expect(typeof brief.summary).toBe('string');
            expect(brief.summary.length).toBeGreaterThan(0);
            expect(typeof brief.anchor).toBe('string');
            expect(brief.anchor.length).toBeGreaterThan(0);
            expect(typeof brief.circulation).toBe('string');
            expect(brief.circulation.length).toBeGreaterThan(0);
            expect(Array.isArray(brief.goodProps)).toBe(true);
            expect(Array.isArray(brief.badProps)).toBe(true);
        }
        expect(missing).toEqual([]);
    });
});
