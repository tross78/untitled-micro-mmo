import {
    validateMove, world,
    hashStr, seededRNG, nextMood,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    ENEMIES, ITEMS,
    getSeason, getSeasonNumber, rollScarcity, SCARCITY_ITEMS,
    getMood, getThreatLevel, deriveWorldState, deriveNarrative,
    MOOD_INITIAL, EVENT_TYPES, NARRATIVE_EVENTS,
    _resetMoodCache,
} from './rules';

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
        expect(resolveAttack(10, 3, rng1)).toBe(resolveAttack(10, 3, rng2));
    });

    test('resolveAttack output is a positive integer', () => {
        for (let seed = 0; seed < 20; seed++) {
            const rng = seededRNG(seed);
            const dmg = resolveAttack(10, 3, rng);
            expect(dmg).toBeGreaterThan(0);
            expect(Number.isInteger(dmg)).toBe(true);
        }
    });

    test('high defense does not reduce damage below 1', () => {
        const rng = seededRNG(1);
        expect(resolveAttack(5, 100, rng)).toBeGreaterThanOrEqual(1);
    });

    test('rollLoot is deterministic for same seed', () => {
        const rng1 = seededRNG(999);
        const rng2 = seededRNG(999);
        expect(rollLoot('forest_wolf', rng1)).toEqual(rollLoot('forest_wolf', rng2));
    });

    test('rollLoot only returns items defined in ITEMS', () => {
        for (let seed = 0; seed < 20; seed++) {
            const rng = seededRNG(seed);
            const loot = rollLoot('ruin_shade', rng);
            loot.forEach(id => expect(ITEMS[id]).toBeDefined());
        }
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

// --- deriveNarrative ---

describe('deriveNarrative', () => {
    test('returns a string', () => {
        expect(typeof deriveNarrative('seed', 1)).toBe('string');
    });

    test('is deterministic', () => {
        expect(deriveNarrative('seed', 42)).toBe(deriveNarrative('seed', 42));
    });

    test('output is always a known narrative event', () => {
        for (let day = 1; day <= 20; day++) {
            expect(NARRATIVE_EVENTS).toContain(deriveNarrative('test-seed', day));
        }
    });

    test('different seeds produce different results across sample', () => {
        const a = new Set(Array.from({length: 10}, (_, i) => deriveNarrative('seed-a', i + 1)));
        const b = new Set(Array.from({length: 10}, (_, i) => deriveNarrative('seed-b', i + 1)));
        // At least one difference expected across 10 days with different seeds
        const overlap = [...a].filter(x => b.has(x)).length;
        expect(overlap).toBeLessThan(10);
    });
});
