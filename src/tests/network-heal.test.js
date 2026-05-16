import { countUsableShardPeers } from '../network/heal.js';

describe('network heal helpers', () => {
    test('counts only directly connected shard peers with completed identity state', () => {
        const shardKnownPeers = new Set(['peer-live', 'peer-no-key', 'peer-ghost']);
        const players = new Map([
            ['peer-live', { publicKey: 'pk-live', ghost: false }],
            ['peer-no-key', { ghost: false }],
            ['peer-ghost', { publicKey: 'pk-ghost', ghost: true }],
        ]);

        expect(countUsableShardPeers(shardKnownPeers, players)).toBe(1);
    });

    test('returns zero when shard peers are transport-only', () => {
        const shardKnownPeers = new Set(['peer-a', 'peer-b']);
        const players = new Map([
            ['peer-a', {}],
            ['peer-b', { ghost: false }],
        ]);

        expect(countUsableShardPeers(shardKnownPeers, players)).toBe(0);
    });
});
