import { jest } from '@jest/globals';

jest.mock('@trystero-p2p/torrent', () => ({
    selfId: 'self-peer-id',
}));

jest.mock('./persistence.js', () => ({
    loadState: jest.fn(),
}));

import { loadState } from './persistence.js';
import {
    _presenceDelta,
    bans,
    bansHash,
    clearPresenceDelta,
    evictPlayer,
    evictShadowPlayer,
    loadLocalState,
    localPlayer,
    players,
    pruneStale,
    setBans,
    shadowPlayers,
    trackPlayer,
    trackShadowPlayer,
    worldState,
    WORLD_STATE_KEY,
} from './store.js';

describe('store state helpers', () => {
    beforeEach(() => {
        players.clear();
        shadowPlayers.clear();
        clearPresenceDelta();
        localStorage.clear();
        loadState.mockReset();
    });

    test('trackPlayer records joined delta and evictPlayer records left delta', () => {
        trackPlayer('peer-a', { name: 'Alice', ts: Date.now() });

        expect(players.has('peer-a')).toBe(true);
        expect(_presenceDelta.joined.has('peer-a')).toBe(true);

        evictPlayer('peer-a');

        expect(players.has('peer-a')).toBe(false);
        expect(_presenceDelta.left.has('peer-a')).toBe(true);
        expect(_presenceDelta.joined.has('peer-a')).toBe(false);
    });

    test('updating an existing player does not re-add joined delta', () => {
        trackPlayer('peer-a', { level: 1 });
        clearPresenceDelta();

        trackPlayer('peer-a', { level: 2 });

        expect(players.get('peer-a').level).toBe(2);
        expect(_presenceDelta.joined.size).toBe(0);
    });

    test('trackShadowPlayer stores bounded shadow state and evict removes it', () => {
        trackShadowPlayer('peer-a', {
            ph: 'abcd1234',
            level: 3,
            xp: 300,
            inventory: ['potion'],
            gold: 10,
            quests: { wolf_hunt: { progress: 1 } },
            signature: 'sig',
        });

        expect(shadowPlayers.get('peer-a')).toMatchObject({
            ph: 'abcd1234',
            level: 3,
            xp: 300,
            inventory: ['potion'],
            gold: 10,
            signature: 'sig',
        });

        evictShadowPlayer('peer-a');
        expect(shadowPlayers.has('peer-a')).toBe(false);
    });

    test('setBans replaces ban list and hash', () => {
        setBans(['a', 'b'], 'hash-1');

        expect([...bans]).toEqual(['a', 'b']);
        expect(bansHash).toBe('hash-1');
    });

    test('pruneStale evicts old peers but keeps self', () => {
        const now = 1777594000000;
        jest.spyOn(Date, 'now').mockReturnValue(now);
        trackPlayer('old-peer', { ts: now - 10000 });
        trackPlayer('self-peer-id', { ts: now - 10000 });
        trackPlayer('fresh-peer', { ts: now });

        pruneStale(5000);

        expect(players.has('old-peer')).toBe(false);
        expect(players.has('self-peer-id')).toBe(true);
        expect(players.has('fresh-peer')).toBe(true);
        Date.now.mockRestore();
    });

    test('loadLocalState clamps persisted player fields and rejects unknown location/items', async () => {
        loadState.mockResolvedValue({
            _version: 1,
            name: 'Saved',
            location: 'missing_room',
            hp: 999,
            maxHp: 20,
            gold: 9999999,
            xp: 100,
            inventory: ['potion', 'not_an_item'],
        });

        await loadLocalState();

        expect(localPlayer.name).toBe('Saved');
        expect(localPlayer.location).toBe('cellar');
        expect(localPlayer.hp).toBe(20);
        expect(localPlayer.gold).toBe(999999);
        expect(localPlayer.inventory).toEqual(['potion']);
    });

    test('loadLocalState restores cached derived world state', async () => {
        loadState.mockResolvedValue(null);
        localStorage.setItem(WORLD_STATE_KEY, JSON.stringify({ seed: 'seed-a', day: 4, lastTick: 99 }));

        await loadLocalState();

        expect(worldState.seed).toBe('seed-a');
        expect(worldState.day).toBe(4);
        expect(worldState.lastTick).toBe(99);
        expect(worldState.mood).toBeTruthy();
    });
});
