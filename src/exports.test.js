/**
 * @jest-environment jsdom
 */

/**
 * Robust Export & Import Verification
 * Verifies that all modules export their intended symbols with correct types.
 * This prevents regressions when refactoring/splitting modules.
 */

import { jest } from '@jest/globals';

// Mock Trystero to allow tests to run in Node environment
jest.mock('@trystero-p2p/torrent', () => ({
    joinRoom: jest.fn(),
    selfId: 'test-peer-id'
}));

// Mock BroadcastChannel for environments where it is not defined
if (typeof global.BroadcastChannel === 'undefined') {
    global.BroadcastChannel = jest.fn().mockImplementation(() => ({
        postMessage: jest.fn(),
        onmessage: jest.fn(),
        close: jest.fn(),
    }));
}

// 1. Rules & Simulation
import * as Rules from './rules.js';
import * as Data from './data.js';

// 2. State & Identity
import * as Store from './store.js';
import * as Identity from './identity.js';

// 3. Networking & Protocol
import * as Networking from './networking.js';
import * as Packer from './packer.js';
import * as Crypto from './crypto.js';
import { IBLT } from './iblt.js';

// 4. UI & Commands
import * as Commands from './commands.js';
import * as UI from './ui.js';
import * as Ads from './ads.js';
import * as Autocomplete from './autocomplete.js';

describe('Deep Import/Export Audit', () => {

    describe('rules.js (Simulation)', () => {
        const functions = [
            'seededRNG', 'hashStr', 'getSeason', 'getSeasonNumber',
            'nextMood', 'rollScarcity', 'getMood', 'getThreatLevel',
            'deriveWorldState', 'resolveAttack', 'rollLoot', 'xpToLevel',
            'levelBonus', 'getShardName', 'validateMove', 'getNPCLocation', 'getNPCDialogue'
        ];
        functions.forEach(fn => {
            test(`exports ${fn} function`, () => {
                expect(typeof Rules[fn]).toBe('function');
            });
        });
    });

    describe('data.js (Static Data)', () => {
        const constants = [
            'GAME_NAME', 'ENABLE_ADS', 'SEASONS', 'SEASON_LENGTH',
            'moodMarkov', 'SCARCITY_ITEMS', 'MOOD_INITIAL', 'NPCS',
            'QUESTS', 'DIALOGUE_POOLS', 'ENEMIES', 'ITEMS',
            'DEFAULT_PLAYER_STATS', 'INSTANCE_CAP', 'world'
        ];
        constants.forEach(c => {
            test(`exports ${c} constant`, () => {
                expect(Data[c]).toBeDefined();
            });
        });
        test('GAME_NAME is a string', () => expect(typeof Data.GAME_NAME).toBe('string'));
    });

    describe('store.js (Shared State)', () => {
        test('exports worldState object', () => expect(typeof Store.worldState).toBe('object'));
        test('exports players Map', () => expect(Store.players instanceof Map).toBe(true));
        test('exports localPlayer object', () => expect(typeof Store.localPlayer).toBe('object'));
        test('exports saveLocalState function', () => expect(typeof Store.saveLocalState).toBe('function'));
        test('exports loadLocalState function', () => expect(typeof Store.loadLocalState).toBe('function'));
    });

    describe('networking.js (P2P)', () => {
        test('exports initNetworking function', () => expect(typeof Networking.initNetworking).toBe('function'));
        test('exports gameActions object', () => expect(typeof Networking.gameActions).toBe('object'));
        test('exports rooms object', () => expect(typeof Networking.rooms).toBe('object'));
        test('exports isProposer function', () => expect(typeof Networking.isProposer).toBe('function'));
    });

    describe('commands.js (Game Loop)', () => {
        test('exports handleCommand function', () => expect(typeof Commands.handleCommand).toBe('function'));
        test('exports getPlayerName function', () => expect(typeof Commands.getPlayerName).toBe('function'));
        test('exports resolveRound function', () => expect(typeof Commands.resolveRound).toBe('function'));
    });

    describe('crypto.js (Security)', () => {
        const functions = [
            'generateKeyPair', 'exportKey', 'importKey',
            'signMessage', 'verifyMessage', 'computeHash', 'createMerkleRoot'
        ];
        functions.forEach(fn => {
            test(`exports ${fn} function`, () => {
                expect(typeof Crypto[fn]).toBe('function');
            });
        });
    });

    describe('packer.js (Binary)', () => {
        const pairs = ['Move', 'Emote', 'Presence', 'DuelCommit'];
        pairs.forEach(p => {
            test(`exports pack${p} and unpack${p}`, () => {
                expect(typeof Packer[`pack${p}`]).toBe('function');
                expect(typeof Packer[`unpack${p}`]).toBe('function');
            });
        });
    });

    describe('ui.js & visual effects', () => {
        test('exports log function', () => expect(typeof UI.log).toBe('function'));
        test('exports triggerShake function', () => expect(typeof UI.triggerShake).toBe('function'));
        test('exports printStatus function', () => expect(typeof UI.printStatus).toBe('function'));
    });

    describe('ads.js (Monetization Architecture)', () => {
        test('exports initAds function', () => expect(typeof Ads.initAds).toBe('function'));
        test('exports showRewardedAd function', () => expect(typeof Ads.showRewardedAd).toBe('function'));
    });

    describe('autocomplete.js', () => {
        test('exports getSuggestions function', () => expect(typeof Autocomplete.getSuggestions).toBe('function'));
    });
});

/**
 * ESM Compliance Test
 * Node.js on the Pi Zero requires explicit .js extensions.
 */
describe('ESM Compliance (Node.js/Arbiter)', () => {
    const fs = require('node:fs');
    const path = require('node:path');

    const getFiles = (dir) => {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) results = results.concat(getFiles(file));
            else if (file.endsWith('.js')) results.push(file);
        });
        return results;
    };

    const srcFiles = getFiles(path.join(__dirname, '../src'));
    const arbiterFiles = getFiles(path.join(__dirname, '../arbiter'));
    const allFiles = [...srcFiles, ...arbiterFiles];

    allFiles.forEach(file => {
        if (file.includes('node_modules') || file.includes('exports.test.js')) return;
        
        test(`File ${path.basename(file)} uses .js extensions for all internal imports`, () => {
            const content = fs.readFileSync(file, 'utf8');
            // Regex to find imports/exports from local paths
            // matches: import ... from './foo' or import './foo' or export ... from '../bar'
            const internalPathRegex = /(?:import|export).*?from\s+['"](\.\.?\/[^'"]+)['"]/g;
            let match;
            while ((match = internalPathRegex.exec(content)) !== null) {
                const importPath = match[1];
                expect(importPath).toMatch(/\.js$/);
            }
        });
    });
});
