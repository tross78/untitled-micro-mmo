import { TextEncoder, TextDecoder } from 'util';
import { webcrypto } from 'crypto';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill global crypto
if (!global.crypto) {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true
  });
}

// Polyfill window.crypto for JSDOM
if (typeof window !== 'undefined') {
  if (!window.crypto) {
    Object.defineProperty(window, 'crypto', {
      value: webcrypto,
      writable: true,
      configurable: true
    });
  }
  // Ensure subtle is available on window.crypto
  if (!window.crypto.subtle && webcrypto.subtle) {
    window.crypto.subtle = webcrypto.subtle;
  }
}

// Mock BroadcastChannel if missing in JSDOM
if (typeof window !== 'undefined' && !window.BroadcastChannel) {
  window.BroadcastChannel = class {
    constructor(name) { this.name = name; }
    postMessage() {}
    onmessage() {}
    close() {}
  };
}
