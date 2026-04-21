/**
 * Hearthwick Simulation Rules
 * Pure deterministic, integer-only logic.
 */

/**
 * Seeded PRNG returning a 32-bit unsigned integer.
 */
export function seededRNG(seed) {
    let state = seed | 0;
    return function(max = 4294967296) {
        state = state + 0x6D2B79F5 | 0;
        var t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        const res = (t ^ t >>> 14) >>> 0;
        return max === 4294967296 ? res : res % max;
    }
}

export function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

// --- NARRATIVE ARC MACHINES ---

export const arcTransitions = {
    escalation: {
        seed:        { ESCALATE: 'growth' },
        growth:      { ESCALATE: 'crisis', RESOLVE: 'resolution' },
        crisis:      { PLAYER_ACTS: 'resolution', IGNORE: 'catastrophe' },
        resolution:  { NEW_THREAT: 'seed' },
        catastrophe: { REBUILD: 'seed' }
    },
    mystery: {
        clue_1:      { DISCOVER: 'clue_2' },
        clue_2:      { DISCOVER: 'reveal' },
        reveal:      { ACT: 'consequence' },
        consequence: { RESOLVE: 'clue_1' }
    }
};

export const moodMarkov = {
    'fearful': { fearful: 70, weary: 20, joyful: 10 },
    'weary':   { fearful: 20, weary: 60, joyful: 20 },
    'joyful':  { fearful: 10, weary: 20, joyful: 70 }
};

/**
 * Steps the mood forward using the daily integer RNG.
 */
export function nextMood(currentMood, rng) {
    const roll = rng(100); // 0-99
    const transitions = moodMarkov[currentMood];
    let cumulative = 0;
    for (const mood in transitions) {
        cumulative += transitions[mood];
        if (roll < cumulative) return mood;
    }
    return currentMood;
}

/**
 * Transitions a narrative arc to its next beat.
 */
export function transitionArc(arc, event) {
    const nextBeat = arcTransitions[arc.type]?.[arc.beat]?.[event];
    return nextBeat ? { ...arc, beat: nextBeat } : arc;
}

// --- WORLD DATA ---

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

export function validateMove(currentLocation, direction) {
    const currentRoom = world[currentLocation];
    return currentRoom?.exits[direction] || null;
}
