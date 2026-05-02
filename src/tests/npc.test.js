import { getNPCLocation, getNPCDialogue } from '../rules/index.js';
import { NPCS } from '../engine/data.js';

describe('Deterministic NPC Logic', () => {
    const seed = 'test-seed';
    
    test('NPCs with no patrol stay at home', () => {
        expect(getNPCLocation('barkeep', seed, 1)).toBe('tavern');
        expect(getNPCLocation('barkeep', seed, 100)).toBe('tavern');
    });

    test('NPCs with patrol move deterministically', () => {
        const loc1 = getNPCLocation('guard', seed, 1);
        const loc2 = getNPCLocation('guard', seed, 2);
        
        // They should be in one of their patrol/home rooms
        const validRooms = [NPCS.guard.home, ...NPCS.guard.patrol];
        expect(validRooms).toContain(loc1);
        expect(validRooms).toContain(loc2);
        
        // Consistency check: same seed + same day = same location
        expect(getNPCLocation('guard', seed, 1)).toBe(loc1);
    });

    test('NPC dialogue selection is deterministic', () => {
        const d1 = getNPCDialogue('sage', seed, 1, 'joyful');
        const d2 = getNPCDialogue('sage', seed, 1, 'joyful');
        expect(d1).toBe(d2);
        expect(d1.length).toBeGreaterThan(0);
    });

    test('NPC dialogue differs across days', () => {
        const d1 = getNPCDialogue('sage', seed, 1, 'joyful');
        const d2 = getNPCDialogue('sage', seed, 2, 'joyful');
        expect(d1).not.toBe(d2);
    });
});
