import { signMessage } from '../crypto.js';
import { localPlayer, players, trackPlayer } from '../store.js';
import { packPresence, unpackPresence, presenceSignaturePayload } from './packer.js';
import { playerKeys } from '../identity.js';
import { Minisketch } from './minisketch.js';
import { selfId } from './transport.js';

export const buildSketch = () => {
    const ms = new Minisketch(32);
    players.forEach((p, id) => {
        if (!p.ghost) ms.add(id);
    });
    ms.add(selfId);
    return ms;
};

export const signPresence = async (entry) => {
    const signature = await signMessage(JSON.stringify(presenceSignaturePayload(entry)), playerKeys.privateKey);
    return { ...entry, signature };
};

export const packSignedPresence = async (entry) => packPresence(await signPresence(entry));

export const isPresenceLike = (value) => value && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof ArrayBuffer)
    && !ArrayBuffer.isView(value)
    && typeof value.name === 'string'
    && typeof value.location === 'string'
    && typeof value.ph === 'string'
    && typeof value.level === 'number'
    && typeof value.xp === 'number';

export const unpackPresencePacket = (presence) => {
    if (isPresenceLike(presence)) return presence;
    if (!presence) return null;
    try {
        return unpackPresence(presence);
    } catch {
        return null;
    }
};

export const seedFromSnapshot = (snapshot) => {
    if (!Array.isArray(snapshot)) return;
    const existingPhs = new Set(Array.from(players.values()).map(p => p.ph));
    const now = Date.now();
    for (const entry of snapshot) {
        if (!entry.ph || !entry.location || existingPhs.has(entry.ph)) continue;
        if (entry.ph === localPlayer.ph) continue;

        const ghostKey = 'ghost:' + entry.ph;
        if (!players.has(ghostKey)) {
            const ts = entry.ts && (now - entry.ts < 300000) ? entry.ts : now;
            trackPlayer(ghostKey, { 
                ...entry, 
                ghost: true, 
                ts,
                x: entry.x ?? 5,
                y: entry.y ?? 5
            });
        }
    }
};
