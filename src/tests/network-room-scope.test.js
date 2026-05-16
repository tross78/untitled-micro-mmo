import { filterConnectedPeerIds } from '../network/peer-filter.js';

describe('shard peer filtering', () => {
    test('targets only peers directly connected on the current shard room', () => {
        const room = {
            getPeers: () => ({
                'shard-peer': {},
                'also-on-shard': {},
            })
        };

        const filtered = filterConnectedPeerIds(room, [
            'global-only-peer',
            'shard-peer',
            'also-on-shard',
        ]);

        expect(filtered).toEqual(['shard-peer', 'also-on-shard']);
    });

    test('falls back to an empty target list when the room has no direct peers yet', () => {
        const room = {
            getPeers: () => ({})
        };

        expect(filterConnectedPeerIds(room, ['global-only-peer'])).toEqual([]);
    });
});
