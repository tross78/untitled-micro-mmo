import {
    addToPresenceCache,
    listPeersForShard,
    prunePresenceCache,
    sanitizePresenceEntry,
} from './arbiter-presence-cache.js';

export const createPresenceDirectory = () => {
    const presenceCache = new Map();

    return {
        register(rawEntry, now = Date.now()) {
            const entry = sanitizePresenceEntry(rawEntry, now);
            if (!entry) return null;
            addToPresenceCache(presenceCache, entry.ph, entry, entry.ts);
            return entry;
        },
        list(shard, now = Date.now()) {
            return listPeersForShard(presenceCache, shard, now);
        },
        prune(now = Date.now()) {
            prunePresenceCache(presenceCache, now);
        },
        removeById(trysteroId) {
            for (const [ph, entry] of presenceCache.entries()) {
                if (entry.id === trysteroId) {
                    presenceCache.delete(ph);
                    return true;
                }
            }
            return false;
        },
        size() {
            return presenceCache.size;
        },
    };
};
