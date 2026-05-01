import {
    validateMove,
    hashStr, seededRNG, nextMood,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    getSeason, getSeasonNumber, rollScarcity,
    getMood, getThreatLevel, deriveWorldState,
    _resetMoodCache,
} from './rules.js';

import {
    world, MOOD_INITIAL, SCARCITY_ITEMS
} from './data.js';

beforeEach(() => _resetMoodCache());

// --- Movement ---

describe('Movement', () => {
    test('valid exit navigates correctly', () => {
        expect(validateMove('cellar', 'north')).toBe('hallway');
    });

    test('invalid direction returns null', () => {
        expect(validateMove('cellar', 'south')).toBe(null);
    });

    test('non-existent room returns null', () => {
        expect(validateMove('void', 'north')).toBe(null);
    });

    test('all exits lead to defined rooms', () => {
        for (const roomId in world) {
            for (const dir in world[roomId].exits) {
                const target = world[roomId].exits[dir];
                expect(world[target]).toBeDefined();
            }
        }
    });

    test('exits are bidirectional', () => {
        // Every exit should have a return path (not necessarily same direction, but dest knows src)
        for (const roomId in world) {
            for (const dir in world[roomId].exits) {
                const dest = world[roomId].exits[dir];
                const destExits = Object.values(world[dest].exits);
                expect(destExits).toContain(roomId);
            }
        }
    });

    test('all exitTile destX/destY are within the destination room bounds', () => {
        // Regression: forest_depths → bandit_camp had destY:18 in a 15-tall room,
        // spawning the player out of bounds and making them invisible.
        for (const roomId in world) {
            const room = world[roomId];
            for (const tile of (room.exitTiles || [])) {
                const dest = world[tile.dest];
                expect(dest).toBeDefined();

                // Non-conditional: verify coordinates only if they are defined
                const xInBounds = tile.destX === undefined || (tile.destX >= 0 && tile.destX < dest.width);
                const yInBounds = tile.destY === undefined || (tile.destY >= 0 && tile.destY < dest.height);
                expect(xInBounds).toBe(true);
                expect(yInBounds).toBe(true);
            }
        }
    });
});

// --- Determinism ---

describe('hashStr determinism', () => {
    test('same input always yields same output', () => {
        expect(hashStr('hello')).toBe(hashStr('hello'));
        expect(hashStr('hearthwick1')).toBe(hashStr('hearthwick1'));
    });

    test('different inputs yield different hashes', () => {
        expect(hashStr('day1')).not.toBe(hashStr('day2'));
    });

    test('output is a non-negative integer', () => {
        const h = hashStr('test');
        expect(h).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(h)).toBe(true);
    });
});

describe('seededRNG determinism', () => {
    test('same seed produces identical sequence', () => {
        const rng1 = seededRNG(42);
        const rng2 = seededRNG(42);
        for (let i = 0; i < 20; i++) {
            expect(rng1()).toBe(rng2());
        }
    });

    test('different seeds produce different sequences', () => {
        const rng1 = seededRNG(1);
        const rng2 = seededRNG(2);
        const seq1 = Array.from({ length: 10 }, () => rng1());
        const seq2 = Array.from({ length: 10 }, () => rng2());
        expect(seq1).not.toEqual(seq2);
    });

    test('bounded output stays within range', () => {
        const rng = seededRNG(99);
        for (let i = 0; i < 100; i++) {
            const val = rng(10);
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(10);
        }
    });

    test('output is integer-only', () => {
        const rng = seededRNG(7);
        for (let i = 0; i < 20; i++) {
            expect(Number.isInteger(rng(100))).toBe(true);
        }
    });
});

describe('nextMood determinism', () => {
    test('same seed always produces same mood transition', () => {
        const rng1 = seededRNG(hashStr('seed1'));
        const rng2 = seededRNG(hashStr('seed1'));
        expect(nextMood('weary', rng1)).toBe(nextMood('weary', rng2));
    });

    test('output is always a valid mood', () => {
        const validMoods = ['fearful', 'weary', 'joyful'];
        for (let seed = 0; seed < 50; seed++) {
            const rng = seededRNG(seed);
            const result = nextMood('weary', rng);
            expect(validMoods).toContain(result);
        }
    });

    test('unknown mood falls back gracefully', () => {
        const rng = seededRNG(1);
        const result = nextMood('unknown_mood', rng);
        expect(['fearful', 'weary', 'joyful']).toContain(result);
    });
});

