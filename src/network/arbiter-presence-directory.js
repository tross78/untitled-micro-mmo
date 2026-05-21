import {
    addToPresenceCache,
    listPeersForShard,
    prunePresenceCache,
    sanitizePresenceEntry,
} from './arbiter-presence-cache.js';

export const createPresenceDirectory = () => {
    const presenceCache = new Map();
    // Secondary index keeps removeById O(1). With a 200-peer shard and 1 disconnect
    // per second, the previous O(N) scan was 100k iterations/sec on the Pi.
    const idToPh = new Map();

    const syncIndex = (entry) => {
        if (entry && entry.id) idToPh.set(entry.id, entry.ph);
    };

    return {
        register(rawEntry, now = Date.now()) {
            const entry = sanitizePresenceEntry(rawEntry, now);
            if (!entry) return null;
            // If the same ph is rebinding to a new trystero id, drop the stale index entry.
            const prior = presenceCache.get(entry.ph);
            if (prior?.id && prior.id !== entry.id) idToPh.delete(prior.id);
            addToPresenceCache(presenceCache, entry.ph, entry, entry.ts);
            syncIndex(entry);
            return entry;
        },
        list(shard, now = Date.now()) {
            return listPeersForShard(presenceCache, shard, now);
        },
        prune(now = Date.now()) {
            // prunePresenceCache may delete cache rows but doesn't know about the
            // secondary index; rebuild idToPh from surviving entries to stay in sync.
            prunePresenceCache(presenceCache, now);
            idToPh.clear();
            for (const entry of presenceCache.values()) syncIndex(entry);
        },
        removeById(trysteroId) {
            const ph = idToPh.get(trysteroId);
            if (!ph) return false;
            idToPh.delete(trysteroId);
            return presenceCache.delete(ph);
        },
        size() {
            return presenceCache.size;
        },
    };
};
