// @ts-check
import { jest } from '@jest/globals';

// ── Shared mock harness ──────────────────────────────────────────────────────

const makeMockRoom = (name) => {
    const actionHandlers = new Map();
    const room = {
        name,
        _onPeerJoin: null,
        _onPeerLeave: null,
        makeAction: jest.fn((action) => {
            const send = jest.fn();
            const register = jest.fn((cb) => actionHandlers.set(action, cb));
            room._sends.set(action, send);
            return [send, register];
        }),
        onPeerJoin: jest.fn((cb) => { room._onPeerJoin = cb; }),
        onPeerLeave: jest.fn((cb) => { room._onPeerLeave = cb; }),
        getPeers: jest.fn(() => ({})),
        leave: jest.fn(),
        _sends: new Map(),
        emitAction(action, ...args) {
            const handler = actionHandlers.get(action);
            return handler ? handler(...args) : undefined;
        },
        emitPeerJoin(peerId) { return room._onPeerJoin?.(peerId); },
        emitPeerLeave(peerId) { return room._onPeerLeave?.(peerId); },
    };
    return room;
};

jest.mock('../network/transport.js', () => ({
    selfId: 'self-peer-id',
    joinRoom: jest.fn((_config, name) => makeMockRoom(name)),
}));

jest.mock('../security/crypto.js', () => ({
    importKey: jest.fn(async () => ({})),
    verifyMessage: jest.fn(async () => true),
    signMessage: jest.fn(async () => 'sig'),
    createMerkleRoot: jest.fn(async () => 'root'),
    exportKey: jest.fn(async () => 'self-public-key'),
    stableStringify: jest.fn((v) => JSON.stringify(v)),
}));

jest.mock('../security/identity.js', () => ({
    arbiterPublicKey: 'arbiter-public-key',
    playerKeys: { privateKey: 'self-private-key', publicKey: 'self-public-key-obj' },
    myEntry: jest.fn(async () => ({
        name: 'Tester', location: 'cellar', ph: 'abcd1234',
        level: 1, xp: 0, x: 5, y: 5, gold: 0, inventory: [], quests: {},
    })),
}));

