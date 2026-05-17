import { createPresenceDirectory } from '../network/arbiter-presence-directory.js';

describe('arbiter presence directory', () => {
    test('register stores sanitized entries and list returns fresh peers for a shard', () => {
        const directory = createPresenceDirectory();
        const now = 100000;

        const stored = directory.register({
            ph: 'ABCDEF12',
            name: '  Alice  ',
            location: 'cellar',
            shard: 'cellar-1',
            level: 3.9,
            ts: now - 1000,
            x: 7,
            y: 9,
        }, now);

        expect(stored).toEqual({
            ph: 'abcdef12',
            name: 'Alice',
            location: 'cellar',
            shard: 'cellar-1',
            level: 3,
            ts: now - 1000,
            x: 7,
            y: 9,
        });
        expect(directory.list('cellar-1', now)).toEqual([
            {
                ph: 'abcdef12',
                name: 'Alice',
                location: 'cellar',
                level: 3,
                ts: now - 1000,
                x: 7,
                y: 9,
            },
        ]);
    });

    test('register rejects malformed presence payloads instead of polluting snapshot state', () => {
        const directory = createPresenceDirectory();

        expect(directory.register({
            ph: 'bad',
            name: 'Alice',
            location: 'cellar',
            shard: 'cellar-1',
            level: 2,
        })).toBeNull();
        expect(directory.size()).toBe(0);
    });

    test('prune removes stale entries from shard snapshots', () => {
        const directory = createPresenceDirectory();
        const now = 200000;

        directory.register({
            ph: 'aaaa1111',
            name: 'Fresh',
            location: 'cellar',
            shard: 'cellar-1',
            level: 2,
            ts: now - 1000,
        }, now);
        directory.register({
            ph: 'bbbb2222',
            name: 'Stale',
            location: 'cellar',
            shard: 'cellar-1',
            level: 2,
            ts: 1,
        }, 1);

        directory.prune(now);

        expect(directory.list('cellar-1', now)).toEqual([
            {
                ph: 'aaaa1111',
                name: 'Fresh',
                location: 'cellar',
                level: 2,
                ts: now - 1000,
                x: 5,
                y: 5,
            },
        ]);
    });
});