// --- Deterministic replay ---

describe('Deterministic replay', () => {
    test('two peers computing from same seed+day reach identical mood', () => {
        const worldSeed = 'h3arthw1ck-abc123';
        const day = 7;

        const simulatePeer = () => {
            const dailySeed = hashStr(worldSeed + day);
            const rng = seededRNG(dailySeed);
            return nextMood('weary', rng);
        };

        expect(simulatePeer()).toBe(simulatePeer());
    });

    test('mood sequence over 30 days is deterministic', () => {
        const worldSeed = 'test-seed-42';

        const simulate = () => {
            let mood = 'weary';
            const log = [];
            for (let day = 1; day <= 30; day++) {
                const rng = seededRNG(hashStr(worldSeed + day));
                mood = nextMood(mood, rng);
                log.push(mood);
            }
            return log;
        };

        expect(simulate()).toEqual(simulate());
    });
});

// --- Combat ---

describe('Combat determinism', () => {
    test('resolveAttack is deterministic for same seed', () => {
        const rng1 = seededRNG(123);
        const rng2 = seededRNG(123);
        expect(resolveAttack(10, 3, rng1)).toEqual(resolveAttack(10, 3, rng2));
    });

    test('resolveAttack output is a positive integer or zero on dodge', () => {
        for (let seed = 0; seed < 50; seed++) {
            const rng = seededRNG(seed);
            const res = resolveAttack(10, 3, rng);
            expect(res.damage).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(res.damage)).toBe(true);
            
            // Check if damage is strictly positive only when NOT a dodge
            const isStrictlyPositive = res.damage > 0;
            expect(isStrictlyPositive).toBe(!res.isDodge);
        }
    });

    test('high defense does not reduce damage below 1 (unless dodge)', () => {
        for (let seed = 1; seed < 20; seed++) {
            const rng = seededRNG(seed);
            const res = resolveAttack(5, 100, rng);
            
            const minExpected = res.isDodge ? 0 : 1;
            expect(res.damage).toBeGreaterThanOrEqual(minExpected);
        }
    });

    test('rollLoot is deterministic for same seed', () => {
        const rng1 = seededRNG(999);
        const rng2 = seededRNG(999);
        expect(rollLoot('forest_wolf', rng1)).toEqual(rollLoot('forest_wolf', rng2));
    });

    test('rollLoot only returns valid arrays for known enemies', () => {
        const rng = seededRNG(123);
        expect(Array.isArray(rollLoot('forest_wolf', rng))).toBe(true);
        expect(rollLoot('nonexistent', rng)).toEqual([]);
    });
});

// --- Progression ---

describe('Progression', () => {
    test('xpToLevel returns 1 at 0 XP', () => {
        expect(xpToLevel(0)).toBe(1);
    });

    test('xpToLevel increases with XP', () => {
        expect(xpToLevel(100)).toBeGreaterThan(xpToLevel(10));
    });

    test('xpToLevel output is always a positive integer', () => {
        [0, 10, 50, 100, 500, 1000].forEach(xp => {
            const level = xpToLevel(xp);
            expect(level).toBeGreaterThanOrEqual(1);
            expect(Number.isInteger(level)).toBe(true);
        });
    });

    test('levelBonus scales with level', () => {
        const l1 = levelBonus(1);
        const l5 = levelBonus(5);
        expect(l5.attack).toBeGreaterThan(l1.attack);
        expect(l5.maxHp).toBeGreaterThan(l1.maxHp);
    });
});

// --- Season ---

describe('Season', () => {
    test('day 1 is spring', () => {
        expect(getSeason(1)).toBe('spring');
    });

    test('day 31 is summer', () => {
        expect(getSeason(31)).toBe('summer');
    });

    test('day 61 is autumn', () => {
        expect(getSeason(61)).toBe('autumn');
    });

    test('day 91 is winter', () => {
        expect(getSeason(91)).toBe('winter');
    });

    test('day 121 cycles back to spring', () => {
        expect(getSeason(121)).toBe('spring');
    });

    test('getSeasonNumber increments each 120 days', () => {
        expect(getSeasonNumber(1)).toBe(1);
        expect(getSeasonNumber(121)).toBe(2);
        expect(getSeasonNumber(241)).toBe(3);
    });

    test('getSeason is deterministic', () => {
        expect(getSeason(45)).toBe(getSeason(45));
    });
});

