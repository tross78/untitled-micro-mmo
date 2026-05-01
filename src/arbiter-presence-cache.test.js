import {
    MAX_PRESENCE_CACHE,
    addToPresenceCache,
    listPeersForShard,
    prunePresenceCache,
    sanitizePresenceEntry,
} from './arbiter-presence-cache.js';

describe('arbiter presence cache helpers', () => {
    test('sanitizePresenceEntry accepts and normalizes valid presence', () => {
        const now = 1000;
        const entry = sanitizePresenceEntry({
            ph: 'ABCDEF12',
            name: '  Alice  ',
            location: 'cellar',
            shard: 'hearthwick-cellar-v1-1',
            level: 3.9,
            ts: 2000,
        }, now);

        expect(entry).toEqual({
            ph: 'abcdef12',
            name: 'Alice',
            location: 'cellar',
            shard: 'hearthwick-cellar-v1-1',
            level: 3,
            ts: now,
        });
    });

    test('sanitizePresenceEntry rejects malformed presence', () => {
        expect(sanitizePresenceEntry(null)).toBeNull();
        expect(sanitizePresenceEntry({ ph: 'short', location: 'cellar', shard: 'x', name: 'A', level: 1 })).toBeNull();
        expect(sanitizePresenceEntry({ ph: 'abcdef12', location: '', shard: 'x', name: 'A', level: 1 })).toBeNull();
        expect(sanitizePresenceEntry({ ph: 'abcdef12', location: 'cellar', shard: '', name: 'A', level: 1 })).toBeNull();
        expect(sanitizePresenceEntry({ ph: 'abcdef12', location: 'cellar', shard: 'x', name: '', level: 1 })).toBeNull();
        expect(sanitizePresenceEntry({ ph: 'abcdef12', location: 'cellar', shard: 'x', name: 'A', level: 0 })).toBeNull();
    });

    test('listPeersForShard returns only fresh peers from the requested shard', () => {
        const cache = new Map([
            ['a', { ph: 'aaaa1111', name: 'Alice', location: 'cellar', shard: 's1', level: 2, ts: 100000 }],
            ['b', { ph: 'bbbb2222', name: 'Bob', location: 'tavern', shard: 's2', level: 4, ts: 100100 }],
            ['c', { ph: 'cccc3333', name: 'Cara', location: 'cellar', shard: 's1', level: 5, ts: 20000 }],
        ]);

        expect(listPeersForShard(cache, 's1', 110000)).toEqual([
            { ph: 'aaaa1111', name: 'Alice', location: 'cellar', level: 2, ts: 100000 },
        ]);
    });

    test('prunePresenceCache evicts stale entries', () => {
        const cache = new Map([
            ['fresh', { ts: 100000 }],
            ['stale', { ts: 1 }],
        ]);

        prunePresenceCache(cache, 120001, 30000);

        expect(Array.from(cache.keys())).toEqual(['fresh']);
    });

    test('addToPresenceCache caps map size and evicts oldest entry', () => {
        const cache = new Map();
        for (let i = 0; i < MAX_PRESENCE_CACHE; i++) {
            addToPresenceCache(cache, `k${i}`, { ph: `${i}`.padStart(8, '0'), ts: i }, i);
        }

        addToPresenceCache(cache, 'overflow', { ph: 'ffffffff', ts: MAX_PRESENCE_CACHE + 1 }, MAX_PRESENCE_CACHE + 1);

        expect(cache.size).toBe(MAX_PRESENCE_CACHE);
        expect(cache.has('k0')).toBe(false);
        expect(cache.has('overflow')).toBe(true);
    });
});
