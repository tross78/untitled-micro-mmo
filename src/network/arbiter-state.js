import { stableStringify } from '../security/crypto.js';

export const listPersistedBans = (source) => {
    const list = source instanceof Set ? [...source]
        : Array.isArray(source) ? source
        : [];
    return [...new Set(list.filter(value => typeof value === 'string' && value.trim()))].sort();
};

export const getBansVersion = (source) => stableStringify(listPersistedBans(source));

// lastRollups is a per-shard "what did the proposer commit" record used to
// cross-check witness fraud reports. Persisting it across restart keeps fraud
// detection working immediately after a reboot — without it, fraud reports
// referencing a pre-restart rollup are silently rejected by the proposer
// cross-check (since the in-memory Map starts empty).
export const serializeLastRollups = (lastRollups) => {
    if (!lastRollups) return {};
    if (lastRollups instanceof Map) return Object.fromEntries(lastRollups);
    if (typeof lastRollups === 'object') return { ...lastRollups };
    return {};
};

export const buildPersistedArbiterPacket = (state, signature, bans, lastRollups) => ({
    state,
    signature,
    bans: listPersistedBans(bans),
    lastRollups: serializeLastRollups(lastRollups),
});

export const restoreBansFromPacket = (packet) => {
    if (Array.isArray(packet?.bans)) return listPersistedBans(packet.bans);
    if (Array.isArray(packet?.state?.bans)) return listPersistedBans(packet.state.bans);
    return [];
};

export const restoreLastRollupsFromPacket = (packet) => {
    const map = new Map();
    const source = packet?.lastRollups;
    if (source && typeof source === 'object') {
        for (const [shard, rollup] of Object.entries(source)) {
            if (!shard || !rollup || typeof rollup !== 'object') continue;
            if (typeof rollup.root !== 'string' || typeof rollup.proposer !== 'string') continue;
            map.set(shard, rollup);
        }
    }
    return map;
};
