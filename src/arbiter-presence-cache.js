export const PRESENCE_CACHE_TTL = 120000;
export const PEER_SNAPSHOT_TTL = 45000;
export const MAX_PRESENCE_CACHE = 500;
export const MAX_PEER_SNAPSHOT = 50;
export const MAX_NAME_LENGTH = 32;
export const MAX_SHARD_LENGTH = 80;
export const MAX_LOCATION_LENGTH = 64;

const isFiniteInteger = (value) => Number.isInteger(value) && Number.isFinite(value);

const isHexPh = (value) => typeof value === 'string' && /^[0-9a-f]{8}$/i.test(value);

const clampString = (value, maxLength) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
};

export const sanitizePresenceEntry = (entry, now = Date.now()) => {
    if (!entry || typeof entry !== 'object') return null;

    const ph = clampString(entry.ph, 8).toLowerCase();
    const location = clampString(entry.location, MAX_LOCATION_LENGTH);
    const shard = clampString(entry.shard, MAX_SHARD_LENGTH);
    const name = clampString(entry.name, MAX_NAME_LENGTH);
    const level = Number(entry.level);
    const ts = Number(entry.ts);
    const x = Number(entry.x ?? 5);
    const y = Number(entry.y ?? 5);

    if (!isHexPh(ph)) return null;
    if (!location || !shard || !name) return null;
    if (!Number.isFinite(level) || level < 1 || level > 999) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const safeTs = Number.isFinite(ts) && ts > 0
        ? Math.min(ts, now)
        : now;

    return {
        ph,
        name,
        location,
        shard,
        level: Math.floor(level),
        ts: safeTs,
        x,
        y
    };
};

export const addToPresenceCache = (presenceCache, key, entry, now = Date.now()) => {
    if (!(presenceCache instanceof Map) || !key) return;

    if (presenceCache.size >= MAX_PRESENCE_CACHE && !presenceCache.has(key)) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [candidateKey, candidate] of presenceCache.entries()) {
            if ((candidate?.ts || 0) < oldestTs) {
                oldestTs = candidate?.ts || 0;
                oldestKey = candidateKey;
            }
        }
        if (oldestKey) presenceCache.delete(oldestKey);
    }

    presenceCache.set(key, { ...entry, ts: now });
};

export const prunePresenceCache = (presenceCache, now = Date.now(), ttl = PRESENCE_CACHE_TTL) => {
    if (!(presenceCache instanceof Map)) return;
    const cutoff = now - ttl;
    for (const [id, entry] of presenceCache.entries()) {
        if (!entry || !isFiniteInteger(Math.floor(entry.ts || 0)) || entry.ts < cutoff) {
            presenceCache.delete(id);
        }
    }
};

export const listPeersForShard = (presenceCache, shard, now = Date.now()) => {
    if (!(presenceCache instanceof Map) || !shard) return [];

    const cutoff = now - PEER_SNAPSHOT_TTL;
    return Array.from(presenceCache.values())
        .filter(entry => entry?.shard === shard && Number(entry.ts) >= cutoff)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_PEER_SNAPSHOT)
        .map(({ name, location, level, ph, ts, x, y }) => ({ name, location, level, ph, ts, x, y }));
};
