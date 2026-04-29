/**
 * Hearthwick Simulation Rules
 * Pure deterministic, integer-only logic.
 */

import {
    SEASONS, SEASON_LENGTH, moodMarkov, SCARCITY_ITEMS, MOOD_INITIAL,
    ENEMIES, ITEMS, DEFAULT_PLAYER_STATS, INSTANCE_CAP, world,
    NPCS, DIALOGUE_POOLS, QUESTS, CORPORA, GAME_NAME
} from './data.js';

export { world };
import { generateSentence } from './markov.js';

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
// Cap at 3650 entries (~10 years) to bound Pi Zero memory; older days recompute on demand.
const _moodSeqs = new Map();
const MOOD_SEQ_CAP = 3650;
export const _resetMoodCache = () => _moodSeqs.clear(); // test isolation only
export function getMood(worldSeed, day) {
    let seq = _moodSeqs.get(worldSeed);
    if (!seq) { seq = [MOOD_INITIAL]; _moodSeqs.set(worldSeed, seq); }
    // If the day requested is beyond the cap, recompute from the last cached entry
    const startDay = Math.min(day, MOOD_SEQ_CAP);
    for (let d = seq.length; d < startDay; d++)
        seq.push(nextMood(seq[d - 1], seededRNG(hashStr(worldSeed + d + 'daytick'))));
    if (day > MOOD_SEQ_CAP) {
        let mood = seq[MOOD_SEQ_CAP - 1];
        for (let d = MOOD_SEQ_CAP; d < day; d++)
            mood = nextMood(mood, seededRNG(hashStr(worldSeed + d + 'daytick')));
        return mood;
    }
    return seq[day - 1] ?? MOOD_INITIAL;
}

export function getTimeOfDay() {
    const hour = (Date.now() / 3600000) % 24;
    if (hour >= 6 && hour < 20) return 'day';
    return 'night';
}

export function getThreatLevel(day) {
    return Math.min(5, Math.floor(day / 7));
}

export function deriveWorldState(worldSeed, day) {
    const rng = seededRNG(hashStr(worldSeed + day + 'daytick'));
    const season = getSeason(day);
    const threatLevel = getThreatLevel(day);
    
    // World Events
    let event = null;
    if (threatLevel >= 5) {
        event = { type: 'wandering_boss', target: 'mountain_troll' };
    } else if (rng(100) < 10) {
        event = { type: 'market_surplus' };
    }
    
    // Weather
    const weatherRoll = rng(100);
    const weather = weatherRoll < 70 ? 'clear' : weatherRoll < 90 ? 'storm' : 'fog';
    
    return {
        seed: worldSeed,
        day,
        season,
        seasonNumber: getSeasonNumber(day),
        mood: getMood(worldSeed, day),
        threatLevel,
        scarcity: rollScarcity(rng, season),
        event,
        weather
    };
}

// --- COMBAT ---

// Integer-only damage roll: handles critical hits and dodges
export function resolveAttack(attackStat, defenseStat, rng, isNight = false) {
    const isDodge = rng(100) < 7;
    if (isDodge) return { damage: 0, isCrit: false, isDodge: true };

    const isCrit = rng(100) < 10;
    const base = Math.max(1, attackStat - defenseStat);
    let damage = (rng(base * 2) + 1) | 0;
    if (isCrit) damage *= 2;
    
    // Night bonus for monsters (if passed correctly)
    if (isNight) damage = Math.floor(damage * 1.2);
    
    return { damage, isCrit, isDodge: false };
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
// We append the instance ID and a 15-minute time epoch to shard the discovery layer,
// preventing info_hash bans on public trackers.
export const getShardName = (loc, inst) => `${GAME_NAME}-${loc}-v1-${inst}`;

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
    
    // Seeded RNG for cross-peer sync
    const rng = seededRNG(hashStr(worldSeed + npcId + day + 'markov'));
    
    const corpus = CORPORA[npcId] || CORPORA[npc.role] || CORPORA['sage'];
    return generateSentence(corpus, rng);
}
