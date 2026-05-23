// Compact peer-set reconciliation sketch.
//
// The public API intentionally matches the earlier Minisketch drop-in:
//   const ms = new Minisketch(capacity)
//   ms.add(peerId)
//   ms.serialize()
//   Minisketch.decode(localMs, remoteMs) -> { added, removed }
//   Minisketch.hashId(peerId) -> BigInt
//
// Internally this uses a small invertible Bloom filter (XOR-based IBLT).
// Keys are 64-bit (two 32-bit halves stored as hi/lo) to eliminate the ~29%
// birthday collision probability at 50 peers that existed with 32-bit keys.
// (Goodrich & Mitzenmacher 2011; birthday bound: P(collision) ≈ n²/2^b)

const CELLS_PER_ITEM = 12;

const hashU32 = (str, seed = 0x811c9dc5) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h === 0 ? 1 : h;
};

// 64-bit peer ID hash as two independent 32-bit halves.
const hashPeerIdHi = (id) => hashU32(typeof id === 'string' ? id : String(id), 0x811c9dc5);
const hashPeerIdLo = (id) => hashU32(typeof id === 'string' ? id : String(id), 0x9e3779b9);

const checkHashHi = (hi, lo) => hashU32(`${hi >>> 0}:${lo >>> 0}`, 0x85ebca6b);
const checkHashLo = (hi, lo) => hashU32(`${hi >>> 0}:${lo >>> 0}`, 0xc2b2ae35);

const indexesFor = (hi, lo, cellCount) => {
    const raw = [
        hashU32(`${hi}a${lo}`, 0x85ebca6b),
        hashU32(`${hi}b${lo}`, 0xc2b2ae35),
        hashU32(`${hi}c${lo}`, 0x27d4eb2f),
        hashU32(`${hi}d${lo}`, 0x38b06037),
        hashU32(`${hi}e${lo}`, 0x4f420323),
    ];
    const out = [];
    const used = new Set();
    for (let i = 0; i < raw.length; i++) {
        let idx = raw[i] % cellCount;
        const stepSeed = (raw[(i + 1) % raw.length] ^ raw[(i + 2) % raw.length]) >>> 0;
        const step = 1 + (stepSeed % Math.max(1, cellCount - 1));
        while (used.has(idx)) idx = (idx + step) % cellCount;
        used.add(idx);
        out.push(idx);
    }
    return out;
};

const makeCells = (count) => Array.from({ length: count }, () => ({
    count: 0, keyHiXor: 0, keyLoXor: 0, hashHiXor: 0, hashLoXor: 0,
}));

const cloneCells = (cells) => cells.map(c => ({
    count: c.count,
    keyHiXor: c.keyHiXor >>> 0, keyLoXor: c.keyLoXor >>> 0,
    hashHiXor: c.hashHiXor >>> 0, hashLoXor: c.hashLoXor >>> 0,
}));

export class Minisketch {
    constructor(capacity = 32) {
        this._cap = capacity;
        this._cellCount = Math.max(8, capacity * CELLS_PER_ITEM);
        this._cells = makeCells(this._cellCount);
    }

    add(id) {
        const hi = hashPeerIdHi(id);
        const lo = hashPeerIdLo(id);
        const chkHi = checkHashHi(hi, lo);
        const chkLo = checkHashLo(hi, lo);
        for (const idx of indexesFor(hi, lo, this._cellCount)) {
            const cell = this._cells[idx];
            cell.count += 1;
            cell.keyHiXor = (cell.keyHiXor ^ hi) >>> 0;
            cell.keyLoXor = (cell.keyLoXor ^ lo) >>> 0;
            cell.hashHiXor = (cell.hashHiXor ^ chkHi) >>> 0;
            cell.hashLoXor = (cell.hashLoXor ^ chkLo) >>> 0;
        }
    }

    serialize() {
        const out = [this._cap, this._cellCount];
        for (const cell of this._cells) {
            out.push(cell.count, cell.keyHiXor >>> 0, cell.keyLoXor >>> 0,
                     cell.hashHiXor >>> 0, cell.hashLoXor >>> 0);
        }
        return out;
    }

