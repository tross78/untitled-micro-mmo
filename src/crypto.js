/**
 * Hearthwick Cryptography Module
 * Universal implementation for Browser (WebCrypto) and Node (crypto)
 */

const isNode = typeof window === 'undefined';

/**
 * Generates a new Ed25519 keypair.
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
 * Exports a key to Base64 format.
 * Browser uses 'raw' for public keys for maximum compatibility.
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
 * Imports a key from Base64 format.
 * Supports 'raw' for public keys and 'pkcs8' for private keys.
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
        // Node implementation (Arbiter)
        const { createPublicKey, createPrivateKey } = await import('crypto');
        const buffer = Buffer.from(base64, 'base64');
        
        if (type === 'public') {
            // Node expects Ed25519 raw public keys as-is
            return buffer;
        } else {
            // Node expects private keys in a specific format or raw
            return buffer;
        }
    }
}

/**
 * Signs a message.
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
 * Verifies a message signature.
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
 * Creates a Merkle Root from a list of strings (leaf nodes).
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