jest.mock('../network/arbiter-signal.js', () => ({
    registerWithHints: jest.fn(async () => []),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reconnect and liveness regressions', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();
        localStorage.clear();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('stale sweep evicts silent peer and triggers heal within stale window + sweep interval', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { players, trackPlayer, localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;

        // Simulate peer joining and completing handshake + presence (sets _peerLastPresenceAt).
        shardRoom.emitPeerJoin('peer-silent');
        await jest.advanceTimersByTimeAsync(150);
        const { hashStr } = await import('../rules/index.js');
        const silentKey = 'peer-pub-key';
        const silentPh = (hashStr(silentKey) >>> 0).toString(16).padStart(8, '0');
        shardRoom.emitAction('identity_handshake', { publicKey: silentKey }, 'peer-silent');
        trackPlayer('peer-silent', { publicKey: silentKey, ph: silentPh, ghost: false, ts: Date.now() });
        // Trigger presence to set _peerLastPresenceAt — use the packer to build a valid buf.
        const { packPresence } = await import('../network/packer.js');
        const presenceBuf = packPresence({ name: 'Silent', location: 'cellar', ph: silentPh, level: 1, xp: 0, x: 0, y: 0, gold: 0, inventory: [], quests: {}, ts: Date.now(), signature: btoa('s'.repeat(64)), hlc: 1 });
        await shardRoom.emitAction('presence_single', presenceBuf, 'peer-silent');

        const initialJoinCallCount = joinRoom.mock.calls.length;

        // Advance past stale window + one sweep tick (20s + 5s).
        await jest.advanceTimersByTimeAsync(26_000);

        // Peer should be stale or evicted (stale after NETWORK_PEER_STALE_MS, evicted at GHOST_TTL_MS).
        // With same-shard rejoin preserving players, the entry stays but becomes stale=true.
        const entry = players.get('peer-silent');
        expect(!entry || entry.ghost || entry.stale).toBeTruthy();

        // Heal should have fired: joinRoom called again for shard.
        const newCallCount = joinRoom.mock.calls.length;
        expect(newCallCount).toBeGreaterThan(initialJoinCallCount);
    });

    test('urgent heal fires immediately when last peer drops via onPeerLeave', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;
        const initialJoinCallCount = joinRoom.mock.calls.length;

        // Peer leaves explicitly — onPeerLeave triggers urgent heal.
        shardRoom.emitPeerLeave('peer-gone');

        // Urgent heal bypasses the 10s interval; should fire within a very short window.
        await jest.advanceTimersByTimeAsync(3_000);

        expect(joinRoom.mock.calls.length).toBeGreaterThan(initialJoinCallCount);
    });

    test('arbiter hints from registerWithHints seed HyParView passive view', async () => {
        const { HyParView } = await import('../network/hyparview.js');
        const mergeSpy = jest.spyOn(HyParView.prototype, 'mergeShuffle');

        const { registerWithHints } = await import('../network/arbiter-signal.js');
        registerWithHints.mockResolvedValueOnce([
            { id: 'hint-peer-1', ph: 'aaaa0001' },
            { id: 'hint-peer-2', ph: 'aaaa0002' },
        ]);

        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        localPlayer.ph = 'abcd1234';
        await initNetworking();

        // registerWithArbiter fires after 1s timeout.
        await jest.advanceTimersByTimeAsync(1500);

        expect(mergeSpy).toHaveBeenCalledWith(
            expect.arrayContaining(['hint-peer-1', 'hint-peer-2']),
            'self-peer-id',
        );
    });

    test('failed handshake peer triggers heal and is tracked for future exclusion', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;
        const initialJoinCallCount = joinRoom.mock.calls.length;

        // peer-bad joins but never sends identity — handshake timeout fires at 5s.
        shardRoom.emitPeerJoin('peer-bad');
        await jest.advanceTimersByTimeAsync(7_000); // past NETWORK_HANDSHAKE_TIMEOUT_MS (5s) + heal delay

        // Heal should have been triggered as a result of handshake timeout (scheduleHeal).
        // Observable via joinRoom being called again for the shard room.
        expect(joinRoom.mock.calls.length).toBeGreaterThan(initialJoinCallCount);
    });

    test('identity-only peer does not count as usable and still triggers handshake heal', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer, players } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');
        const { countUsableShardPeers } = await import('../network/heal.js');
        const { shardKnownPeers } = await import('../network/index.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;
        const initialJoinCallCount = joinRoom.mock.calls.length;

        shardRoom.emitPeerJoin('peer-identity-only');
        shardRoom.emitAction('identity_handshake', { publicKey: 'identity-only-key' }, 'peer-identity-only');
        expect(players.get('peer-identity-only')?.publicKey).toBe('identity-only-key');
        expect(countUsableShardPeers(shardKnownPeers, players)).toBe(0);

        await jest.advanceTimersByTimeAsync(7_000);

        expect(joinRoom.mock.calls.length).toBeGreaterThan(initialJoinCallCount);
    });

    test('invalid presence does not refresh liveness or mark peer usable', async () => {
        const { initNetworking, getPeerLastPresenceSnapshot, shardKnownPeers } = await import('../network/index.js');
        const { localPlayer, players } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');
        const { packPresence } = await import('../network/packer.js');
        const { countUsableShardPeers } = await import('../network/heal.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;
        shardRoom.emitPeerJoin('peer-invalid');
        shardRoom.emitAction('identity_handshake', { publicKey: 'invalid-key' }, 'peer-invalid');

        const invalidPresence = packPresence({
            name: 'Invalid',
            location: 'cellar',
            ph: 'dead0001',
            level: 1,
            xp: 0,
            x: 0,
            y: 0,
            gold: 0,
            inventory: [],
            quests: {},
            ts: Date.now(),
            signature: btoa('s'.repeat(64)),
            hlc: 1,
        });
        await shardRoom.emitAction('presence_single', invalidPresence, 'peer-invalid');

        expect(getPeerLastPresenceSnapshot().has('peer-invalid')).toBe(false);
        expect(players.get('peer-invalid')?.presenceVerifiedAt).toBeUndefined();
        expect(countUsableShardPeers(shardKnownPeers, players)).toBe(0);
    });

    test('only peers with verified presence are saved as warm introducers', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer, trackPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');
        const { hashStr } = await import('../rules/index.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;

        // peer-no-presence joins and completes identity but never sends presence.
        shardRoom.emitPeerJoin('peer-no-presence');
        shardRoom.emitAction('identity_handshake', { publicKey: 'pp-key' }, 'peer-no-presence');
        trackPlayer('peer-no-presence', { publicKey: 'pp-key', ph: 'beef0001', ghost: false });

        // peer-with-presence completes the full flow including a valid presence packet.
        // The ph in the packed presence must match hashStr(publicKey) for processPresenceSingle to accept it.
        const wpKey = 'wp-key';
        const wpPh = (hashStr(wpKey) >>> 0).toString(16).padStart(8, '0');
        shardRoom.emitPeerJoin('peer-with-presence');
        shardRoom.emitAction('identity_handshake', { publicKey: wpKey }, 'peer-with-presence');
        trackPlayer('peer-with-presence', { publicKey: wpKey, ph: wpPh, ghost: false });
        const { packPresence } = await import('../network/packer.js');
        const buf = packPresence({
            name: 'P', location: 'cellar', ph: wpPh, level: 1, xp: 0,
            x: 0, y: 0, gold: 0, inventory: [], quests: {},
            ts: Date.now(), signature: btoa('s'.repeat(64)), hlc: 1,
        });
        await shardRoom.emitAction('presence_single', buf, 'peer-with-presence');

        // Trigger saveIntroducers by calling joinInstance (which leaves current shard first).
        shardRoom.getPeers.mockReturnValue({ 'peer-no-presence': true, 'peer-with-presence': true });
        const { joinInstance } = await import('../network/index.js');
        await joinInstance('cellar', 2, null);

        // Only the peer with verified presence should be saved.
        const raw = localStorage.getItem('fenhollow_introducers_v2');
        const cache = raw ? JSON.parse(raw) : {};
        const savedPeers = Object.values(cache).flatMap(e => e.peers || []);
        expect(savedPeers).toContain('peer-with-presence');
        expect(savedPeers).not.toContain('peer-no-presence');
    });

    test('same-shard rejoin preserves players while rebuilding shard channels', async () => {
        const { initNetworking, joinInstance } = await import('../network/index.js');
        const { localPlayer, players, trackPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        localPlayer.location = 'cellar';
        await initNetworking();

        trackPlayer('peer-stays-visible', {
            name: 'Visible',
            location: 'cellar',
            publicKey: 'visible-key',
            ph: 'beef0001',
            ghost: false,
            presenceVerifiedAt: Date.now(),
        });
        const firstShardRoom = joinRoom.mock.results.find((r) => r.value.name === 'cellar-1').value;

        await joinInstance('cellar', 1, null);

        expect(firstShardRoom.leave).toHaveBeenCalled();
        expect(players.get('peer-stays-visible')).toEqual(expect.objectContaining({
            name: 'Visible',
            publicKey: 'visible-key',
            ghost: false,
        }));
    });

    test('different-shard join clears prior shard players', async () => {
        const { initNetworking, joinInstance } = await import('../network/index.js');
        const { localPlayer, players, trackPlayer } = await import('../state/store.js');

        localPlayer.ph = 'abcd1234';
        localPlayer.location = 'cellar';
        await initNetworking();

        trackPlayer('peer-old-shard', {
            name: 'Old',
            location: 'cellar',
            publicKey: 'old-key',
            ph: 'beef0002',
            ghost: false,
            presenceVerifiedAt: Date.now(),
        });

        await joinInstance('tavern', 1, null);

        expect(players.has('peer-old-shard')).toBe(false);
    });
});
