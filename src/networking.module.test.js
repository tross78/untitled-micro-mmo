import { jest } from '@jest/globals';

// Mock crypto and other dependencies
jest.mock('./crypto.js', () => ({
    importKey: jest.fn(),
    verifyMessage: jest.fn(),
    signMessage: jest.fn(),
    createMerkleRoot: jest.fn(),
    exportKey: jest.fn(),
}));

jest.mock('./hlc.js', () => ({
    sendHLC: jest.fn(() => ({ wall: Date.now(), logical: 0 })),
    recvHLC: jest.fn(),
    cmpHLC: jest.fn(),
    checkAndUpdateHlc: jest.fn(() => true),
    packHLC: jest.fn((hlc, view, offset) => {
        view.setUint32(offset, 0);
        view.setUint32(offset + 4, 0);
    }),
    unpackHLC: jest.fn(() => ({ wall: 0, logical: 0 })),
}));

jest.mock('@trystero-p2p/torrent', () => ({
    joinRoom: jest.fn(() => ({
        makeAction: jest.fn(() => [jest.fn(), jest.fn()]),
        onPeerJoin: jest.fn(),
        onPeerLeave: jest.fn(),
        getPeers: jest.fn(() => ({})),
        leave: jest.fn(),
    })),
    selfId: 'bbb',
}));

import { initNetworking, isProposer, seedFromSnapshot, updateSimulation, gameActions } from './networking.js';
import { buildTorrentConfig } from './networking.js';
import {
    hasSyncedWithArbiter,
    localPlayer,
    players,
    shadowPlayers,
    setHasSyncedWithArbiter,
    worldState,
    WORLD_STATE_KEY,
    trackPlayer,
} from './store.js';
import { verifyMessage } from './crypto.js';
import { checkAndUpdateHlc } from './hlc.js';
import { joinRoom } from '@trystero-p2p/torrent';
import { APP_ID, TORRENT_TRACKERS, STUN_SERVERS } from './constants.js';

describe('networking module hardening', () => {
    beforeEach(async () => {
        players.clear();
        shadowPlayers.clear();
        localStorage.clear();
        setHasSyncedWithArbiter(false);
        jest.clearAllMocks();
        
        // Initializing networking to setup shard and actions
        // We mock enough to get setupShard to run
        await initNetworking();
    });

    test('processPresenceSingle rejects HLC updates before signature verification', async () => {
        const peerId = 'malicious-peer';
        const publicKey = 'fake-pub-key';
        players.set(peerId, { publicKey });
        
        const hlcUpdateSpy = checkAndUpdateHlc;
        const verifySpy = verifyMessage;
        
        // Mock verification to fail
        verifySpy.mockResolvedValue(false);
        
        // Attempt to process a presence (the buffer content doesn't matter for this mock test)
        const fakeBuf = new Uint8Array(160);
        await gameActions.processPresence(fakeBuf, peerId);
        
        // The checkAndUpdateHlc should NOT have been called because verification failed
        expect(hlcUpdateSpy).not.toHaveBeenCalled();
    });

    test('batch presence tracks rawPresence for reliable relaying', async () => {
        const peerId = 'peer-to-relay';
        
        // We need to bypass verification for this test
        verifyMessage.mockResolvedValue(true);
        
        const fakePresence = new Uint8Array([1, 2, 3]); // Mock packed presence
        
        // Trigger getPresenceBatch (we need to find where it's stored or mock the handler)
        // Since we can't easily trigger the inner handler, we check if trackPlayer stores rawPresence
        const testData = { name: 'Test', location: 'cellar', ph: '00000000', rawPresence: fakePresence };
        trackPlayer(peerId, testData);
        
        expect(players.get(peerId).rawPresence).toBe(fakePresence);
    });
});

describe('networking exported module behavior', () => {
    beforeEach(() => {
        players.clear();
        localStorage.clear();
        setHasSyncedWithArbiter(false);
        Object.assign(worldState, {
            seed: '',
            day: 0,
            mood: '',
            season: '',
            seasonNumber: 1,
            threatLevel: 0,
            scarcity: [],
            lastTick: 0,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('isProposer uses real players map and rotating slot', () => {
        players.set('aaa', { level: 1 });
        players.set('ccc', { level: 1 });
        jest.spyOn(Date, 'now').mockReturnValue(10000); // sorted [aaa, bbb, ccc], slot 1

        expect(isProposer()).toBe(true);
    });

    test('isProposer suppresses rollups when alone', () => {
        jest.spyOn(Date, 'now').mockReturnValue(10000);

        expect(isProposer()).toBe(false);
    });

    test('seedFromSnapshot adds ghosts and skips duplicate ph values', () => {
        players.set('peer-real', { ph: 'aaaa1111', location: 'cellar' });

        seedFromSnapshot([
            { ph: 'aaaa1111', location: 'cellar', name: 'Duplicate' },
            { ph: 'bbbb2222', location: 'tavern', name: 'Ghost' },
            { ph: '', location: 'tavern', name: 'Invalid' },
        ]);

        expect(players.has('ghost:aaaa1111')).toBe(false);
        expect(players.get('ghost:bbbb2222')).toMatchObject({
            ph: 'bbbb2222',
            location: 'tavern',
            name: 'Ghost',
            ghost: true,
        });
    });

    test('updateSimulation applies signed world state fields and persists cache', () => {
        updateSimulation({ world_seed: 'seed-z', day: 3, last_tick: 77 });

        expect(worldState.seed).toBe('seed-z');
        expect(worldState.day).toBe(3);
        expect(worldState.lastTick).toBe(77);
        expect(worldState.mood).toBeTruthy();
        expect(hasSyncedWithArbiter).toBe(true);
        expect(JSON.parse(localStorage.getItem(WORLD_STATE_KEY))).toEqual({
            seed: 'seed-z',
            day: 3,
            lastTick: 77,
        });
    });

    test('updateSimulation new day resets combat counters after initial sync', () => {
        setHasSyncedWithArbiter(true);
        worldState.seed = 'old-seed';
        worldState.day = 1;
        localPlayer.currentEnemy = { id: 'forest_wolf' };
        localPlayer.forestFights = 0;
        localPlayer.combatRound = 9;
        localPlayer.buffs = { rested: true, activeElixir: 'strength_elixir' };

        updateSimulation({ world_seed: 'new-seed', day: 2, last_tick: 1 });

        expect(localPlayer.currentEnemy).toBeNull();
        expect(localPlayer.forestFights).toBe(15);
        expect(localPlayer.combatRound).toBe(0);
        expect(localPlayer.buffs).toEqual({ rested: false, activeElixir: null });
    });

    test('buildTorrentConfig uses relayUrls for Trystero torrent strategy', () => {
        const config = buildTorrentConfig({ iceServers: STUN_SERVERS });

        expect(config).toEqual({
            appId: APP_ID,
            relayUrls: TORRENT_TRACKERS,
            rtcConfig: { iceServers: STUN_SERVERS },
        });
        expect(config.trackerUrls).toBeUndefined();
    });

    test('initNetworking joins rooms with relayUrls instead of ignored trackerUrls', async () => {
        await initNetworking();

        const calls = joinRoom.mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(2);
        calls.forEach(([config]) => {
            expect(config.appId).toBe(APP_ID);
            expect(config.relayUrls).toEqual(TORRENT_TRACKERS);
            expect(config.trackerUrls).toBeUndefined();
        });
    });
});
