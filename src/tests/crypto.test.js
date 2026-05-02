import { generateKeyPairSync } from 'node:crypto';
import { computeHash, createMerkleRoot, signMessage, verifyMessage } from '../security/crypto.js';

// Helpers: generate a real Ed25519 keypair and extract raw Base64 fields
// that match the format our crypto module uses (raw 32-byte public, PKCS8 seed private).
function makeTestKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const rawSeed = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(16);
    const rawPub  = publicKey.export({ type: 'spki',  format: 'der' }).slice(12);
    return { privB64: rawSeed.toString('base64'), pubB64: rawPub.toString('base64') };
}

describe('Crypto Utilities', () => {
    describe('computeHash', () => {
        test('is deterministic', async () => {
            const h1 = await computeHash('hello');
            const h2 = await computeHash('hello');
            expect(h1).toBe(h2);
            expect(h1).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        });

        test('different inputs produce different hashes', async () => {
            const h1 = await computeHash('a');
            const h2 = await computeHash('b');
            expect(h1).not.toBe(h2);
        });
    });

    describe('signMessage + verifyMessage', () => {
        test('sign then verify with correct key returns true', async () => {
            const { privB64, pubB64 } = makeTestKeyPair();
            const sig = await signMessage('hello world', privB64);
            expect(typeof sig).toBe('string');
            expect(sig.length).toBeGreaterThan(0);
            await expect(verifyMessage('hello world', sig, pubB64)).resolves.toBe(true);
        });

        test('verify returns false when message is tampered', async () => {
            const { privB64, pubB64 } = makeTestKeyPair();
            const sig = await signMessage('original message', privB64);
            await expect(verifyMessage('tampered message', sig, pubB64)).resolves.toBe(false);
        });

        test('verify returns false when signature is from a different key', async () => {
            const { privB64 } = makeTestKeyPair();
            const { pubB64: wrongPub } = makeTestKeyPair();
            const sig = await signMessage('hello', privB64);
            await expect(verifyMessage('hello', sig, wrongPub)).resolves.toBe(false);
        });

        // Catches bug: passing ph (8-char hex hash) instead of a real public key to verifyMessage.
        // The ph is derived from the public key, not the key itself — verifyMessage must reject it.
        test('verifyMessage throws or returns false when given a ph hash string instead of a public key', async () => {
            const { privB64 } = makeTestKeyPair();
            const sig = await signMessage('hello', privB64);
            const ph = 'abcd1234'; // 8-char hex — what getPlayerEntry().ph looks like
            // Node path: createPublicKey will throw on invalid DER; test that it doesn't silently pass
            await expect(verifyMessage('hello', sig, ph)).rejects.toThrow();
        });

        // Catches bug: passing a raw Base64 public key string directly to verifyMessage in browser.
        // In Node path this works since verifyMessage handles strings, but confirms the sign/verify
        // contract: only the paired public key verifies a signature.
        test('verifyMessage with correct Base64 public key string works end-to-end', async () => {
            const { privB64, pubB64 } = makeTestKeyPair();
            const msg = JSON.stringify({ rollup: { shard: 'app-cellar-1', root: 'abc', count: 5 } });
            const sig = await signMessage(msg, privB64);
            await expect(verifyMessage(msg, sig, pubB64)).resolves.toBe(true);
        });

        test('signatures are not interchangeable across different messages', async () => {
            const { privB64, pubB64 } = makeTestKeyPair();
            const sig1 = await signMessage('message-one', privB64);
            const sig2 = await signMessage('message-two', privB64);
            // sig1 should not verify message-two and vice versa
            await expect(verifyMessage('message-two', sig1, pubB64)).resolves.toBe(false);
            await expect(verifyMessage('message-one', sig2, pubB64)).resolves.toBe(false);
        });

        test('presence data sign/verify round-trip matches real usage pattern', async () => {
            const { privB64, pubB64 } = makeTestKeyPair();
            const presenceData = {
                name: 'Tyson', location: 'cellar', ph: 'abcd1234',
                level: 3, xp: 120, ts: 1700000000000
            };
            const sig = await signMessage(JSON.stringify(presenceData), privB64);
            await expect(verifyMessage(JSON.stringify(presenceData), sig, pubB64)).resolves.toBe(true);
            // Mutating one field must break verification
            const tampered = { ...presenceData, level: 99 };
            await expect(verifyMessage(JSON.stringify(tampered), sig, pubB64)).resolves.toBe(false);
        });
    });

    describe('createMerkleRoot', () => {
        test('is deterministic for same leaves', async () => {
            const leaves = ['alice:1:0:cellar', 'bob:1:0:cellar'];
            const r1 = await createMerkleRoot(leaves);
            const r2 = await createMerkleRoot(leaves);
            expect(r1).toBe(r2);
            expect(r1).toHaveLength(64); // SHA-256 hex
        });

        test('order of leaves matters', async () => {
            const l1 = ['a', 'b'];
            const l2 = ['b', 'a'];
            const r1 = await createMerkleRoot(l1);
            const r2 = await createMerkleRoot(l2);
            expect(r1).not.toBe(r2);
        });

        test('empty leaves returns empty string', async () => {
            expect(await createMerkleRoot([])).toBe('');
        });

        test('single leaf returns its own hash', async () => {
            const leaf = 'test';
            const root = await createMerkleRoot([leaf]);
            const hash = await computeHash(leaf);
            expect(root).toBe(hash);
        });

        test('odd number of leaves handles duplication correctly', async () => {
            const l1 = ['a', 'b', 'c'];
            // Merkle tree for [a,b,c] should be H(H(a,b) + H(c,c))
            const r1 = await createMerkleRoot(l1);
            expect(r1).toHaveLength(64);
            
            const hA = await computeHash('a');
            const hB = await computeHash('b');
            const hC = await computeHash('c');
            const hAB = await computeHash(hA + hB);
            const hCC = await computeHash(hC + hC);
            const expectedRoot = await computeHash(hAB + hCC);
            
            expect(r1).toBe(expectedRoot);
        });
    });
});
