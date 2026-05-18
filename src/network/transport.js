import * as torrent from '@trystero-p2p/torrent';
import * as nostr from '@trystero-p2p/nostr';
import { createCompositeRoom } from './multi-room.js';
import { markNetworkEvent } from './audit-debug.js';

const getTransport = () => globalThis.__FENHOLLOW_TRANSPORT__ || torrent;
const nativeStrategies = { torrent, nostr };

export const selfId = getTransport().selfId;

export const joinRoom = (config, roomId, callbacks) => {
    const override = globalThis.__FENHOLLOW_TRANSPORT__;
    if (override) return override.joinRoom(config, roomId, callbacks);
    if (!Array.isArray(config?.strategyRace) || config.strategyRace.length === 0) {
        return torrent.joinRoom(config, roomId, callbacks);
    }

    const rooms = [];
    for (const entry of config.strategyRace) {
        const strategy = nativeStrategies[entry.name];
        if (!strategy?.joinRoom) continue;
        try {
            rooms.push({
                name: entry.name,
                room: strategy.joinRoom(entry.config, roomId, callbacks),
            });
        } catch (err) {
            console.warn(`[P2P] ${entry.name} signaling join failed: ${err.message}`);
        }
    }

    if (rooms.length === 0) return torrent.joinRoom(config.fallbackConfig || config, roomId, callbacks);
    return createCompositeRoom(rooms, (event, detail) => {
        markNetworkEvent(`signal:${event}`, { ...detail, room: roomId });
    });
};
