import { createPresenceDirectory } from '../network/arbiter-presence-directory.js';

describe('arbiter presence directory', () => {
    test('register stores sanitized entries and list returns fresh peers for a shard', () => {
        const directory = createPresenceDirectory();
        const now = 100000;

        const stored = directory.register({
            ph: 'ABCDEF12',
            id: 'peer-a',
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
            id: 'peer-a',
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
                id: 'peer-a',
                name: 'Alice',
                location: 'cellar',
                shard: 'cellar-1',
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
            id: 'peer-fresh',
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
                id: 'peer-fresh',
                name: 'Fresh',
                location: 'cellar',
                shard: 'cellar-1',
                level: 2,
                ts: now - 1000,
                x: 5,
                y: 5,
            },
        ]);
    });

    test('removeById removes entries by Trystero id without touching other shard peers', () => {
        const directory = createPresenceDirectory();
        const now = 300000;

        directory.register({
            ph: 'aaaa1111',
            id: 'old-trystero-id',
            name: 'Old',
            location: 'cellar',
            shard: 'cellar-1',
            level: 2,
            ts: now,
        }, now);
        directory.register({
            ph: 'bbbb2222',
            id: 'live-trystero-id',
            name: 'Live',
            location: 'cellar',
            shard: 'cellar-1',
            level: 3,
            ts: now,
        }, now);

        expect(directory.removeById('old-trystero-id')).toBe(true);
        expect(directory.removeById('missing-trystero-id')).toBe(false);
        expect(directory.list('cellar-1', now)).toEqual([
            expect.objectContaining({
                ph: 'bbbb2222',
                id: 'live-trystero-id',
                name: 'Live',
            }),
        ]);
    });

    test('sequential same-shard registrations expose earlier peers to later hint lookups', () => {
        const directory = createPresenceDirectory();
        const now = 400000;

        const first = directory.register({
            ph: 'aaaa1111',
            id: 'peer-a',
            name: 'Alpha',
            location: 'cellar',
            shard: 'cellar-1',
            level: 1,
            ts: now,
        }, now);
        const second = directory.register({
            ph: 'bbbb2222',
            id: 'peer-b',
            name: 'Beta',
            location: 'cellar',
            shard: 'cellar-1',
            level: 1,
            ts: now + 1,
        }, now + 1);

        const peersVisibleToSecond = directory
            .list(second.shard, now + 1)
            .filter(peer => peer.id && peer.id !== second.id)
            .map(peer => peer.id);

        expect(first.id).toBe('peer-a');
        expect(peersVisibleToSecond).toContain('peer-a');
    });
});
