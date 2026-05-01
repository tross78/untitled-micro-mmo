// Compact peer-set reconciliation sketch.
//
// The public API intentionally matches the earlier Minisketch drop-in:
//   const ms = new Minisketch(capacity)
//   ms.add(peerId)
//   ms.serialize()
//   Minisketch.decode(localMs, remoteMs) -> { added, removed }
//   Minisketch.hashId(peerId) -> BigInt
//
// Internally this uses a small invertible sketch. The previous polynomial
// decoder could not recover remote-only peer hashes without candidate IDs,
// which made shard roster reconciliation silently fail.

const CELLS_PER_ITEM = 5;

const hashU32 = (str, seed = 0x811c9dc5) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h === 0 ? 1 : h;
};

const hashPeerId = (id) => hashU32(typeof id === 'string' ? id : String(id));
const checkHash = (key) => hashU32(String(key), 0x9e3779b9);

const indexesFor = (key, cellCount) => {
    const a = hashU32(String(key), 0x85ebca6b);
    const b = hashU32(String(key), 0xc2b2ae35);
    const c = hashU32(String(key), 0x27d4eb2f);
    const d = hashU32(String(key), 0x38b06037);
    const e = hashU32(String(key), 0x4f420323);
    return [a % cellCount, b % cellCount, c % cellCount, d % cellCount, e % cellCount];
};

const makeCells = (count) => Array.from({ length: count }, () => ({ count: 0, keyXor: 0, hashXor: 0 }));

const cloneCells = (cells) => cells.map(c => ({ count: c.count, keyXor: c.keyXor >>> 0, hashXor: c.hashXor >>> 0 }));

export class Minisketch {
    constructor(capacity = 32) {
        this._cap = capacity;
        this._cellCount = Math.max(8, capacity * CELLS_PER_ITEM);
        this._cells = makeCells(this._cellCount);
    }

    add(id) {
        const key = hashPeerId(id);
        const checksum = checkHash(key);
        for (const idx of indexesFor(key, this._cellCount)) {
            const cell = this._cells[idx];
            cell.count += 1;
            cell.keyXor = (cell.keyXor ^ key) >>> 0;
            cell.hashXor = (cell.hashXor ^ checksum) >>> 0;
        }
    }

    serialize() {
        const out = [this._cap, this._cellCount];
        for (const cell of this._cells) out.push(cell.count, cell.keyXor >>> 0, cell.hashXor >>> 0);
        return out;
    }

    static fromSerialized(arr) {
        const src = arr instanceof ArrayBuffer ? Array.from(new Int32Array(arr)) : Array.from(arr || []);
        // Security: cap capacity and cellCount to prevent memory DoS
        const cap = Math.min(256, src[0] || 32);
        const cellCount = Math.min(1024, src[1] || Math.max(8, cap * CELLS_PER_ITEM));
        const ms = new Minisketch(cap);
        ms._cellCount = cellCount;
        ms._cells = makeCells(cellCount);
        let offset = 2;
        for (let i = 0; i < cellCount; i++) {
            if (offset + 2 >= src.length) break;
            ms._cells[i] = {
                count: src[offset++] || 0,
                keyXor: (src[offset++] || 0) >>> 0,
                hashXor: (src[offset++] || 0) >>> 0,
            };
        }
        return ms;
    }

    static decode(local, remote) {
        const cellCount = Math.min(local._cellCount, remote._cellCount);
        const cells = makeCells(cellCount);
        for (let i = 0; i < cellCount; i++) {
            const a = local._cells[i] || { count: 0, keyXor: 0, hashXor: 0 };
            const b = remote._cells[i] || { count: 0, keyXor: 0, hashXor: 0 };
            cells[i] = {
                count: a.count - b.count,
                keyXor: (a.keyXor ^ b.keyXor) >>> 0,
                hashXor: (a.hashXor ^ b.hashXor) >>> 0,
            };
        }

        const work = cloneCells(cells);
        const added = [];
        const removed = [];
        const queue = [];
        const enqueuePure = (i) => {
            const c = work[i];
            if (Math.abs(c.count) === 1 && c.keyXor !== 0 && c.hashXor === checkHash(c.keyXor)) queue.push(i);
        };
        for (let i = 0; i < work.length; i++) enqueuePure(i);

        while (queue.length) {
            const idx = queue.shift();
            const cell = work[idx];
            if (!(Math.abs(cell.count) === 1 && cell.keyXor !== 0 && cell.hashXor === checkHash(cell.keyXor))) continue;

            const key = cell.keyXor >>> 0;
            const sign = cell.count;
            if (sign > 0) removed.push(key);
            else added.push(key);

            for (const j of indexesFor(key, cellCount)) {
                const c = work[j];
                if (!c) continue;
                c.count -= sign;
                c.keyXor = (c.keyXor ^ key) >>> 0;
                c.hashXor = (c.hashXor ^ checkHash(key)) >>> 0;
                enqueuePure(j);
            }
        }

        const success = work.every(c => c.count === 0 && c.keyXor === 0 && c.hashXor === 0);
        return success ? { added, removed, failure: false } : { added: [], removed: [], failure: true };
    }

    static hashId(id) {
        return BigInt(hashPeerId(id));
    }
}
