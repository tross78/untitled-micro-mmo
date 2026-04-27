import { jest } from '@jest/globals';

const mockSubtle = {
    generateKey: jest.fn(),
    exportKey: jest.fn(),
    importKey: jest.fn(),
    sign: jest.fn(),
    verify: jest.fn(),
    digest: jest.fn(),
};

import { generateKeyPair, exportKey, importKey, signMessage, verifyMessage, computeHash, setNode, isNode } from './crypto.js';

describe('Crypto Browser Path Mocked Tests', () => {
    let originalCrypto;

    beforeAll(() => {
        setNode(false);
        originalCrypto = window.crypto;
        // Use a simpler assignment for the mock
        Object.defineProperty(window, 'crypto', {
            value: { subtle: mockSubtle },
            configurable: true
        });
        
        global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
        global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
    });

    afterAll(() => {
        setNode(true);
        Object.defineProperty(window, 'crypto', {
            value: originalCrypto,
            configurable: true
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('browser path check', () => {
        // In this test environment, window is defined, so isNode should be false.
        expect(isNode).toBe(false);
    });

    test('generateKeyPair calls subtle.generateKey', async () => {
        mockSubtle.generateKey.mockResolvedValue('keypair');
        const kp = await generateKeyPair();
        expect(kp).toBe('keypair');
        expect(mockSubtle.generateKey).toHaveBeenCalled();
    });

    test('exportKey calls subtle.exportKey', async () => {
        const mockKey = { type: 'public' };
        mockSubtle.exportKey.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        const b64 = await exportKey(mockKey);
        expect(mockSubtle.exportKey).toHaveBeenCalled();
        expect(b64).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    });

    test('importKey calls subtle.importKey', async () => {
        mockSubtle.importKey.mockResolvedValue('cryptokey');
        const key = await importKey('AAAA', 'public');
        expect(key).toBe('cryptokey');
        expect(mockSubtle.importKey).toHaveBeenCalled();
    });

    test('signMessage calls subtle.sign', async () => {
        const mockKey = { type: 'private' };
        mockSubtle.sign.mockResolvedValue(new Uint8Array([4, 5, 6]).buffer);
        const sig = await signMessage('msg', mockKey);
        expect(sig).toBe(Buffer.from([4, 5, 6]).toString('base64'));
        expect(mockSubtle.sign).toHaveBeenCalled();
    });

    test('verifyMessage calls subtle.verify', async () => {
        const mockKey = { type: 'public' };
        mockSubtle.verify.mockResolvedValue(true);
        const isValid = await verifyMessage('msg', Buffer.from([4, 5, 6]).toString('base64'), mockKey);
        expect(isValid).toBe(true);
        expect(mockSubtle.verify).toHaveBeenCalled();
    });

    test('verifyMessage handles errors', async () => {
        const mockKey = { type: 'public' };
        mockSubtle.verify.mockRejectedValue(new Error('fail'));
        const isValid = await verifyMessage('msg', 'sig', mockKey);
        expect(isValid).toBe(false);
    });

    test('computeHash calls subtle.digest', async () => {
        mockSubtle.digest.mockResolvedValue(new Uint8Array([0xaa, 0xbb]).buffer);
        const hash = await computeHash('msg');
        expect(hash).toBe('aabb');
        expect(mockSubtle.digest).toHaveBeenCalled();
    });
});
