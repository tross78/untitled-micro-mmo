import { jest } from '@jest/globals';

const makeMockRoom = (name) => {
    const actionHandlers = new Map();
    const connectedPeers = new Set();
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
        getPeers: jest.fn(() => {
            const out = {};
            for (const id of connectedPeers) out[id] = true;
            return out;
        }),
        leave: jest.fn(),
        _sends: new Map(),
        emitAction(action, ...args) {
            const handler = actionHandlers.get(action);
            return handler ? handler(...args) : undefined;
        },
        emitPeerJoin(peerId) {
            connectedPeers.add(peerId);
            return room._onPeerJoin ? room._onPeerJoin(peerId) : undefined;
        },
        emitPeerLeave(peerId) {
            connectedPeers.delete(peerId);
            return room._onPeerLeave ? room._onPeerLeave(peerId) : undefined;
        },
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
    stableStringify: jest.fn((value) => JSON.stringify(value)),
}));

jest.mock('../security/identity.js', () => ({
    arbiterPublicKey: 'arbiter-public-key',
    playerKeys: { privateKey: 'self-private-key', publicKey: 'self-public-key-obj' },
    myEntry: jest.fn(async () => ({
        name: 'Tester',
        location: 'cellar',
        ph: 'abcd1234',
        level: 1,
        xp: 0,
        x: 5,
        y: 5,
        gold: 0,
        inventory: [],
        quests: {},
    })),
}));

describe('network peer set scoping', () => {
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

    test('global and shard peer sets track joins and leaves independently', async () => {
        const { initNetworking, globalKnownPeers, shardKnownPeers } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const globalRoom = joinRoom.mock.results.find((r) => r.value.name === 'global').value;
        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;

        globalRoom.emitPeerJoin('global-peer');
        shardRoom.emitPeerJoin('shard-peer');

        expect(globalKnownPeers.has('global-peer')).toBe(true);
        expect(globalKnownPeers.has('shard-peer')).toBe(false);
        expect(shardKnownPeers.has('shard-peer')).toBe(true);
        expect(shardKnownPeers.has('global-peer')).toBe(false);

        globalRoom.emitPeerLeave('global-peer');
        shardRoom.emitPeerLeave('shard-peer');

        expect(globalKnownPeers.has('global-peer')).toBe(false);
        expect(shardKnownPeers.has('shard-peer')).toBe(false);
    });

    test('browser global and shard rooms plumb the full configured ICE_SERVERS', async () => {
        // TURN creds are injected at build time (empty in tests → STUN-only here), so we verify the
        // browser rooms forward the whole configured ICE_SERVERS set rather than asserting a turn:
        // entry. This still catches the real regression (browser rooms silently dropping to STUN-only
        // / a stripped-down list); when TURN is injected in CI it flows through automatically.
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');
        const { ICE_SERVERS } = await import('../infra/constants.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const globalConfig = joinRoom.mock.calls.find(([, name]) => name === 'global')?.[0];
        const shardConfig = joinRoom.mock.calls.find(([, name]) => name === 'cellar-1')?.[0];

        const urlsOf = (cfg) => (cfg?.rtcConfig?.iceServers || [])
            .map(s => String(Array.isArray(s.urls) ? s.urls[0] : s.urls));
        const expected = ICE_SERVERS.map(s => String(Array.isArray(s.urls) ? s.urls[0] : s.urls));

        expect(expected.length).toBeGreaterThan(0);
        for (const url of expected) {
            expect(urlsOf(globalConfig)).toContain(url);
            expect(urlsOf(shardConfig)).toContain(url);
        }
    });

    test('late global peers get an immediate shard hint and registration payload', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        localPlayer.location = 'cellar';
        await initNetworking();

        const globalRoom = joinRoom.mock.results.find((r) => r.value.name === 'global').value;
        const sendSeekingShard = globalRoom._sends.get('seeking_shard');
        const sendRegisterPresence = globalRoom._sends.get('register_presence');

        await globalRoom.emitPeerJoin('late-peer');

        expect(sendSeekingShard).toHaveBeenCalledWith('cellar-1', ['late-peer']);
        expect(sendRegisterPresence).toHaveBeenCalledWith(
            expect.objectContaining({
                shard: 'cellar-1',
                publicKey: 'self-public-key',
                ph: 'abcd1234',
            }),
            ['late-peer']
        );
    });

    test('arbiter peer hints seed the shard introducer view without forcing a heal', async () => {
        const { HyParView } = await import('../network/hyparview.js');
        const seedSpy = jest.spyOn(HyParView.prototype, 'seedAsActive');
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        localPlayer.location = 'cellar';
        await initNetworking();

        const joinCountBeforeHints = joinRoom.mock.calls.length;
        const globalRoom = joinRoom.mock.results.find((r) => r.value.name === 'global').value;
        globalRoom.emitAction('arbiter_peer_hints', [
            { id: 'hint-peer-1', ph: 'aaaa1111' },
            { id: 'hint-peer-2', ph: 'bbbb2222' },
        ], 'arbiter-peer');

        expect(seedSpy).toHaveBeenCalledWith(
            expect.arrayContaining(['hint-peer-1', 'hint-peer-2']),
            'self-peer-id'
        );
        expect(joinRoom.mock.calls.length).toBe(joinCountBeforeHints);
    });

    test('direct same-shard global registration sends immediate signed presence bootstrap', async () => {
        const { HyParView } = await import('../network/hyparview.js');
        const seedSpy = jest.spyOn(HyParView.prototype, 'seedAsActive');
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer, players } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        localPlayer.location = 'cellar';
        await initNetworking();

        const globalRoom = joinRoom.mock.results.find((r) => r.value.name === 'global').value;
        const sendPresenceBootstrap = globalRoom._sends.get('presence_bootstrap');

        await globalRoom.emitAction('register_presence', {
            ph: 'beef0001',
            id: 'same-shard-peer',
            name: 'Beta',
            location: 'cellar',
            shard: 'cellar-1',
            level: 1,
            x: 5,
            y: 5,
            publicKey: 'peer-public-key',
        }, 'same-shard-peer');

        expect(players.get('same-shard-peer')).toEqual(expect.objectContaining({
            publicKey: 'peer-public-key',
            ph: 'beef0001',
        }));
        expect(seedSpy).toHaveBeenCalledWith(['same-shard-peer'], 'self-peer-id');
        expect(sendPresenceBootstrap).toHaveBeenCalledWith(
            expect.objectContaining({
                publicKey: 'self-public-key',
                presence: expect.any(Uint8Array),
            }),
            ['same-shard-peer']
        );
    });
});
