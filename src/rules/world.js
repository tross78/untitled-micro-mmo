import { SEASONS, SEASON_LENGTH, moodMarkov, SCARCITY_ITEMS, MOOD_INITIAL } from '../engine/data.js';
import { seededRNG, hashStr } from './utils.js';

export function getSeason(day) {
    return SEASONS[(Math.floor((Math.max(1, day) - 1) / SEASON_LENGTH) | 0) % 4];
}

export function getSeasonNumber(day) {
    return (Math.floor((Math.max(1, day) - 1) / (SEASON_LENGTH * 4)) | 0) + 1;
}

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

export function rollScarcity(rng, _season) {
    const count = rng(3); // 0, 1, or 2 scarce items
    const pool = [...SCARCITY_ITEMS];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = rng(i + 1) | 0;
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, count);
}

const _moodSeqs = new Map();
const MOOD_SEQ_CAP = 3650;
export const _resetMoodCache = () => _moodSeqs.clear();

export function getMood(worldSeed, day) {
    let seq = _moodSeqs.get(worldSeed);
    if (!seq) { seq = [MOOD_INITIAL]; _moodSeqs.set(worldSeed, seq); }
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
    
    let event = null;
    if (threatLevel >= 5) {
        event = { type: 'wandering_boss', target: 'mountain_troll' };
    } else if (rng(100) < 10) {
        event = { type: 'market_surplus' };
    }
    
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

/**
 * Deterministic seed for a specific room on a specific day.
 * Changes every 7 days (one in-game week).
 */
export function roomDaySeed(roomKey, day) {
    const week = Math.floor(day / 7);
    return hashStr(roomKey) ^ (week * 0x9e3779b9);
}

/**
 * Deterministically scatters scenery/items within a room based on the week's seed.
 * @param {string} roomKey
 * @param {number} day
 * @param {any} roomDef
 */
export function getScatteredContent(roomKey, day, roomDef) {
    const seed = roomDaySeed(roomKey, day);
    const rng = seededRNG(seed);
    const scattered = [];
    
    // If the room has scatter rules, apply them
    if (roomDef.sceneryScatter) {
        roomDef.sceneryScatter.forEach(rule => {
            const count = rule.count[0] + rng(rule.count[1] - rule.count[0] + 1);
            for (let i = 0; i < count; i++) {
                const x = rng(roomDef.width);
                const y = rng(roomDef.height);
                
                // Ensure not on an exit or occupied tile
                const isExit = (roomDef.exitTiles || []).some(t => t.x === x && t.y === y);
                const isOccupied = scattered.some(s => s.x === x && s.y === y);
                const isStatic = (roomDef.staticEntities || []).some(e => e.x === x && e.y === y);
                
                if (!isExit && !isOccupied && !isStatic) {
                    scattered.push({ x, y, type: rule.type, label: rule.label });
                }
            }
        });
    }
    
    return scattered;
}
