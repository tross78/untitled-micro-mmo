import { jest } from '@jest/globals';
import { generateKeyPairSync } from 'node:crypto';

jest.mock('@trystero-p2p/torrent', () => ({
    selfId: 'self-peer-id',
}));

import { initIdentity, myEntry } from './identity.js';
import { localPlayer } from './store.js';
import { GAME_NAME } from './data.js';
import { hashStr } from './rules.js';
import { presenceSignaturePayload } from './packer.js';
import { setNode, verifyMessage } from './crypto.js';

function makeStoredKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
    const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
    return { privateKey: privB64, publicKey: pubB64 };
}

describe('identity lifecycle', () => {
    const keyName = `${GAME_NAME}_keys_v4`;
    let originalCrypto;

    beforeAll(() => {
        originalCrypto = window.crypto;
        setNode(false);
    });

    afterAll(() => {
        setNode(true);
        Object.defineProperty(window, 'crypto', { value: originalCrypto, configurable: true });
    });

    beforeEach(() => {
        localStorage.clear();
        Object.assign(localPlayer, {
            name: 'Tester',
            location: 'cellar',
            ph: null,
            level: 2,
            xp: 120,
            x: 3,
            y: 4,
            gold: 9,
            inventory: ['potion'],
            quests: {},
            equipped: { weapon: null, armor: null },
        });
    });

    test('initIdentity loads saved keys and derives localPlayer ph from public key', async () => {
        const stored = makeStoredKeyPair();
        localStorage.setItem(keyName, JSON.stringify(stored));

        await initIdentity();

        expect(localPlayer.ph).toBe((hashStr(stored.publicKey) >>> 0).toString(16).padStart(8, '0'));
    });

    test('initIdentity generates and stores keys when none exist', async () => {
        await initIdentity();

        const stored = JSON.parse(localStorage.getItem(keyName));
        expect(stored.publicKey).toBeTruthy();
        expect(stored.privateKey).toBeTruthy();
        expect(localPlayer.ph).toBe((hashStr(stored.publicKey) >>> 0).toString(16).padStart(8, '0'));
    });

    test('myEntry signs the canonical presence payload', async () => {
        await initIdentity();
        const stored = JSON.parse(localStorage.getItem(keyName));

        const entry = await myEntry();
        const importedPublic = await crypto.subtle.importKey(
            'raw',
            Uint8Array.from(atob(stored.publicKey), c => c.charCodeAt(0)),
            { name: 'Ed25519' },
            true,
            ['verify']
        );

        await expect(verifyMessage(
            JSON.stringify(presenceSignaturePayload(entry)),
            entry.signature,
            importedPublic
        )).resolves.toBe(true);
    });
});
