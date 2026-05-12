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

describe('networking bugfix regressions', () => {
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

    test('queued hard-state action logs replay locally after arbiter reconnect', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { hardStateQueue, shadowPlayers, players, localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        hardStateQueue.push({
            peerId: 'peer-a',
            publicKey: 'peer-a-public-key',
            data: { type: 'kill', index: 1, target: 'forest_wolf', data: null, signature: 'peer-sig' },
            ts: Date.now(),
        });

        const globalRoom = joinRoom.mock.results.find((r) => r.value.name === 'global').value;
        await globalRoom.emitAction('world_state', { state: { world_seed: 'seed-z', day: 2, last_tick: 9 }, signature: 'arbiter-sig' }, 'arbiter');

        expect(hardStateQueue).toHaveLength(0);
        expect(players.get('peer-a')).toMatchObject({ publicKey: 'peer-a-public-key' });
        expect(shadowPlayers.get('peer-a')).toMatchObject({ actionIndex: 1 });
    });

    test('peer join handshake sends signed packed presence instead of raw entry objects', async () => {
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');
        const { joinRoom } = await import('../network/transport.js');

        localPlayer.ph = 'abcd1234';
        await initNetworking();

        const shardRoom = joinRoom.mock.results.find((r) => r.value.name !== 'global').value;
        const sendPresenceSingle = shardRoom._sends.get('presence_single');

        shardRoom.emitPeerJoin('peer-b');
        await jest.advanceTimersByTimeAsync(150);

        expect(sendPresenceSingle).toHaveBeenCalled();
        const [payload] = sendPresenceSingle.mock.calls[0];
        expect(payload).toBeInstanceOf(Uint8Array);
    });

    test('cached introducers seed HyParView passive view on shard join', async () => {
        const { HyParView } = await import('../network/hyparview.js');
        const mergeSpy = jest.spyOn(HyParView.prototype, 'mergeShuffle');
        const { initNetworking } = await import('../network/index.js');
        const { localPlayer } = await import('../state/store.js');

        localPlayer.ph = 'abcd1234';
        localStorage.setItem('hearthwick_introducers_v1', JSON.stringify({
            'hearthwick-cellar-v1-1': { peers: ['peer-x', 'peer-y'], ts: Date.now() },
        }));

        await initNetworking();

        expect(mergeSpy).toHaveBeenCalledWith(['peer-x', 'peer-y'], 'self-peer-id');
    });
});
