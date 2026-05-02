import { getSuggestions } from '../engine/autocomplete.js';

const ITEMS = {
    potion:     { name: 'Potion',     type: 'consumable', heal: 20 },
    iron_sword: { name: 'Iron Sword', type: 'weapon' },
    wolf_pelt:  { name: 'Wolf Pelt',  type: 'misc' },
};

const world = {
    cellar:  { exits: { north: 'hallway' } },
    hallway: { exits: { south: 'cellar', east: 'tavern', north: 'market' } },
    tavern:  { exits: { west: 'hallway' } },
};

const players = new Map([
    ['id1', { name: 'Alice' }],
    ['id2', { name: 'Bob' }],
    ['id3', { name: 'Alicia' }],
]);

const ctx = (overrides = {}) => ({
    inventory: ['potion', 'iron_sword'],
    location: 'cellar',
    world,
    players,
    ITEMS,
    ...overrides,
});

describe('Autocomplete — Command Completion', () => {
    test('empty input returns first 4 top-level commands', () => {
        const results = getSuggestions('', ctx());
        expect(results).toHaveLength(4);
        results.forEach(r => {
            expect(r).toHaveProperty('display');
            expect(r).toHaveProperty('fill');
            expect(r).toHaveProperty('immediate');
        });
    });

    test('partial command filters by prefix', () => {
        const results = getSuggestions('att', ctx());
        expect(results).toHaveLength(1);
        expect(results[0].display).toBe('attack');
    });

    test('exact command match returns that command', () => {
        const results = getSuggestions('look', ctx());
        expect(results[0].display).toBe('look');
    });

    test('no-arg commands are immediate', () => {
        const immediate = ['look', 'attack', 'rest', 'stats', 'inventory',
                           'wave', 'bow', 'cheer', 'accept', 'decline', 'who'];
        for (const cmd of immediate) {
            const results = getSuggestions(cmd, ctx());
            expect(results[0]?.immediate).toBe(true);
        }
    });

    test('arg-taking commands are not immediate and append a space', () => {
        for (const cmd of ['use', 'move', 'duel', 'rename']) {
            const results = getSuggestions(cmd, ctx());
            const match = results.find(r => r.display === cmd);
            expect(match).toBeDefined();
            expect(match.immediate).toBe(false);
            expect(match.fill).toBe(cmd + ' ');
        }
    });

    test('leading slash is stripped', () => {
        const withSlash    = getSuggestions('/look', ctx());
        const withoutSlash = getSuggestions('look',  ctx());
        expect(withSlash[0].display).toBe(withoutSlash[0].display);
    });

    test('unrecognised prefix returns empty', () => {
        expect(getSuggestions('zzz', ctx())).toEqual([]);
    });

    test('returns at most 4 results', () => {
        // 'a' matches 'attack' and 'accept' — at most 4
        const results = getSuggestions('a', ctx());
        expect(results.length).toBeLessThanOrEqual(4);
    });
});

describe('Autocomplete — /use <item>', () => {
    test('use + space shows all inventory items', () => {
        const results = getSuggestions('use ', ctx());
        expect(results).toHaveLength(2);
        expect(results.map(r => r.display)).toContain('Potion');
        expect(results.map(r => r.display)).toContain('Iron Sword');
    });

    test('use + partial name filters by prefix (case-insensitive)', () => {
        const results = getSuggestions('use p', ctx());
        expect(results).toHaveLength(1);
        expect(results[0].display).toBe('Potion');
    });

    test('fill value uses lowercase item name (matches handler)', () => {
        const results = getSuggestions('use ', ctx());
        const potion = results.find(r => r.display === 'Potion');
        expect(potion.fill).toBe('use potion');
    });

    test('use suggestions are not immediate', () => {
        const results = getSuggestions('use ', ctx());
        results.forEach(r => expect(r.immediate).toBe(false));
    });

    test('empty inventory returns no suggestions', () => {
        const results = getSuggestions('use ', ctx({ inventory: [] }));
        expect(results).toEqual([]);
    });

    test('partial that matches nothing returns empty', () => {
        const results = getSuggestions('use zzz', ctx());
        expect(results).toEqual([]);
    });

    test('works with 3 inventory items — caps at 4', () => {
        const results = getSuggestions('use ', ctx({ inventory: ['potion', 'iron_sword', 'wolf_pelt'] }));
        expect(results).toHaveLength(3);
    });

    test('slash prefix still works for use', () => {
        const results = getSuggestions('/use p', ctx());
        expect(results[0].display).toBe('Potion');
    });
});

describe('Autocomplete — /move <dir>', () => {
    test('move + space shows all exits for current room', () => {
        const results = getSuggestions('move ', ctx({ location: 'hallway' }));
        expect(results).toHaveLength(3); // south, east, north
        expect(results.map(r => r.display)).toContain('south');
        expect(results.map(r => r.display)).toContain('east');
        expect(results.map(r => r.display)).toContain('north');
    });

    test('move + partial filters exits by prefix', () => {
        const results = getSuggestions('move n', ctx({ location: 'hallway' }));
        expect(results).toHaveLength(1);
        expect(results[0].display).toBe('north');
    });

    test('move suggestions are immediate', () => {
        const results = getSuggestions('move ', ctx({ location: 'hallway' }));
        results.forEach(r => expect(r.immediate).toBe(true));
    });

    test('fill value is the full command string', () => {
        const results = getSuggestions('move ', ctx());
        expect(results[0].fill).toBe('move north');
    });

    test('room with no exits returns empty', () => {
        const noExits = { ...world, dead_end: { exits: {} } };
        const results = getSuggestions('move ', ctx({ location: 'dead_end', world: noExits }));
        expect(results).toEqual([]);
    });

    test('unknown room returns empty gracefully', () => {
        const results = getSuggestions('move ', ctx({ location: 'nonexistent' }));
        expect(results).toEqual([]);
    });
});

describe('Autocomplete — /duel <player>', () => {
    test('duel + space shows all visible players', () => {
        const results = getSuggestions('duel ', ctx());
        expect(results.length).toBeGreaterThan(0);
        expect(results.map(r => r.display)).toContain('Alice');
        expect(results.map(r => r.display)).toContain('Bob');
    });

    test('duel + partial filters by name prefix (case-insensitive)', () => {
        const results = getSuggestions('duel al', ctx());
        // Matches Alice and Alicia
        expect(results).toHaveLength(2);
        expect(results.map(r => r.display)).toContain('Alice');
        expect(results.map(r => r.display)).toContain('Alicia');
    });

    test('fill value is lowercase player name', () => {
        const results = getSuggestions('duel al', ctx());
        const alice = results.find(r => r.display === 'Alice');
        expect(alice.fill).toBe('duel alice');
    });

    test('duel suggestions are not immediate', () => {
        const results = getSuggestions('duel ', ctx());
        results.forEach(r => expect(r.immediate).toBe(false));
    });

    test('no matching players returns empty', () => {
        const results = getSuggestions('duel zzz', ctx());
        expect(results).toEqual([]);
    });

    test('empty players map returns empty', () => {
        const results = getSuggestions('duel ', ctx({ players: new Map() }));
        expect(results).toEqual([]);
    });
});

describe('Autocomplete — Unknown command argument', () => {
    test('unknown command with arg returns empty', () => {
        expect(getSuggestions('rename something', ctx())).toEqual([]);
        expect(getSuggestions('clear something', ctx())).toEqual([]);
    });
});