    static fromSerialized(arr) {
        const src = arr instanceof ArrayBuffer ? Array.from(new Int32Array(arr)) : Array.from(arr || []);
        const cap = Math.min(256, src[0] || 32);
        const cellCount = Math.min(1024, src[1] || Math.max(8, cap * CELLS_PER_ITEM));
        const ms = new Minisketch(cap);
        ms._cellCount = cellCount;
        ms._cells = makeCells(cellCount);
        let offset = 2;
        for (let i = 0; i < cellCount; i++) {
            if (offset + 4 >= src.length) break;
            ms._cells[i] = {
                count:      src[offset++] || 0,
                keyHiXor:  (src[offset++] || 0) >>> 0,
                keyLoXor:  (src[offset++] || 0) >>> 0,
                hashHiXor: (src[offset++] || 0) >>> 0,
                hashLoXor: (src[offset++] || 0) >>> 0,
            };
        }
        return ms;
    }

    static decode(local, remote) {
        const cellCount = Math.min(local._cellCount, remote._cellCount);
        const cap = Math.min(local._cap || 0, remote._cap || 0) || 0;
        const cells = makeCells(cellCount);
        for (let i = 0; i < cellCount; i++) {
            const a = local._cells[i]  || { count: 0, keyHiXor: 0, keyLoXor: 0, hashHiXor: 0, hashLoXor: 0 };
            const b = remote._cells[i] || { count: 0, keyHiXor: 0, keyLoXor: 0, hashHiXor: 0, hashLoXor: 0 };
            cells[i] = {
                count:      a.count - b.count,
                keyHiXor:  (a.keyHiXor  ^ b.keyHiXor)  >>> 0,
                keyLoXor:  (a.keyLoXor  ^ b.keyLoXor)  >>> 0,
                hashHiXor: (a.hashHiXor ^ b.hashHiXor) >>> 0,
                hashLoXor: (a.hashLoXor ^ b.hashLoXor) >>> 0,
            };
        }

        const isPure = (c) => {
            if (Math.abs(c.count) !== 1 || (c.keyHiXor === 0 && c.keyLoXor === 0)) return false;
            return c.hashHiXor === checkHashHi(c.keyHiXor, c.keyLoXor)
                && c.hashLoXor === checkHashLo(c.keyHiXor, c.keyLoXor);
        };

        const work = cloneCells(cells);
        // Results are 64-bit keys encoded as BigInt for caller lookup via hashId().
        const added = [];
        const removed = [];
        let peeled = 0;
        const queue = [];
        for (let i = 0; i < work.length; i++) { if (isPure(work[i])) queue.push(i); }

        while (queue.length) {
            const idx = queue.shift();
            const cell = work[idx];
            if (!isPure(cell)) continue;

            const hi = cell.keyHiXor >>> 0;
            const lo = cell.keyLoXor >>> 0;
            const count = cell.count; // capture before peeling — cell may be its own neighbor
            const key = (BigInt(hi) << 32n) | BigInt(lo);
            if (count > 0) removed.push(key);
            else added.push(key);
            peeled += 1;

            for (const j of indexesFor(hi, lo, cellCount)) {
                const c = work[j];
                if (!c) continue;
                c.count -= count;
                c.keyHiXor  = (c.keyHiXor  ^ hi) >>> 0;
                c.keyLoXor  = (c.keyLoXor  ^ lo) >>> 0;
                c.hashHiXor = (c.hashHiXor ^ checkHashHi(hi, lo)) >>> 0;
                c.hashLoXor = (c.hashLoXor ^ checkHashLo(hi, lo)) >>> 0;
                if (isPure(c)) queue.push(j);
            }
        }

        const success = work.every(c =>
            c.count === 0 && c.keyHiXor === 0 && c.keyLoXor === 0
            && c.hashHiXor === 0 && c.hashLoXor === 0
        );
        if (!success || peeled > cap) return { added: [], removed: [], failure: true };
        return { added, removed, failure: false };
    }

    // Returns a 64-bit BigInt key for a peer ID — used by callers to match
    // against the added/removed arrays returned by decode().
    static hashId(id) {
        const hi = hashPeerIdHi(id);
        const lo = hashPeerIdLo(id);
        return (BigInt(hi) << 32n) | BigInt(lo);
    }
}
