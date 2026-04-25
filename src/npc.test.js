import { getNPCLocation, getNPCDialogue } from './rules';
import { NPCS, DIALOGUE_POOLS } from './data';

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
    });

    test('NPC dialogue can include mood-specific lines', () => {
        // We might need to try a few days to find a mood-specific line (30% chance)
        let foundMoodLine = false;
        for (let day = 1; day < 20; day++) {
            const dialogue = getNPCDialogue('sage', seed, day, 'joyful');
            if (DIALOGUE_POOLS.joyful.includes(dialogue)) {
                foundMoodLine = true;
                break;
            }
        }
        expect(foundMoodLine).toBe(true);
    });
});
