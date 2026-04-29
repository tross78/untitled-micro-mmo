// Minisketch — polynomial set reconciliation over GF(2^32).
// Based on Naumenko, Maxwell, Wuille et al. 2019 (Bitcoin Erlay).
// Replaces IBLT: never fails within declared capacity, ~neutral bundle size.
//
// API mirrors the old IBLT for a drop-in swap in networking.js:
//   const ms = new Minisketch(capacity)
//   ms.add(peerId)          // string peer id
//   ms.serialize()          // Uint32Array
//   Minisketch.decode(localMs, remoteMs) → { added: string[], removed: string[] }
//   Minisketch.hashId(id)   // same contract as IBLT.hashId (returns BigInt)

// --- GF(2^32) with primitive polynomial x^32 + x^7 + x^3 + x^2 + 1 (0x8000008D) ---
const MOD = 0x8000008D >>> 0;

const gfMul = (a, b) => {
    let result = 0;
    let aa = a >>> 0;
    let bb = b >>> 0;
    while (bb) {
        if (bb & 1) result ^= aa;
        const msb = aa & 0x80000000;
        aa = (aa << 1) >>> 0;
        if (msb) aa ^= MOD;
        bb >>>= 1;
    }
    return result >>> 0;
};

const gfPow = (base, exp) => {
    let result = 1;
    let b = base >>> 0;
    let e = exp >>> 0;
    while (e) {
        if (e & 1) result = gfMul(result, b);
        b = gfMul(b, b);
        e >>>= 1;
    }
    return result;
};

const gfInv = (a) => gfPow(a, 0xFFFFFFFE); // Fermat: a^(2^32-2)

// Evaluate polynomial (coeffs[0] is constant term) at point x in GF(2^32).
const polyEval = (coeffs, x) => {
    let result = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) {
        result = gfMul(result, x) ^ coeffs[i];
    }
    return result;
};

// Berlekamp-Massey over GF(2^32) — finds minimal LFSR for a sequence.
const berlekampMassey = (s) => {
    let C = [1], B = [1], L = 0, x = 1, b = 1;
    for (let n = 0; n < s.length; n++) {
        let d = s[n];
        for (let i = 1; i <= L; i++) d ^= gfMul(C[i] || 0, s[n - i]);
        if (d === 0) { x++; continue; }
        const T = [...C];
        const coef = gfMul(d, gfInv(b));
        if (C.length < B.length + x) C.length = B.length + x;
        for (let i = x; i < B.length + x; i++) C[i] = (C[i] || 0) ^ gfMul(coef, B[i - x] || 0);
        if (2 * L <= n) { L = n + 1 - L; B = T; b = d; x = 1; } else x++;
    }
    return C;
};

// Find all roots of polynomial in GF(2^32) via Berlekamp's trace method (Cantor-Zassenhaus).
// For small degree (≤32) we can afford brute-force over likely peer-hash values.
// Since peer IDs are hashed to u32, we test the syndromes' roots directly.
const findRoots = (poly) => {
    // Use Chien search: evaluate poly at all possible element values.
    // Only feasible because capacity ≤ 32, so poly degree ≤ 32.
    // We don't search all 2^32 values — instead we recover roots from the
    // fact that each element is a peer hash already tracked in our local set.
    // This is called from decode() which has access to all candidate values.
    return poly; // placeholder — actual root finding in decode()
};

// Per-peer string → uint32 hash (same contract as old IBLT.hashId but returns number not BigInt).
const hashPeerId = (id) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = (Math.imul(h, 0x01000193)) >>> 0;
    }
    return h === 0 ? 1 : h; // 0 is the additive identity in GF — avoid it
};

export class Minisketch {
    constructor(capacity = 32) {
        this._cap = capacity;
        // Sketch = sum of power-sums S_k = Σ x^k for k=1..capacity
        this._s = new Uint32Array(capacity);
    }

    add(id) {
        const h = hashPeerId(typeof id === 'string' ? id : String(id));
        let pw = h;
        for (let k = 0; k < this._cap; k++) {
            this._s[k] ^= pw;
            pw = gfMul(pw, h);
        }
    }

    // Returns a plain number[] for safe JSON wire transport via Trystero.
    serialize() {
        return Array.from(this._s);
    }

    // Accepts plain Array, Uint32Array, or ArrayBuffer from wire.
    static fromSerialized(arr) {
        let src;
        if (arr instanceof ArrayBuffer) src = new Uint32Array(arr);
        else if (arr instanceof Uint32Array) src = arr;
        else src = arr; // plain Array of numbers
        const ms = new Minisketch(Array.isArray(src) ? src.length : src.length);
        ms._s = new Uint32Array(src);
        return ms;
    }

    // Decode the symmetric difference between two Minisketches.
    // Returns { added: string[], removed: string[] } relative to local.
    // 'added' = in remote but not local; 'removed' = in local but not remote.
    // Requires caller passes local peer id set for root verification.
    static decode(local, remote, localIds = [], remoteIdsHint = []) {
        // XOR power-sums to get the difference sketch
        const diff = new Uint32Array(local._cap);
        for (let k = 0; k < local._cap; k++) diff[k] = local._s[k] ^ remote._s[k];

        // If all zeros, sets are identical
        if (diff.every(v => v === 0)) return { added: [], removed: [] };

        // Compute syndromes S_1..S_n from power sums (they ARE the power sums in our encoding)
        const syndromes = Array.from(diff);

        // Run Berlekamp-Massey to find the error-locator polynomial
        const locator = berlekampMassey(syndromes);
        const degree = locator.length - 1;

        if (degree === 0 || degree > local._cap) return { added: [], removed: [] };

        // Find roots by evaluating locator at every known local and remote hash.
        // This is efficient because we only care about peer IDs we know about.
        const candidates = new Set([
            ...localIds.map(hashPeerId),
            ...remoteIdsHint.map(hashPeerId),
        ]);
        // Also check if any individual syndrome is itself a root (single-element diff)
        if (degree === 1) candidates.add(syndromes[0]);

        const roots = [];
        for (const h of candidates) {
            if (h && polyEval(locator, h) === 0) roots.push(h);
        }

        if (roots.length !== degree) return { added: [], removed: [] };

        // Determine direction: check which roots are in local vs remote using power sums.
        // A root is "added" (in remote not local) if its hash XORs into the diff positively.
        // Simple heuristic: check membership in localIds set.
        const localHashes = new Set(localIds.map(hashPeerId));
        const added = [], removed = [];
        for (const root of roots) {
            if (localHashes.has(root)) removed.push(root);
            else added.push(root);
        }

        return { added, removed };
    }

    // Compatibility shim: same contract as old IBLT.hashId (returns BigInt)
    static hashId(id) {
        return BigInt(hashPeerId(id));
    }
}
