/**
 * Robust Invertible Bloom Lookup Table (IBLT)
 * Standard implementation for O(diff) set reconciliation.
 */

export class IBLT {
    constructor(size = 64, hashCount = 4) {
        this.size = size;
        this.hashCount = hashCount;
        // count, keySum, hashSum
        this.count = new Int32Array(size);
        this.keySum = new BigUint64Array(size);
        this.hashSum = new BigUint64Array(size);
    }

    _hash(key, seed) {
        let h = BigInt(seed) ^ BigInt(key);
        h = (h ^ (h >> 33n)) * 0xff51afd7ed558ccdn;
        h = (h ^ (h >> 33n)) * 0xc4ceb9fe1a85ec53n;
        h = h ^ (h >> 33n);
        return h;
    }

    _hashKey(id) {
        let h = 0n;
        for (let i = 0; i < id.length; i++) {
            h = (h * 31n + BigInt(id.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn;
        }
        return h;
    }

    insert(id) {
        const key = (typeof id === 'string' ? this._hashKey(id) : BigInt(id)) & 0xFFFFFFFFFFFFFFFFn;
        const hVerify = this._hash(key, 0) & 0xFFFFFFFFFFFFFFFFn;
        const indices = new Set();
        for (let i = 0; i < this.hashCount; i++) {
            indices.add(Number((this._hash(key, i + 1) & 0xFFFFFFFFFFFFFFFFn) % BigInt(this.size)));
        }
        for (const idx of indices) {
            this.count[idx]++;
            this.keySum[idx] = (this.keySum[idx] ^ key) & 0xFFFFFFFFFFFFFFFFn;
            this.hashSum[idx] = (this.hashSum[idx] ^ hVerify) & 0xFFFFFFFFFFFFFFFFn;
        }
    }

    static subtract(a, b) {
        const res = new IBLT(a.size, a.hashCount);
        for (let i = 0; i < a.size; i++) {
            res.count[i] = a.count[i] - b.count[i];
            res.keySum[i] = (a.keySum[i] ^ b.keySum[i]) & 0xFFFFFFFFFFFFFFFFn;
            res.hashSum[i] = (a.hashSum[i] ^ b.hashSum[i]) & 0xFFFFFFFFFFFFFFFFn;
        }
        return res;
    }

    decode() {
        const added = [];
        const removed = [];
        const pureIndices = [];

        const isPure = (i) => {
            if (this.count[i] === 0) return false;
            const key = this.keySum[i];
            const hVerify = this.hashSum[i];
            // In a pure cell, hashSum must match the hash of the keySum
            return hVerify === (this._hash(key, 0) & 0xFFFFFFFFFFFFFFFFn);
        };

        for (let i = 0; i < this.size; i++) {
            if (isPure(i)) pureIndices.push(i);
        }

        while (pureIndices.length > 0) {
            const i = pureIndices.pop();
            if (!isPure(i)) continue;

            const c = this.count[i];
            const sign = Math.sign(c);
            const key = this.keySum[i];
            const hVerify = this.hashSum[i];

            if (sign > 0) added.push(key);
            else removed.push(key);

            const indices = new Set();
            for (let j = 0; j < this.hashCount; j++) {
                indices.add(Number((this._hash(key, j + 1) & 0xFFFFFFFFFFFFFFFFn) % BigInt(this.size)));
            }
            for (const idx of indices) {
                this.count[idx] -= sign;
                this.keySum[idx] = (this.keySum[idx] ^ key) & 0xFFFFFFFFFFFFFFFFn;
                this.hashSum[idx] = (this.hashSum[idx] ^ hVerify) & 0xFFFFFFFFFFFFFFFFn;
                if (isPure(idx)) pureIndices.push(idx);
            }
        }

        const success = this.count.every(c => c === 0);
        return { added, removed, success };
    }

    serialize() {
        return {
            count: Array.from(this.count),
            keySum: Array.from(this.keySum).map(k => k.toString()),
            hashSum: Array.from(this.hashSum).map(h => h.toString())
        };
    }

    static fromSerialized(data, hashCount = 4) {
        const res = new IBLT(data.count.length, hashCount);
        res.count = new Int32Array(data.count);
        res.keySum = new BigUint64Array(data.keySum.map(k => BigInt(k)));
        res.hashSum = new BigUint64Array(data.hashSum.map(h => BigInt(h)));
        return res;
    }
}
