import { signMessage, verifyMessage, computeHash, importKey, setNode } from '../security/crypto.js';

describe('Crypto Node.js Implementation', () => {
    beforeAll(() => {
        setNode(true);
    });
    const testPubKeyB64 = 'iH5D8Yh+QfGIfkPxiH5D8Yh+QfGIfkPxiH5D8Yh+QfE='; // 32 bytes

    test('computeHash in Node.js returns valid sha256', async () => {
        const hash = await computeHash('hello');
        expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    test('importKey in Node.js returns Buffer', async () => {
        const key = await importKey(testPubKeyB64, 'public');
        expect(Buffer.isBuffer(key)).toBe(true);
        expect(key.toString('base64')).toBe(testPubKeyB64);
    });

    test('signMessage and verifyMessage in Node.js', async () => {
        // We need a valid Ed25519 seed (32 bytes)
        const seed = Buffer.alloc(32, 1);
        const seedB64 = seed.toString('base64');
        
        const message = 'secret message';
        const signature = await signMessage(message, seedB64);
        expect(typeof signature).toBe('string');
        expect(signature.length).toBeGreaterThan(0);

        // To verify, we need the corresponding public key.
        // Instead of deriving it here, let's use a known pair if possible, 
        // or just test that the Arbiter's sign/verify path works with its own keys.
        const { createPublicKey, createPrivateKey } = await import('crypto');
        const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
        const keyObj = createPrivateKey({ key: Buffer.concat([pkcs8Header, seed]), format: 'der', type: 'pkcs8' });
        const pubKeyObj = createPublicKey(keyObj);
        const pubKeyRaw = pubKeyObj.export({ format: 'der', type: 'spki' }).subarray(12);
        const pubKeyB64 = pubKeyRaw.toString('base64');

        const isValid = await verifyMessage(message, signature, pubKeyB64);
        expect(isValid).toBe(true);

        const isInvalid = await verifyMessage('wrong message', signature, pubKeyB64);
        expect(isInvalid).toBe(false);
    });
});
