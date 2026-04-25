/**
 * @jest-environment jsdom
 */

/**
 * Export smoke tests.
 * Verifies that every function/constant used across the codebase is actually exported
 * from its source module. A missing export here = a ReferenceError at runtime.
 *
 * If you add a new export that other files depend on, add it here.
 */

import { jest } from '@jest/globals';

global.BroadcastChannel = jest.fn().mockImplementation(() => ({
    postMessage: jest.fn(),
    onmessage: jest.fn(),
    close: jest.fn(),
}));

jest.mock('@trystero-p2p/torrent', () => ({
    joinRoom: jest.fn(),
    selfId: 'test-peer-id'
}));

import {
    // Simulation
    validateMove, hashStr, seededRNG,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    deriveWorldState,
    getSeason, getSeasonNumber,
    // Scaling
    getShardName,
} from './rules';

import {
    world, ENEMIES, ITEMS, DEFAULT_PLAYER_STATS,
    SEASONS, SEASON_LENGTH, INSTANCE_CAP
} from './data';

import {
    verifyMessage, generateKeyPair, importKey, exportKey,
    signMessage, computeHash, createMerkleRoot,
} from './crypto';

import { IBLT } from './iblt';

import {
    packMove, unpackMove,
    packEmote, unpackEmote,
    packPresence, unpackPresence,
    packDuelCommit, unpackDuelCommit,
} from './packer';

import {
    initAds, showBanner, hideBanner, showRewardedAd
} from './ads';

describe('Module Exports — Smoke Tests', () => {
    describe('rules.js', () => {
        test('simulation functions are exported', () => {
            expect(typeof world).toBe('object');
            expect(typeof validateMove).toBe('function');
            expect(typeof hashStr).toBe('function');
            expect(typeof seededRNG).toBe('function');
            expect(typeof resolveAttack).toBe('function');
            expect(typeof rollLoot).toBe('function');
            expect(typeof xpToLevel).toBe('function');
            expect(typeof levelBonus).toBe('function');
            expect(typeof deriveWorldState).toBe('function');
            expect(typeof getSeason).toBe('function');
            expect(typeof getSeasonNumber).toBe('function');
        });

        test('constants are exported with correct types', () => {
            expect(typeof ENEMIES).toBe('object');
            expect(typeof ITEMS).toBe('object');
            expect(typeof DEFAULT_PLAYER_STATS).toBe('object');
            expect(Array.isArray(SEASONS)).toBe(true);
            expect(typeof SEASON_LENGTH).toBe('number');
        });

        // These two caused a ReferenceError in main.js when Gemini forgot to import them.
        test('getShardName is exported and callable', () => {
            expect(typeof getShardName).toBe('function');
            expect(getShardName('cellar', 1)).toBe('cellar-1');
        });

        test('INSTANCE_CAP is exported and is a number', () => {
            expect(typeof INSTANCE_CAP).toBe('number');
            expect(INSTANCE_CAP).toBeGreaterThan(0);
        });
    });

    describe('crypto.js', () => {
        test('all crypto functions are exported', () => {
            expect(typeof verifyMessage).toBe('function');
            expect(typeof signMessage).toBe('function');
            expect(typeof importKey).toBe('function');
            expect(typeof exportKey).toBe('function');
            expect(typeof generateKeyPair).toBe('function');
            expect(typeof computeHash).toBe('function');
            expect(typeof createMerkleRoot).toBe('function');
        });
    });

    describe('iblt.js', () => {
        test('IBLT class is exported', () => {
            expect(typeof IBLT).toBe('function');
        });

        // Static hashId was added to replace the new IBLT()._hashKey(id) anti-pattern.
        test('IBLT.hashId static method is exported', () => {
            expect(typeof IBLT.hashId).toBe('function');
        });

        test('IBLT instance methods are present', () => {
            const iblt = new IBLT();
            expect(typeof iblt.insert).toBe('function');
            expect(typeof iblt.decode).toBe('function');
            expect(typeof iblt.serialize).toBe('function');
            expect(typeof IBLT.subtract).toBe('function');
            expect(typeof IBLT.fromSerialized).toBe('function');
        });
    });

    describe('packer.js', () => {
        test('all pack/unpack functions are exported', () => {
            expect(typeof packMove).toBe('function');
            expect(typeof unpackMove).toBe('function');
            expect(typeof packEmote).toBe('function');
            expect(typeof unpackEmote).toBe('function');
            expect(typeof packPresence).toBe('function');
            expect(typeof unpackPresence).toBe('function');
            expect(typeof packDuelCommit).toBe('function');
            expect(typeof unpackDuelCommit).toBe('function');
        });
    });

    describe('ads.js', () => {
        test('all ad functions are exported', () => {
            expect(typeof initAds).toBe('function');
            expect(typeof showBanner).toBe('function');
            expect(typeof hideBanner).toBe('function');
            expect(typeof showRewardedAd).toBe('function');
        });
    });

    describe('DEFAULT_PLAYER_STATS shape', () => {
        // Catches bug: PvP used DEFAULT_PLAYER_STATS.defense as a fallback for the
        // *opponent's* defense — this test ensures the field exists with the right type.
        test('has required combat stat fields', () => {
            expect(typeof DEFAULT_PLAYER_STATS.hp).toBe('number');
            expect(typeof DEFAULT_PLAYER_STATS.maxHp).toBe('number');
            expect(typeof DEFAULT_PLAYER_STATS.attack).toBe('number');
            expect(typeof DEFAULT_PLAYER_STATS.defense).toBe('number');
            expect(typeof DEFAULT_PLAYER_STATS.level).toBe('number');
            expect(typeof DEFAULT_PLAYER_STATS.xp).toBe('number');
        });
    });
});
