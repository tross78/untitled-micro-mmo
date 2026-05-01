import { Minisketch } from './minisketch.js';

describe('Minisketch peer reconciliation', () => {
    test('decodes one local-only and one remote-only peer', () => {
        const local = new Minisketch(32);
        const remote = new Minisketch(32);
        local.add('user1');
        local.add('user2');
        remote.add('user1');
        remote.add('user3');

        const diff = Minisketch.decode(local, remote);

        expect(diff.removed).toContain(Number(Minisketch.hashId('user2')));
        expect(diff.added).toContain(Number(Minisketch.hashId('user3')));
    });

    test('round-trips through serialized wire format', () => {
        const local = new Minisketch(32);
        const remote = new Minisketch(32);
        ['a', 'b', 'c'].forEach(id => local.add(id));
        ['a', 'c', 'd', 'e'].forEach(id => remote.add(id));

        const decoded = Minisketch.decode(local, Minisketch.fromSerialized(remote.serialize()));

        expect(decoded.removed).toEqual([Number(Minisketch.hashId('b'))]);
        expect(decoded.added.sort((a, b) => a - b)).toEqual([
            Number(Minisketch.hashId('d')),
            Number(Minisketch.hashId('e')),
        ].sort((a, b) => a - b));
    });

    test('identical sets decode as empty', () => {
        const local = new Minisketch(32);
        const remote = new Minisketch(32);
        ['peer-a', 'peer-b', 'peer-c'].forEach(id => {
            local.add(id);
            remote.add(id);
        });

        expect(Minisketch.decode(local, remote)).toEqual({ added: [], removed: [], failure: false });
    });

    test('failure flag is true when capacity is exceeded', () => {
        const local = new Minisketch(2); // very small capacity
        const remote = new Minisketch(2);
        
        // Add 5 distinct items to each
        for (let i = 0; i < 5; i++) local.add(`local-${i}`);
        for (let i = 0; i < 5; i++) remote.add(`remote-${i}`);

        const diff = Minisketch.decode(local, remote);
        expect(diff.failure).toBe(true);
        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
    });

    test('fromSerialized clamps capacity and cellCount for DoS protection', () => {
        // [cap, cellCount, ...]
        const malicious = [99999, 1000000, 1, 1, 1];
        const ms = Minisketch.fromSerialized(malicious);
        
        // Should be clamped to 256 / 1024
        expect(ms._cap).toBe(256);
        expect(ms._cellCount).toBe(1024);
        // Should not crash or allocate massive array
        expect(ms._cells.length).toBe(1024);
    });
});
