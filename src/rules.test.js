import {
    validateMove, world,
    hashStr, seededRNG, nextMood,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    ENEMIES, ITEMS,
} from './rules';

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
