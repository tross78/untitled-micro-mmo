import { ENEMIES } from '../content/data.js';
import { cmpHLC, recvHLC } from './hlc.js';
import { selfId } from './transport.js';
import { localPlayer, players } from '../state/store.js';

const MAX_XP_PER_MS = Math.max(...Object.values(ENEMIES).map(e => e.xp || 0), 1) / 5000;
const XP_BUCKET_CAPACITY = MAX_XP_PER_MS * 60000;

const xpBuckets = new Map();   // peerId → { tokens, lastRefill }
const peerHlc = new Map();     // peerId → last accepted HLC

export const checkXpRate = (peerId, newXp, oldXp) => {
    const gain = newXp - oldXp;
    if (gain <= 0) return true;
    const now = Date.now();
    let bucket = xpBuckets.get(peerId);
    if (!bucket) {
        bucket = { tokens: XP_BUCKET_CAPACITY, lastRefill: now };
        xpBuckets.set(peerId, bucket);
    }
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(XP_BUCKET_CAPACITY, bucket.tokens + MAX_XP_PER_MS * elapsed);
    bucket.lastRefill = now;
    bucket.tokens -= gain;
    return bucket.tokens >= 0;
};

export const checkAndUpdateHlc = (peerId, incoming) => {
    const last = peerHlc.get(peerId);
    if (last && cmpHLC(incoming, last) <= 0) return false;
    recvHLC(incoming);
    peerHlc.set(peerId, incoming);
    return true;
};

export const buildLeafData = () => {
    const leaves = Array.from(players.entries())
        .filter(([id, p]) => id !== selfId && !p.ghost)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
    leaves.sort();
    return leaves;
};

export const clearSecurityState = () => {
    xpBuckets.clear();
    peerHlc.clear();
};

export const evictSecurityPeer = (peerId) => {
    xpBuckets.delete(peerId);
    peerHlc.delete(peerId);
};
