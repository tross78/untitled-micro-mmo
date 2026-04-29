// HyParView logical overlay — eager/lazy peer view management.
// Based on Leitão, Pereira, Rodrigues 2007. Used in libp2p, Ethereum devp2p.
//
// Trystero owns the WebRTC mesh; this is a routing policy overlay only.
// Eager peers receive full presence/sketch payloads immediately.
// Lazy peers receive only a lightweight announcement (msgId + type).
// On cache miss a lazy peer pulls the full payload, promoting itself to eager.

const ACTIVE_VIEW_SIZE = 3;
const SEEN_MSG_CAPACITY = 256;

export class HyParView {
    constructor() {
        this._active = new Set();  // eager peers — get full payloads
        this._passive = new Set(); // lazy peers — get announcement IDs only
        this._seen = [];           // LRU ring of seen msgIds (capacity = SEEN_MSG_CAPACITY)
        this._seenSet = new Set();
    }

    // Called when a new peer connects.
    onJoin(peerId) {
        if (this._active.size < ACTIVE_VIEW_SIZE) {
            this._active.add(peerId);
        } else {
            this._passive.add(peerId);
        }
    }

    // Called when a peer disconnects.
    onLeave(peerId) {
        this._active.delete(peerId);
        this._passive.delete(peerId);
        // Promote oldest passive peer to fill the active slot
        if (this._active.size < ACTIVE_VIEW_SIZE && this._passive.size > 0) {
            const promote = this._passive.values().next().value;
            this._passive.delete(promote);
            this._active.add(promote);
        }
    }

    // Promote a lazy peer to eager (called when we pulled payload from them).
    promote(peerId) {
        if (this._passive.has(peerId) && !this._active.has(peerId)) {
            // Demote the least-recently-joined active peer if full
            if (this._active.size >= ACTIVE_VIEW_SIZE) {
                const demote = this._active.values().next().value;
                this._active.delete(demote);
                this._passive.add(demote);
            }
            this._passive.delete(peerId);
            this._active.add(peerId);
        }
    }

    eagerPeers() { return Array.from(this._active); }
    lazyPeers() { return Array.from(this._passive); }
    allPeers() { return [...this._active, ...this._passive]; }
    isEmpty() { return this._active.size === 0 && this._passive.size === 0; }

    // Mark a message as seen. Returns true if this is a new message (not yet seen).
    markSeen(msgId) {
        if (this._seenSet.has(msgId)) return false;
        if (this._seen.length >= SEEN_MSG_CAPACITY) {
            const evicted = this._seen.shift();
            this._seenSet.delete(evicted);
        }
        this._seen.push(msgId);
        this._seenSet.add(msgId);
        return true;
    }

    hasSeen(msgId) { return this._seenSet.has(msgId); }

    // Compute a short announcement ID for a payload (used for lazy push).
    // Uses the same hashStr available in rules.js — caller passes the hash fn.
    static msgId(hashFn, payload) {
        const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return (hashFn(str) >>> 0).toString(16).padStart(8, '0');
    }
}
