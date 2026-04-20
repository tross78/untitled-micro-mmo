import nacl from 'tweetnacl';
import pkg from 'tweetnacl-util';
const { decodeBase64, encodeBase64 } = pkg;

/**
 * Signs a message with a private key.
 * @param {string} message 
 * @param {Uint8Array} secretKey 
 * @returns {string} Base64 encoded signature.
 */
export function signMessage(message, secretKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const signature = nacl.sign.detached(data, secretKey);
    return encodeBase64(signature);
}

/**
 * Verifies a message signature with a public key.
 * @param {string} message 
 * @param {string} signatureBase64 
 * @param {Uint8Array} publicKey 
 * @returns {boolean}
 */
export function verifyMessage(message, signatureBase64, publicKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const signature = decodeBase64(signatureBase64);
    return nacl.sign.detached.verify(data, signature, publicKey);
}

/**
 * Generates a new Ed25519 keypair.
 */
export function generateKeyPair() {
    return nacl.sign.keyPair();
}
