import * as torrent from '@trystero-p2p/torrent';
import * as nostr from '@trystero-p2p/nostr';
import { createCompositeRoom } from './multi-room.js';
import { markNetworkEvent } from './audit-debug.js';

const getTransport = () => globalThis.__FENHOLLOW_TRANSPORT__ || torrent;
const nativeStrategies = { torrent, nostr };

export const selfId = getTransport().selfId;

// Lazy-loaded to avoid a circular import with network/index.js. setupShard
// assigns gameActions.seedShardIntroducers; the composite uses it to nudge
// HyParView when a strategy slot drops a peer.
let _gameActions = null;
const getGameActions = async () => {
    if (_gameActions) return _gameActions;
    const mod = await import('./index.js');
    _gameActions = mod.gameActions;
    return _gameActions;
};

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
        // On per-strategy drop, hint HyParView with the peer's id. If they're
        // still reachable via the other strategy this is a no-op; if not, the
        // next shuffle propagates them as a passive-view candidate so the
        // dropped strategy's tracker/relay announce cycle has a target to retry.
        if (event === 'strategy_slot_drop' && detail.peerId) {
            getGameActions().then(ga => {
                ga.seedShardIntroducers?.([detail.peerId]);
            }).catch(() => { /* never block signaling */ });
        }
    });
};