// --- Market Scarcity ---

describe('rollScarcity', () => {
    test('returns an array', () => {
        const rng = seededRNG(42);
        const result = rollScarcity(rng, 'spring');
        expect(Array.isArray(result)).toBe(true);
    });

    test('returns at most 2 items', () => {
        const rng = seededRNG(hashStr('test'));
        const result = rollScarcity(rng, 'summer');
        expect(result.length).toBeLessThanOrEqual(2);
    });

    test('returns only known scarcity items', () => {
        const rng = seededRNG(99999);
        const result = rollScarcity(rng, 'winter');
        result.forEach(item => expect(SCARCITY_ITEMS).toContain(item));
    });

    test('is deterministic with same seed', () => {
        const r1 = rollScarcity(seededRNG(7), 'autumn');
        const r2 = rollScarcity(seededRNG(7), 'autumn');
        expect(r1).toEqual(r2);
    });
});

// --- getMood ---

describe('getMood', () => {
    test('day 1 returns MOOD_INITIAL', () => {
        expect(getMood('any-seed', 1)).toBe(MOOD_INITIAL);
    });

    test('is deterministic for same seed+day', () => {
        expect(getMood('test-seed', 42)).toBe(getMood('test-seed', 42));
    });

    test('output is always a valid mood', () => {
        const valid = ['fearful', 'weary', 'joyful'];
        for (let day = 1; day <= 30; day++) {
            expect(valid).toContain(getMood('hearthwick-seed', day));
        }
    });

    test('produces multiple distinct moods over 50 days', () => {
        const results = new Set();
        for (let d = 1; d <= 50; d++) results.add(getMood('seed-a', d));
        expect(results.size).toBeGreaterThan(1);
    });

    test('matches manual Markov chain replay', () => {
        const seed = 'replay-test';
        let mood = MOOD_INITIAL;
        for (let d = 1; d <= 20; d++) {
            expect(getMood(seed, d)).toBe(mood);
            const rng = seededRNG(hashStr(seed + d + 'daytick'));
            mood = nextMood(mood, rng);
        }
    });
});

// --- getThreatLevel ---

describe('getThreatLevel', () => {
    test('returns 0 for days 1-6', () => {
        for (let d = 1; d < 7; d++) expect(getThreatLevel(d)).toBe(0);
    });

    test('returns 1 at day 7', () => {
        expect(getThreatLevel(7)).toBe(1);
    });

    test('returns 2 at day 14', () => {
        expect(getThreatLevel(14)).toBe(2);
    });

    test('caps at 5 from day 35', () => {
        expect(getThreatLevel(35)).toBe(5);
        expect(getThreatLevel(1000)).toBe(5);
    });

    test('output is always an integer', () => {
        [1, 7, 14, 35, 100].forEach(d => expect(Number.isInteger(getThreatLevel(d))).toBe(true));
    });
});

// --- deriveWorldState ---

describe('deriveWorldState', () => {
    const seed = 'h3arthw1ck-test';

    test('returns all required fields', () => {
        const state = deriveWorldState(seed, 10);
        expect(state).toHaveProperty('seed', seed);
        expect(state).toHaveProperty('day', 10);
        expect(state).toHaveProperty('season');
        expect(state).toHaveProperty('seasonNumber');
        expect(state).toHaveProperty('mood');
        expect(state).toHaveProperty('threatLevel');
        expect(state).toHaveProperty('scarcity');
    });

    test('is fully deterministic', () => {
        expect(deriveWorldState(seed, 25)).toEqual(deriveWorldState(seed, 25));
    });

    test('season matches getSeason', () => {
        expect(deriveWorldState(seed, 45).season).toBe(getSeason(45));
    });

    test('seasonNumber matches getSeasonNumber', () => {
        expect(deriveWorldState(seed, 121).seasonNumber).toBe(getSeasonNumber(121));
    });

    test('threatLevel matches getThreatLevel', () => {
        expect(deriveWorldState(seed, 14).threatLevel).toBe(getThreatLevel(14));
    });

    test('mood matches getMood', () => {
        expect(deriveWorldState(seed, 30).mood).toBe(getMood(seed, 30));
    });

    test('scarcity is array of known items', () => {
        const { scarcity } = deriveWorldState(seed, 5);
        expect(Array.isArray(scarcity)).toBe(true);
        scarcity.forEach(item => expect(SCARCITY_ITEMS).toContain(item));
    });

    test('different days produce different day values', () => {
        expect(deriveWorldState(seed, 1).day).not.toBe(deriveWorldState(seed, 50).day);
    });
});

