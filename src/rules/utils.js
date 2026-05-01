/**
 * Hashing and Random Number Generation
 */

export function seededRNG(seed) {
    let state = seed | 0;
    return function(max = 4294967296) {
        state = state + 0x6D2B79F5 | 0;
        var t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        const res = (t ^ t >>> 14) >>> 0;
        return max === 4294967296 ? res : res % max;
    }
}

export function hashStr(val) {
    let bytes;

    if (val instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(val))) {
        // @ts-ignore
        bytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    } else if (Array.isArray(val)) {
        bytes = Uint8Array.from(val);
    } else {
        const str = String(val);
        // Manual UTF-8 encoding to ensure consistency without TextEncoder dependency
        const arr = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code < 0x80) arr.push(code);
            else if (code < 0x800) arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            else if (code < 0xd800 || code >= 0xe000) {
                arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            } else {
                i++;
                code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                arr.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
        }
        bytes = arr;
    }

    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
        hash = ((hash << 5) - hash) + bytes[i];
        hash |= 0;
    }
    return hash >>> 0;
}
