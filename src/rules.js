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

// --- SEASON ---

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LENGTH = 30; // days per season

export function getSeason(day) {
    return SEASONS[(Math.floor((day - 1) / SEASON_LENGTH) | 0) % 4];
}

export function getSeasonNumber(day) {
    return (Math.floor((day - 1) / (SEASON_LENGTH * 4)) | 0) + 1;
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

export const ARC_START_BEATS = {
    escalation: 'seed',
    mystery:    'clue_1',
    rivalry:    'meet',
    downfall:   'hubris',
    bounty:     'emergence',
};

export const ARC_AUTO_EVENTS = ['IGNORE', 'NEW_CYCLE', 'ESCALATE', 'REBUILD'];

export const SEASON_ARC_BIAS = {
    spring: ['mystery'],
    summer: ['rivalry'],
    autumn: ['bounty', 'downfall'],
    winter: ['escalation', 'downfall'],
};

export function transitionArc(arc, event) {
    const nextBeat = arcTransitions[arc.type]?.[arc.beat]?.[event];
    return nextBeat ? { ...arc, beat: nextBeat } : arc;
}

// --- MOOD ---

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

// --- MARKET SCARCITY ---

export const SCARCITY_ITEMS = ['wheat', 'medicine', 'wood', 'iron', 'bread', 'cloth'];

export function rollScarcity(rng, season) {
    const count = rng(3); // 0, 1, or 2 scarce items
    const pool = [...SCARCITY_ITEMS];
    // Fisher-Yates shuffle with seeded RNG
    for (let i = pool.length - 1; i > 0; i--) {
        const j = rng(i + 1) | 0;
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, count);
}

// --- SIMULATION: WORLD AS PURE FUNCTION ---

export const MOOD_INITIAL = 'weary';
export const EVENT_TYPES = { MOVE: 'm', KILL: 'k', DEATH: 'd', NEWS: 'n', PVP_CHALLENGE: 'pc', PVP_ACCEPT: 'pa', PVP_RESULT: 'pr' };

// Per-seed mood sequences: extend lazily, never recompute. ~6 bytes/day retained.
const _moodSeqs = new Map();
export const _resetMoodCache = () => _moodSeqs.clear(); // test isolation only
export function getMood(worldSeed, day) {
    let seq = _moodSeqs.get(worldSeed);
    if (!seq) { seq = [MOOD_INITIAL]; _moodSeqs.set(worldSeed, seq); }
    for (let d = seq.length; d < day; d++)
        seq.push(nextMood(seq[d - 1], seededRNG(hashStr(worldSeed + d + 'daytick'))));
    return seq[day - 1] ?? MOOD_INITIAL;
}

export function getThreatLevel(day) {
    return Math.min(5, Math.floor(day / 7));
}

export function deriveWorldState(worldSeed, day) {
    const rng = seededRNG(hashStr(worldSeed + day + 'daytick'));
    const season = getSeason(day);
    return {
        seed: worldSeed,
        day,
        season,
        seasonNumber: getSeasonNumber(day),
        mood: getMood(worldSeed, day),
        threatLevel: getThreatLevel(day),
        scarcity: rollScarcity(rng, season),
    };
}

export const NARRATIVE_EVENTS = [
    "A thick fog rolls into the town square.",
    "The tavern was unusually quiet last night.",
    "A rogue merchant was spotted near the ruins.",
    "The crops seem to be growing well this season.",
    "Faint music was heard coming from the cellar.",
    "A strange owl was seen watching the hallway."
];

export function deriveNarrative(worldSeed, day) {
    const rng = seededRNG(hashStr(worldSeed + day + 'news'));
    return NARRATIVE_EVENTS[rng(NARRATIVE_EVENTS.length) | 0];
}

// --- COMBAT ---

export const ENEMIES = {
    forest_wolf: { name: 'Forest Wolf', hp: 20, attack: 5,  defense: 1, xp: 15, loot: ['wolf_pelt', 'potion'] },
    ruin_shade:  { name: 'Ruin Shade',  hp: 25, attack: 8,  defense: 0, xp: 25, loot: ['old_tome', 'gold', 'potion'] },
    cave_troll:  { name: 'Cave Troll',  hp: 40, attack: 10, defense: 3, xp: 40, loot: ['iron_key', 'gold', 'iron_sword'] },
};

export const ITEMS = {
    wolf_pelt:  { name: 'Wolf Pelt',     type: 'material' },
    old_tome:   { name: 'Old Tome',      type: 'material' },
    iron_key:   { name: 'Iron Key',      type: 'key' },
    gold:       { name: 'Gold (5)',       type: 'gold',       amount: 5 },
    potion:     { name: 'Health Potion', type: 'consumable',  heal: 20 },
    iron_sword: { name: 'Iron Sword',    type: 'weapon',      bonus: 3 },
};

// Integer-only damage roll: 1 to 2*base, minimum 1
export function resolveAttack(attackStat, defenseStat, rng) {
    const base = Math.max(1, attackStat - defenseStat);
    return (rng(base * 2) + 1) | 0;
}

export function rollLoot(enemyType, rng) {
    const enemy = ENEMIES[enemyType];
    if (!enemy) return [];
    return enemy.loot.filter(() => (rng(100) | 0) < 60);
}

export function xpToLevel(xp) {
    return (Math.floor(Math.sqrt((xp / 10) | 0)) + 1) | 0;
}

export function levelBonus(level) {
    return {
        attack:  (level - 1) * 2,
        defense: (level - 1) | 0,
        maxHp:   (level - 1) * 10,
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

// --- SCALING & SHARDING ---
export const INSTANCE_CAP = 50;
export const getShardName = (appId, loc, inst) => `${loc}-${inst}`;

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
        description: 'Twisted pines. A wolf watches from the dark. The hallway is west, ruins north, a cave south.',
        exits: { west: 'hallway', north: 'ruins', south: 'cave' },
        enemy: 'forest_wolf',
    },
    ruins: {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south.',
        exits: { south: 'forest_edge' },
        enemy: 'ruin_shade',
    },
    cave: {
        name: 'The Dark Cave',
        description: 'Low ceilings, dripping water. A cave troll blocks the passage. The forest is north.',
        exits: { north: 'forest_edge' },
        enemy: 'cave_troll',
    },
};

export function validateMove(currentLocation, direction) {
    return world[currentLocation]?.exits[direction] || null;
}