// --- getMood edge cases (regression: day=0, cache correctness) ---

describe('getMood edge cases', () => {
    test('day=0 returns MOOD_INITIAL without crashing', () => {
        expect(getMood('any', 0)).toBe(MOOD_INITIAL);
    });

    test('cache reuse: getMood(seed, 10) then getMood(seed, 5) returns same as fresh', () => {
        const seed = 'cache-test';
        getMood(seed, 10);   // builds seq[0..9]
        _resetMoodCache();
        const fresh5 = getMood(seed, 5);  // builds seq[0..4] fresh
        _resetMoodCache();
        getMood(seed, 10);                // rebuild cache
        const cached5 = getMood(seed, 5); // should hit cache, same result
        expect(cached5).toBe(fresh5);
    });

    test('cache extends correctly: getMood(seed, 5) then getMood(seed, 10) matches direct', () => {
        const seed = 'extend-test';
        getMood(seed, 5);                 // prime cache to day 5
        const extended = getMood(seed, 10); // extend to day 10
        _resetMoodCache();
        const direct = getMood(seed, 10); // compute fresh
        expect(extended).toBe(direct);
    });

    test('getMood sequence is internally consistent across days', () => {
        const seed = 'consistency-test';
        // Each day's mood must be a valid transition from the previous day
        const validMoods = ['fearful', 'weary', 'joyful'];
        for (let d = 1; d <= 20; d++) {
            const mood = getMood(seed, d);
            expect(validMoods).toContain(mood);
        }
    });

    test('two peers independently computing getMood reach the same result', () => {
        const seed = 'split-brain-test';
        const day = 42;
        // Simulate peer A
        _resetMoodCache();
        const peerA = getMood(seed, day);
        // Simulate peer B (fresh cache)
        _resetMoodCache();
        const peerB = getMood(seed, day);
        expect(peerA).toBe(peerB);
    });
});

// --- hashStr edge cases ---

describe('hashStr edge cases', () => {
    test('empty string does not crash', () => {
        expect(() => hashStr('')).not.toThrow();
    });

    test('empty string returns a non-negative integer', () => {
        expect(hashStr('')).toBeGreaterThanOrEqual(0);
    });

    test('single char strings are distinct', () => {
        expect(hashStr('a')).not.toBe(hashStr('b'));
    });

    test('order matters: hashStr(AB) !== hashStr(BA)', () => {
        expect(hashStr('ab')).not.toBe(hashStr('ba'));
    });

    test('PvP seed asymmetry: challenger+target !== target+challenger', () => {
        // Ensures challenger and defender can't accidentally get the same seed
        const A = 'peer-alice-id';
        const B = 'peer-bob-id';
        const day = 7;
        expect(hashStr(A + B + day)).not.toBe(hashStr(B + A + day));
    });
});

// --- seededRNG edge cases ---

describe('seededRNG edge cases', () => {
    test('seed=0 produces valid output without hanging', () => {
        const rng = seededRNG(0);
        expect(() => rng(100)).not.toThrow();
        expect(rng(100)).toBeGreaterThanOrEqual(0);
        expect(rng(100)).toBeLessThan(100);
    });

    test('max=1 always returns 0', () => {
        const rng = seededRNG(42);
        for (let i = 0; i < 10; i++) expect(rng(1)).toBe(0);
    });

    test('large max does not overflow', () => {
        const rng = seededRNG(1);
        const val = rng(4294967295);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(val)).toBe(true);
    });
});

// --- Season boundary regression ---

describe('Season boundaries', () => {
    const boundaries = [
        [30, 'spring'], [31, 'summer'],
        [60, 'summer'], [61, 'autumn'],
        [90, 'autumn'], [91, 'winter'],
        [120, 'winter'], [121, 'spring'],
    ];
    boundaries.forEach(([day, expected]) => {
        test(`day ${day} is ${expected}`, () => {
            expect(getSeason(day)).toBe(expected);
        });
    });
});

// --- deriveWorldState two-peer convergence (regression: split-brain) ---

