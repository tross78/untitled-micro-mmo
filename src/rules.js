export const world = {
    'cellar': {
        name: 'The Cellar',
        description: 'A damp, dark cellar. There is a wooden door to the north.',
        exits: { north: 'hallway' }
    },
    'hallway': {
        name: 'The Hallway',
        description: 'A long, narrow hallway. The cellar is to the south.',
        exits: { south: 'cellar' }
    }
};

/**
 * Validates if a move is legal and returns the new location.
 * @param {string} currentLocation 
 * @param {string} direction 
 * @returns {string|null} The new location or null if invalid.
 */
export function validateMove(currentLocation, direction) {
    const currentRoom = world[currentLocation];
    if (currentRoom && currentRoom.exits[direction]) {
        return currentRoom.exits[direction];
    }
    return null;
}
