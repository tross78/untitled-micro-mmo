import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(16).toString('base64');
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).slice(12).toString('base64');

console.log('--- NEW HEARTHWICK KEYS ---');
console.log('MASTER_PUBLIC_KEY (put in src/constants.js):');
console.log(pubB64);
console.log('\nMASTER_SECRET_KEY (put in arbiter/.env):');
console.log(privB64);
console.log('----------------------------');
