#!/usr/bin/env node
// Generates an Ed25519 master key pair for the Hearthwick arbiter using node:crypto (no deps).
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const pubB64  = publicKey.export({ type: 'spki',  format: 'der' }).slice(12).toString('base64');
const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(16).toString('base64');

console.log('--- MASTER KEY GENERATED ---');
console.log('Public Key  (for src/constants.js MASTER_PUBLIC_KEY):', pubB64);
console.log('Private Key (for arbiter/.env MASTER_SECRET_KEY):     ', privB64);
console.log('----------------------------');