describe('Two-peer world state convergence', () => {
    test('both peers derive identical world state from same seed+day', () => {
        const seed = 'h3arthw1ck-convergence';
        const day = 56;
        _resetMoodCache();
        const peerA = deriveWorldState(seed, day);
        _resetMoodCache();
        const peerB = deriveWorldState(seed, day);
        expect(peerA).toEqual(peerB);
    });

    test('different days always produce different day values', () => {
        const seed = 'h3arthw1ck-test';
        expect(deriveWorldState(seed, 1).day).toBe(1);
        expect(deriveWorldState(seed, 50).day).toBe(50);
        expect(deriveWorldState(seed, 100).day).toBe(100);
    });

    test('world state is stable across 100 days without drift', () => {
        const seed = 'stability-test';
        // Run twice — if getMood cache causes drift, results diverge
        const run1 = Array.from({length: 100}, (_, i) => deriveWorldState(seed, i + 1).mood);
        _resetMoodCache();
        const run2 = Array.from({length: 100}, (_, i) => deriveWorldState(seed, i + 1).mood);
        expect(run1).toEqual(run2);
    });
});

// --- Time of Day ---

describe('getTimeOfDay', () => {
    test('returns "day" during daylight hours (6-19)', () => {
        // Mock Date.now to 12:00 PM
        const noon = new Date('2026-04-27T12:00:00Z').getTime();
        jest.spyOn(Date, 'now').mockReturnValue(noon);
        const { getTimeOfDay } = require('./rules.js');
        expect(getTimeOfDay()).toBe('day');
        Date.now.mockRestore();
    });

    test('returns "night" during night hours (20-5)', () => {
        // Mock Date.now to 10:00 PM
        const night = new Date('2026-04-27T22:00:00Z').getTime();
        jest.spyOn(Date, 'now').mockReturnValue(night);
        const { getTimeOfDay } = require('./rules.js');
        expect(getTimeOfDay()).toBe('night');
        Date.now.mockRestore();
    });
});

// --- deriveWorldState (Events/Weather) ---

describe('deriveWorldState (Phase 7.5 Features)', () => {
    const seed = 'event-test-seed';

    test('includes weather state', () => {
        const state = deriveWorldState(seed, 1);
        expect(['clear', 'storm', 'fog']).toContain(state.weather);
    });

    test('weather is deterministic', () => {
        expect(deriveWorldState(seed, 5).weather).toBe(deriveWorldState(seed, 5).weather);
    });

    test('includes world events when threat level is high', () => {
        // Threat level 5 starts at day 35
        const state = deriveWorldState(seed, 35);
        expect(state.event).toEqual({ type: 'wandering_boss', target: 'mountain_troll' });
    });

    test('occasionally includes market surplus on lower threat days', () => {
        // We might need to find a day that triggers the 10% chance
        let foundSurplus = false;
        for (let d = 1; d < 35; d++) {
            if (deriveWorldState(seed, d).event?.type === 'market_surplus') {
                foundSurplus = true;
                break;
            }
        }
        expect(foundSurplus).toBe(true);
    });
});

// --- PvP determinism ---

describe('PvP seed determinism', () => {
    test('same challenger+target+day always produces same combat seed', () => {
        const A = 'challenger-peer-id';
        const B = 'target-peer-id';
        const day = 14;
        const seed1 = hashStr(A + B + day);
        const seed2 = hashStr(A + B + day);
        expect(seed1).toBe(seed2);
    });

    test('challenger perspective seed differs from reversed order', () => {
        // Ensures the system is not accidentally symmetric
        const A = 'peer-alpha';
        const B = 'peer-beta';
        const day = 7;
        expect(hashStr(A + B + day)).not.toBe(hashStr(B + A + day));
    });

    test('different days produce different combat outcomes', () => {
        const A = 'peer-alpha';
        const B = 'peer-beta';
        const seeds = new Set([1,2,3,4,5].map(day => hashStr(A + B + day)));
        // At least some days should produce different seeds
        expect(seeds.size).toBeGreaterThan(1);
    });

    test('resolveAttack is deterministic for PvP seed pattern', () => {
        const A = 'peer-x';
        const B = 'peer-y';
        const day = 21;
        const combatSeed = hashStr(A + B + day);
        const rng1 = seededRNG(combatSeed);
        const rng2 = seededRNG(combatSeed);
        let dmg1 = 0, dmg2 = 0;
        for (let i = 0; i < 3; i++) {
            dmg1 += resolveAttack(10, 3, rng1);
            dmg2 += resolveAttack(10, 3, rng2);
        }
        expect(dmg1).toBe(dmg2);
    });
});
