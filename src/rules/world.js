// Pure deterministic world derivation — no side effects, no Math.random() (ADR-008).
// All outputs are a pure function of (seed, day). Same inputs always produce same outputs,
// which is required for P2P consensus across clients (ADR-008).
// Entry point for consumers: deriveWorldState(seed, day) in src/rules/index.js.
import { SEASONS, SEASON_LENGTH, moodMarkov, SCARCITY_ITEMS, MOOD_INITIAL } from '../content/data.js';
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

// Mood is a Markov chain: each day's mood transitions from the previous day's.
// Sequences are memoised per seed to avoid re-computing from day 1 each call.
// MOOD_SEQ_CAP = 3650 (10 years) limits memory; beyond it mood is computed on the fly without caching.
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

// Threat rises by 1 every 7 days, caps at 5. Affects event table weights and enemy combat bonuses.
// threat >= 3 unlocks wild events (Phase 8.77); threat == 5 enables wandering boss spawns.
export function getThreatLevel(day) {
    return Math.min(5, Math.floor(day / 7));
}

// 8.6b: scarcity raises buy prices; surplus lowers them
export function getScarcityMultiplier(itemId, worldState) {
    if (worldState.scarcity?.includes(itemId)) return 1.5;
    if (worldState.surplus?.includes(itemId)) return 0.7;
    return 1;
}

/**
 * 8.6c: Returns a context-aware description for a room based on current world state.
 */
export function getDynamicRoomDescription(room, worldState) {
    let desc = room.description || '';
    const event = worldState?.event;
    const weather = worldState?.weather;

    // Event-based flavor
    if (event?.type === 'ancient_tremor' && (room.zone === 'dungeon' || room.id === 'catacombs')) {
        desc = `[Tremor] The earth groans and dust falls from the ceiling. ${desc}`;
    } else if (event?.type === 'wandering_boss' && (room.id === 'ruins' || room.id === 'mountain_pass')) {
        desc = `[Danger] Massive footprints mark the ground here. ${desc}`;
    } else if (event?.type === 'wolf_pack' && (room.id === 'forest_edge' || room.id === 'crossroads')) {
        desc = `[Hunt] The air is filled with frequent, aggressive howling. ${desc}`;
    } else if (event?.type === 'market_surplus' && (room.id === 'market' || room.id === 'tavern')) {
        desc = `[Surplus] The square is overflowing with abundant supplies. ${desc}`;
    } else if (event?.type === 'bounty_hunt' && (room.id === 'hallway' || room.id === 'market')) {
        desc = `[Bounty] Guard notices offer rewards for recovered contraband. ${desc}`;
    }

    // Weather-based flavor
    if (weather === 'storm' && room.zone === 'wilderness') {
        desc = `[Storm] Rain lashes down, obscuring the path. ${desc}`;
    } else if (weather === 'fog' && room.zone === 'wilderness') {
        desc = `[Fog] A thick, unnatural mist clings to the trees. ${desc}`;
    }

    return desc;
}

// 8.6b: weather modifiers — storm slows forest fights, fog reduces enemy detection
export function getWeatherEffect(weather) {
    if (weather === 'storm') return { forestFightCostMult: 2, label: 'Storm: forest fights cost 2 each.' };
    if (weather === 'fog') return { enemyMissChance: 20, label: 'Fog: enemies miss 20% more often.' };
    return null;
}

// Event table — one event per day, deterministic.
// At high threat, wandering_boss becomes an additional possible override rather than
// replacing all other daily event variety.
const EVENT_TABLE = [
    { weight: 30, type: null },           // no event (base)
    { weight: 15, type: 'market_surplus' },
    { weight: 15, type: 'scarcity_spike' },
    { weight: 12, type: 'bounty_hunt' },
    { weight: 12, type: 'wandering_trader' },
    { weight: 11, type: 'wolf_pack' },
    { weight: 10, type: 'ancient_tremor' },
];

function rollEvent(rng, threatLevel) {
    const total = EVENT_TABLE.reduce((s, e) => s + e.weight, 0);
    const baseEvent = (() => {
        let roll = rng(total);
        for (const entry of EVENT_TABLE) {
            roll -= entry.weight;
            if (roll < 0) {
                return entry.type ? { ...entry } : null;
            }
        }
        return null;
    })();

    if (threatLevel < 5) return baseEvent;

    // High-threat days can surface a wandering boss, but other event types still occur.
    if (rng(100) < 25) return { type: 'wandering_boss', target: 'mountain_troll' };

    return baseEvent;
}

function rollSurplus(rng, scarcity) {
    // Surplus is a different item than whatever is scarce this day
    const count = rng(2); // 0 or 1 surplus item
    if (count === 0) return [];
    const pool = SCARCITY_ITEMS.filter(id => !scarcity.includes(id));
    if (pool.length === 0) return [];
    return [pool[rng(pool.length)]];
}

export function deriveWorldState(worldSeed, day) {
    const rng = seededRNG(hashStr(worldSeed + day + 'daytick'));
    const season = getSeason(day);
    const threatLevel = getThreatLevel(day);
    
    // 8.6a: roll event first so it can influence scarcity/surplus
    const event = rollEvent(rng, threatLevel);

    let scarcity = rollScarcity(rng, season);
    // 8.6b: scarcity_spike ensures at least 2 items are scarce
    while (event?.type === 'scarcity_spike' && scarcity.length < 2) {
        const pool = SCARCITY_ITEMS.filter(id => !scarcity.includes(id));
        if (pool.length === 0) break;
        scarcity.push(pool[rng(pool.length)]);
    }

    let surplus = rollSurplus(rng, scarcity);
    // 8.6b: market_surplus ensures at least 2 surplus items
    while (event?.type === 'market_surplus' && surplus.length < 2) {
        const pool = SCARCITY_ITEMS.filter(id => !scarcity.includes(id) && !surplus.includes(id));
        if (pool.length === 0) break;
        surplus.push(pool[rng(pool.length)]);
    }

    const weatherRoll = rng(100);
    const weather = weatherRoll < 60 ? 'clear' : weatherRoll < 80 ? 'storm' : weatherRoll < 95 ? 'fog' : 'clear';

    // Daily Bounty Enemy (Phase 8.7b)
    const bountyPool = ['forest_wolf', 'goblin', 'bandit', 'cave_troll', 'ruin_shade', 'skeleton'];
    const bountyEnemy = bountyPool[rng(bountyPool.length)];

    return {
        seed: worldSeed,
        day,
        season,
        seasonNumber: getSeasonNumber(day),
        mood: getMood(worldSeed, day),
        threatLevel,
        scarcity,
        surplus,
        event,
        weather,
        bountyEnemy
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
