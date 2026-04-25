/**
 * Hearthwick Simulation Rules
 * Pure deterministic, integer-only logic.
 */

import {
    SEASONS, SEASON_LENGTH, moodMarkov, SCARCITY_ITEMS, MOOD_INITIAL,
    ENEMIES, ITEMS, DEFAULT_PLAYER_STATS, INSTANCE_CAP, world,
    NPCS, DIALOGUE_POOLS, QUESTS
} from './data';

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

export function getSeason(day) {
    return SEASONS[(Math.floor((Math.max(1, day) - 1) / SEASON_LENGTH) | 0) % 4];
}

export function getSeasonNumber(day) {
    return (Math.floor((Math.max(1, day) - 1) / (SEASON_LENGTH * 4)) | 0) + 1;
}

// --- MOOD ---

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

// --- COMBAT ---

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

// --- SCALING & SHARDING ---
// appId in joinTorrent config handles swarm isolation; room name just needs to be unique within the app.
export const getShardName = (loc, inst) => `${loc}-${inst}`;

// --- WORLD DATA ---

export function validateMove(currentLocation, direction) {
    return world[currentLocation]?.exits[direction] || null;
}

export function getNPCLocation(npcId, worldSeed, day) {
    const npc = NPCS[npcId];
    if (!npc) return null;
    if (!npc.patrol) return npc.home;
    const rng = seededRNG(hashStr(worldSeed + npcId + day));
    const patrolArray = Array.isArray(npc.patrol) ? [npc.home, ...npc.patrol] : [npc.home];
    return patrolArray[rng(patrolArray.length)];
}

export function getNPCDialogue(npcId, worldSeed, day, mood) {
    const npc = NPCS[npcId];
    if (!npc) return "";
    const rng = seededRNG(hashStr(worldSeed + npcId + day + 'dialogue'));
    const moodPool = DIALOGUE_POOLS[mood] || [];
    // NPC either has a mood-specific line for today or uses their base dialogue.
    // This choice is now stable for the entire day.
    if (rng(100) < 40 && moodPool.length > 0) {
        return moodPool[rng(moodPool.length)];
    }
    return npc.baseDialogue;
}
