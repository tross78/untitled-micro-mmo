import { stableStringify } from '../security/crypto.js';

export const listPersistedBans = (source) => {
    const list = Array.isArray(source) ? source : [];
    return [...new Set(list.filter(value => typeof value === 'string' && value.trim()))].sort();
};

export const getBansVersion = (source) => stableStringify(listPersistedBans(source));

export const buildPersistedArbiterPacket = (state, signature, bans) => ({
    state,
    signature,
    bans: listPersistedBans(bans),
});

export const restoreBansFromPacket = (packet) => {
    if (Array.isArray(packet?.bans)) return listPersistedBans(packet.bans);
    if (Array.isArray(packet?.state?.bans)) return listPersistedBans(packet.state.bans);
    return [];
};
