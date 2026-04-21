/**
 * Hearthwick Simulation Rules
 * Pure deterministic, integer-only logic.
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
    },
    rivalry: {
        meet:        { CONFLICT: 'conflict' },
        conflict:    { ESCALATE: 'escalation', TRUCE: 'truce' },
        escalation:  { WIN: 'dominance', NEGOTIATE: 'truce' },
        dominance:   { CHALLENGE: 'meet' },
        truce:       { BREAK: 'conflict' }
    },
    downfall: {
        hubris:      { WARNING: 'warning' },
        warning:     { IGNORE: 'collapse', HEED: 'hubris' },
        collapse:    { SURVIVE: 'aftermath' },
        aftermath:   { REBUILD: 'hubris' }
    },
    bounty: {
        emergence:   { HUNT: 'hunt' },
        hunt:        { CLIMAX: 'climax' },
        climax:      { RESOLVE: 'resolution' },
        resolution:  { NEW_CYCLE: 'emergence' }
    }
};

export const moodMarkov = {
    'fearful': { fearful: 70, weary: 20, joyful: 10 },
    'weary':   { fearful: 20, weary: 60, joyful: 20 },
    'joyful':  { fearful: 10, weary: 20, joyful: 70 }
};

export function nextMood(currentMood, rng) {
    const roll = rng(100);
    const transitions = moodMarkov[currentMood] || moodMarkov['weary'];
    let cumulative = 0;
    for (const mood in transitions) {
        cumulative += transitions[mood];
        if (roll < cumulative) return mood;
    }
    return currentMood;
}

export function transitionArc(arc, event) {
    const nextBeat = arcTransitions[arc.type]?.[arc.beat]?.[event];
    return nextBeat ? { ...arc, beat: nextBeat } : arc;
}

// --- COMBAT ---

export const ENEMIES = {
    forest_wolf: { name: 'Forest Wolf',  hp: 20, attack: 5,  defense: 1, xp: 15, loot: ['wolf_pelt'] },
    ruin_shade:  { name: 'Ruin Shade',   hp: 25, attack: 8,  defense: 0, xp: 25, loot: ['old_tome', 'gold'] },
    cave_troll:  { name: 'Cave Troll',   hp: 40, attack: 10, defense: 3, xp: 40, loot: ['iron_key', 'gold'] },
};

export const ITEMS = {
    wolf_pelt:  { name: 'Wolf Pelt',      type: 'material' },
    old_tome:   { name: 'Old Tome',       type: 'material' },
    iron_key:   { name: 'Iron Key',       type: 'key' },
    gold:       { name: 'Gold (5)',        type: 'gold', amount: 5 },
    potion:     { name: 'Health Potion',  type: 'consumable', heal: 20 },
    iron_sword: { name: 'Iron Sword',     type: 'weapon', bonus: 3 },
};

// Integer-only damage roll: 1 to 2*(base), minimum 1
export function resolveAttack(attackStat, defenseStat, rng) {
    const base = Math.max(1, attackStat - defenseStat);
    return (rng(base * 2) + 1) | 0;
}

export function rollLoot(enemyType, rng) {
    const enemy = ENEMIES[enemyType];
    if (!enemy) return [];
    return enemy.loot.filter(() => rng(100) < 60);
}

export function xpToLevel(xp) {
    return (Math.floor(Math.sqrt((xp / 10) | 0)) + 1) | 0;
}

// Flat stat bonuses from level
export function levelBonus(level) {
    return {
        attack: (level - 1) * 2,
        defense: (level - 1) | 0,
        maxHp: (level - 1) * 10,
    };
}

export const DEFAULT_PLAYER_STATS = {
    hp: 50, maxHp: 50,
    attack: 10, defense: 3,
    xp: 0, level: 1,
    gold: 0,
    inventory: [],
    combatRound: 0,
    currentEnemy: null,
};

// --- WORLD DATA ---

export const world = {
    cellar: {
        name: 'The Cellar',
        description: 'A damp cellar. Crates line the walls. A door leads north.',
        exits: { north: 'hallway' },
        enemy: null,
    },
    hallway: {
        name: 'The Hallway',
        description: 'A narrow passage. The cellar is south, the tavern north, the forest east.',
        exits: { south: 'cellar', north: 'tavern', east: 'forest_edge' },
        enemy: null,
    },
    tavern: {
        name: 'The Rusty Flagon',
        description: 'Smoke and low voices. The market is east, the hallway south.',
        exits: { south: 'hallway', east: 'market' },
        enemy: null,
    },
    market: {
        name: 'The Market Square',
        description: 'Stalls and haggling. The tavern is west.',
        exits: { west: 'tavern' },
        enemy: null,
    },
    forest_edge: {
        name: 'The Forest Edge',
        description: 'Twisted pines. A wolf watches from the dark. The hallway is west, ruins north.',
        exits: { west: 'hallway', north: 'ruins' },
        enemy: 'forest_wolf',
    },
    ruins: {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south.',
        exits: { south: 'forest_edge' },
        enemy: 'ruin_shade',
    },
};

export function validateMove(currentLocation, direction) {
    return world[currentLocation]?.exits[direction] || null;
}
