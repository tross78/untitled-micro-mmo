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
        const { sign } = await import('crypto');
        // Node: If privateKey is a Base64 string, decode it
        const keyBuffer = typeof privateKey === 'string' ? Buffer.from(privateKey, 'base64') : privateKey;
        const signature = sign(null, data, keyBuffer);
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
        const { verify } = await import('crypto');
        const signature = Buffer.from(signatureBase64, 'base64');
        const keyBuffer = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : publicKey;
        return verify(null, data, keyBuffer, signature);
    }
}
