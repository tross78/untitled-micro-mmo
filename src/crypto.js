/**
 * Hearthwick Cryptography Module
 * Universal implementation for Browser (WebCrypto) and Node (crypto)
 */

const isNode = typeof window === 'undefined';
let nodeCrypto;
if (isNode) {
    import('crypto').then(m => nodeCrypto = m);
}

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
    } else {
        // Node implementation if needed for Arbiter key generation
        return null; 
    }
}

/**
 * Exports a key to Base64 format.
 */
export async function exportKey(key) {
    if (!isNode) {
        const exported = await window.crypto.subtle.exportKey(
            key.type === 'private' ? 'pkcs8' : 'spki',
            key
        );
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    }
    return null;
}

/**
 * Imports a key from Base64 format.
 */
export async function importKey(base64, type) {
    if (!isNode) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        return await window.crypto.subtle.importKey(
            type === 'private' ? 'pkcs8' : 'spki',
            bytes,
            { name: 'Ed25519' },
            true,
            type === 'private' ? ['sign'] : ['verify']
        );
    } else {
        // Node implementation for Arbiter (Public Key is raw bytes or Base64)
        return Buffer.from(base64, 'base64');
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
        // Node implementation using 'crypto'
        const { sign } = await import('crypto');
        const signature = sign(null, data, privateKey);
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
        const signature = new Uint8Array(atob(signatureBase64).split('').map(c => c.charCodeAt(0)));
        return await window.crypto.subtle.verify(
            { name: 'Ed25519' },
            publicKey,
            signature,
            data
        );
    } else {
        const { verify } = await import('crypto');
        const signature = Buffer.from(signatureBase64, 'base64');
        return verify(null, data, publicKey, signature);
    }
}
