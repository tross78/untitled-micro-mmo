import {
    listPersistedBans,
    getBansVersion,
    buildPersistedArbiterPacket,
    restoreBansFromPacket,
} from '../network/arbiter-state.js';

describe('arbiter state — ban persistence', () => {
    test('listPersistedBans handles a Set the same as an equivalent Array', () => {
        const set = new Set(['key-a', 'key-b', 'key-a']);
        const arr = ['key-a', 'key-b', 'key-a'];
        expect(listPersistedBans(set)).toEqual(listPersistedBans(arr));
    });

    test('listPersistedBans on a non-empty Set returns sorted deduplicated strings', () => {
        const bans = new Set(['zzz', 'aaa', 'mmm', 'aaa']);
        expect(listPersistedBans(bans)).toEqual(['aaa', 'mmm', 'zzz']);
    });

    test('getBansVersion on a Set is not the empty-array version', () => {
        const bans = new Set(['pub-key-x']);
        expect(getBansVersion(bans)).not.toBe(getBansVersion([]));
    });

    test('bans survive a round-trip through buildPersistedArbiterPacket / restoreBansFromPacket', () => {
        const bans = new Set(['pub-key-a', 'pub-key-b']);
        const state = { world_seed: 'test', day: 1, last_tick: 0, rollups: {}, bans: getBansVersion(bans) };
        const packet = buildPersistedArbiterPacket(state, 'sig', bans);

        expect(packet.bans).toEqual(['pub-key-a', 'pub-key-b']);

        const restored = restoreBansFromPacket(packet);
        expect(restored).toEqual(['pub-key-a', 'pub-key-b']);
    });

    test('restoreBansFromPacket falls back to state.bans array when top-level bans absent', () => {
        const packet = { state: { bans: ['legacy-key'] }, signature: 'sig' };
        expect(restoreBansFromPacket(packet)).toEqual(['legacy-key']);
    });

    test('listPersistedBans returns empty array for null/undefined/plain object', () => {
        expect(listPersistedBans(null)).toEqual([]);
        expect(listPersistedBans(undefined)).toEqual([]);
        expect(listPersistedBans({})).toEqual([]);
    });
});
