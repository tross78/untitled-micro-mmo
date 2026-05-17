import { jest } from '@jest/globals';

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
        emitPeerJoin(peerId) {
            return room._onPeerJoin ? room._onPeerJoin(peerId) : undefined;
        },
        emitPeerLeave(peerId) {
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
});
