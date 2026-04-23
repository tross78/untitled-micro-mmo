/**
 * Hearthwick Cryptography Module
 * Universal implementation for Browser (WebCrypto) and Node (crypto)
 */

const isNode = typeof window === 'undefined';

/**
 * Generates a new Ed25519 keypair.
 * @returns {Promise<CryptoKeyPair>} Browser only. Returns null in Node.
 */
export async function generateKeyPair() {
    if (!isNode) {
        return await window.crypto.subtle.generateKey(
            { name: 'Ed25519' },
            true,
            ['sign', 'verify']
        );
    }
    return null;
}

/**
 * Exports a CryptoKey to a Base64 string.
 * Public keys use 'raw' format (32 bytes). Private keys use 'pkcs8'.
 * @param {CryptoKey} key
 * @returns {Promise<string>} Base64-encoded key. Returns null in Node.
 */
export async function exportKey(key) {
    if (!isNode) {
        const format = key.type === 'private' ? 'pkcs8' : 'raw';
        const exported = await window.crypto.subtle.exportKey(format, key);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    }
    return null;
}

/**
 * Imports an Ed25519 key from a Base64 string.
 * @param {string} base64 - Raw 32-byte public key OR PKCS8 private key, Base64-encoded.
 * @param {'public'|'private'} type
 * @returns {Promise<CryptoKey|Buffer>} CryptoKey in browser; raw Buffer in Node.
 *
 * IMPORTANT: In browser code, always call importKey before passing to verifyMessage.
 * Never pass a `ph` hash string (8-char hex) — it is NOT a key and will throw.
 */
export async function importKey(base64, type) {
    if (!isNode) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        return await window.crypto.subtle.importKey(
            type === 'private' ? 'pkcs8' : 'raw',
            bytes,
            { name: 'Ed25519' },
            true,
            type === 'private' ? ['sign'] : ['verify']
        );
    } else {
        // Node implementation (Arbiter) — returns raw Buffer; signMessage/verifyMessage
        // accept Buffer and wrap it in DER themselves, so no KeyObject needed here.
        return Buffer.from(base64, 'base64');
    }
}

/**
 * Signs a message with an Ed25519 private key.
 * @param {string} message - The plaintext message to sign.
 * @param {CryptoKey|Buffer|string} privateKey
 *   Browser: must be a CryptoKey from importKey(b64, 'private') or generateKeyPair().
 *   Node: accepts a raw Base64 seed string OR Buffer (32 or 64 bytes).
 * @returns {Promise<string>} Base64-encoded 64-byte signature.
 */
export async function signMessage(message, privateKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    if (!isNode) {
        const signature = await window.crypto.subtle.sign(
            { name: 'Ed25519' },
            privateKey,
            data
        );
        return btoa(String.fromCharCode(...new Uint8Array(signature)));
    } else {
        const { sign, createPrivateKey } = await import('crypto');
        const raw = typeof privateKey === 'string' ? Buffer.from(privateKey, 'base64') : privateKey;
        // OpenSSL 3 (Node 18+) requires a KeyObject, not a raw Buffer.
        // Wrap the 32-byte Ed25519 seed in a PKCS8 DER envelope.
        // If stored as seed||pubkey (64 bytes, tweetnacl convention), use only the first 32.
        const seed = raw.length === 64 ? raw.subarray(0, 32) : raw;
        const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
        const keyObj = createPrivateKey({ key: Buffer.concat([pkcs8Header, seed]), format: 'der', type: 'pkcs8' });
        const signature = sign(null, data, keyObj);
        return signature.toString('base64');
    }
}

/**
 * Verifies an Ed25519 signature.
 * @param {string} message - The original plaintext message.
 * @param {string} signatureBase64 - Base64-encoded 64-byte signature.
 * @param {CryptoKey|Buffer|string} publicKey
 *   Browser: MUST be a CryptoKey from importKey(b64, 'public'). Passing any other type
 *   (a raw Base64 string, a `ph` hash, a peer ID) will throw or return false.
 *   Node: accepts a raw Base64 string or Buffer (32-byte public key).
 * @returns {Promise<boolean>}
 *
 * WRONG:  verifyMessage(msg, sig, playerEntry.ph)        // ph is a hash, not a key
 * WRONG:  verifyMessage(msg, sig, pubKeyBase64)           // string in browser path
 * CORRECT: verifyMessage(msg, sig, await importKey(pubKeyBase64, 'public'))
 */
export async function verifyMessage(message, signatureBase64, publicKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    if (!isNode) {
        try {
            const signature = new Uint8Array(atob(signatureBase64).split('').map(c => c.charCodeAt(0)));
            return await window.crypto.subtle.verify(
                { name: 'Ed25519' },
                publicKey,
                signature,
                data
            );
        } catch (e) {
            console.error('Crypto verification error', e);
            return false;
        }
    } else {
        const { verify, createPublicKey } = await import('crypto');
        const signature = Buffer.from(signatureBase64, 'base64');
        const raw = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : publicKey;
        // OpenSSL 3 requires a KeyObject. Wrap raw 32-byte Ed25519 public key in SubjectPublicKeyInfo DER.
        const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        const keyObj = createPublicKey({ key: Buffer.concat([spkiHeader, raw]), format: 'der', type: 'spki' });
        return verify(null, data, keyObj, signature);
    }
}

/**
 * Computes a SHA-256 hash of a string.
 */
export async function computeHash(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    if (!isNode) {
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        const { createHash } = await import('crypto');
        return createHash('sha256').update(data).digest('hex');
    }
}

/**
 * Creates a Merkle Root from an array of pre-sorted leaf strings.
 * Lazy-imported in main.js — do not move to a top-level import (bundle size).
 * Only the elected Proposer calls this; non-proposers must never load it eagerly.
 * @param {string[]} leaves - Must be sorted before calling.
 * @returns {Promise<string>} 64-char hex SHA-256 root, or '' for empty input.
 */
export async function createMerkleRoot(leaves) {
    if (leaves.length === 0) return '';
    let hashes = await Promise.all(leaves.map(l => computeHash(l)));

    while (hashes.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = hashes[i + 1] || hashes[i]; // Duplicate last if odd
            nextLevel.push(await computeHash(left + right));
        }
        hashes = nextLevel;
    }
    return hashes[0];
}
