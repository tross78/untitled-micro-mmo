import { validateMove, world } from './rules';

describe('Game Rules: Movement', () => {
    test('should allow moving to a valid exit', () => {
        const nextLoc = validateMove('cellar', 'north');
        expect(nextLoc).toBe('hallway');
    });

    test('should return null for an invalid exit', () => {
        const nextLoc = validateMove('cellar', 'south');
        expect(nextLoc).toBe(null);
    });

    test('should return null for a non-existent room', () => {
        const nextLoc = validateMove('void', 'north');
        expect(nextLoc).toBe(null);
    });

    test('all exits should lead to existing rooms', () => {
        for (const roomId in world) {
            const room = world[roomId];
            for (const direction in room.exits) {
                const targetId = room.exits[direction];
                expect(world[targetId]).toBeDefined();
            }
        }
    });
});
