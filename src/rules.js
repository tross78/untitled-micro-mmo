/**
 * Lightweight seeded PRNG (mulberry32)
 * @param {number} seed 
 * @returns {function} A function that returns a random number between 0 and 1.
 */
export function seededRNG(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/**
 * Simple string hash for seeding
 * @param {string} str 
 * @returns {number}
 */
export function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

export const world = {
    'cellar': {
        id: 1,
        name: 'The Cellar',
        description: 'A damp, dark cellar. There is a wooden door to the north.',
        exits: { north: 'hallway' }
    },
    'hallway': {
        id: 2,
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

