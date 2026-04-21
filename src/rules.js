/**
 * Hearthwick Simulation Rules
 * Deterministic, integer-only logic.
 */

export function seededRNG(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

export function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash;
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
    'fearful': { fearful: 70, weary: 20, joyful: 10 }, // Expressed as percentages for integer math
    'weary':   { fearful: 20, weary: 60, joyful: 20 },
    'joyful':  { fearful: 10, weary: 20, joyful: 70 }
};

/**
 * Steps the mood forward using the daily RNG and integer math.
 */
export function nextMood(currentMood, rng) {
    const roll = Math.floor(rng() * 100);
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
