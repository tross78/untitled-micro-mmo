import nacl from 'tweetnacl';
import pkg from 'tweetnacl-util';
const { encodeBase64 } = pkg;

const keyPair = nacl.sign.keyPair();

console.log('--- MASTER KEY GENERATED ---');
console.log('Public Key (Base64):', encodeBase64(keyPair.publicKey));
console.log('Secret Key (Base64):', encodeBase64(keyPair.secretKey));
console.log('\n--- HOW TO USE ---');
console.log('1. Save the Public Key in src/constants.js');
console.log('2. Save the Secret Key in the .env file on your Raspberry Pi.');
console.log('----------------------------');
