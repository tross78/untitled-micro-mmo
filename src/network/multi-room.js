const RECENT_PAYLOAD_TTL_MS = 1500;
const MAX_RECENT_PAYLOADS = 512;

// Two-seed FNV-1a 32-bit pass over the whole buffer. Combined width is ~64 bits,
// which is collision-safe for the <512-entry sliding window we keep. The previous
// length+first+last-byte fingerprint collided on distinct binary packets and
// silently suppressed movement/action logs.
const hashBytes = (bytes) => {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < bytes.length; i += 1) {
        h1 ^= bytes[i];
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= bytes[i];
        h2 = Math.imul(h2, 0x85ebca6b);
    }
    return ((h1 >>> 0).toString(36)) + ':' + ((h2 >>> 0).toString(36));
};

const payloadFingerprint = (payload) => {
    if (payload === null || payload === undefined) return String(payload);
    if (typeof payload === 'string' || typeof payload === 'number' || typeof payload === 'boolean') {
        return String(payload);
    }
    if (payload instanceof ArrayBuffer) {
        const bytes = new Uint8Array(payload);
        return `ab:${bytes.length}:${hashBytes(bytes)}`;
    }
    if (ArrayBuffer.isView(payload)) {
        const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        return `view:${bytes.length}:${hashBytes(bytes)}`;
    }
    try {
        return JSON.stringify(payload);
    } catch {
        return Object.prototype.toString.call(payload);
    }
};

const pruneRecentPayloads = (recent, now) => {
    for (const [key, ts] of recent) {
        if (now - ts > RECENT_PAYLOAD_TTL_MS || recent.size > MAX_RECENT_PAYLOADS) {
            recent.delete(key);
        } else {
            break;
        }
    }
};

export const createCompositeRoom = (entries, observer = null) => {
    const createdAt = Date.now();
    const rooms = entries
        .filter(entry => entry?.room)
        .map(entry => ({
            name: entry.name || 'unknown',
            room: entry.room,
            peers: new Set(),
            firstPeerAt: 0,
        }));
    const peerSlots = new Map();
    const recentPayloads = new Map();
    let peerJoinHandler = (_peerId) => {};
    let peerLeaveHandler = (_peerId) => {};
    let firstPeerWinner = null;

    const emit = (event, detail) => {
        if (typeof observer !== 'function') return;
        try { observer(event, detail); } catch { /* observer must not break signaling */ }
    };

    const addPeerSlot = (peerId, slot) => {
        if (!peerId) return;
        slot.peers.add(peerId);
        const existing = peerSlots.get(peerId) || new Set();
        const wasEmpty = existing.size === 0;
        existing.add(slot);
        peerSlots.set(peerId, existing);
        const sinceCreate = Date.now() - createdAt;
        if (!slot.firstPeerAt) {
            slot.firstPeerAt = sinceCreate;
            emit('strategy_first_peer', { strategy: slot.name, peerId, sinceCreate });
        }
        if (!firstPeerWinner) {
            firstPeerWinner = slot.name;
            emit('strategy_race_won', { strategy: slot.name, peerId, sinceCreate });
        }
        emit('strategy_peer_join', { strategy: slot.name, peerId, sinceCreate });
        if (wasEmpty) peerJoinHandler(peerId);
    };

    const removePeerSlot = (peerId, slot) => {
        if (!peerId) return;
        slot.peers.delete(peerId);
        const existing = peerSlots.get(peerId);
        if (!existing) return;
        existing.delete(slot);
        if (existing.size > 0) return;
        peerSlots.delete(peerId);
        peerLeaveHandler(peerId);
    };

    for (const slot of rooms) {
        slot.room.onPeerJoin?.(peerId => addPeerSlot(peerId, slot));
        slot.room.onPeerLeave?.(peerId => removePeerSlot(peerId, slot));
    }

    const resolveTargetSlots = (targets) => {
        if (!targets) return rooms;
        const ids = Array.isArray(targets) ? targets : [targets];
        const selected = new Set();
        for (const id of ids) {
            for (const slot of peerSlots.get(id) || []) selected.add(slot);
        }
        return selected.size > 0 ? Array.from(selected) : rooms;
    };

    const shouldDeliver = (action, payload, peerId) => {
        const now = Date.now();
        pruneRecentPayloads(recentPayloads, now);
        const key = `${action}|${peerId}|${payloadFingerprint(payload)}`;
        if (recentPayloads.has(key) && now - recentPayloads.get(key) <= RECENT_PAYLOAD_TTL_MS) {
            return false;
        }
        recentPayloads.set(key, now);
        return true;
    };

    return {
        makeAction(action) {
            const actionSlots = rooms.map(slot => {
                const [send, receive, progress] = slot.room.makeAction(action);
                return { ...slot, send, receive, progress };
            });

            const send = (data, targets, meta, onProgress) => {
                const targetSlots = resolveTargetSlots(targets);
                return Promise.all(targetSlots.map(slot => {
                    const actionSlot = actionSlots.find(candidate => candidate.room === slot.room);
                    return actionSlot?.send(data, targets, meta, onProgress);
                }).filter(Boolean));
            };

            const receive = (handler) => {
                actionSlots.forEach(slot => {
                    slot.receive((payload, peerId, meta) => {
                        if (!shouldDeliver(action, payload, peerId)) return;
                        handler(payload, peerId, meta);
                    });
                });
            };

            const progress = (handler) => {
                actionSlots.forEach(slot => slot.progress?.(handler));
            };

            return [send, receive, progress];
        },
        onPeerJoin(handler) {
            peerJoinHandler = typeof handler === 'function' ? handler : () => {};
        },
        onPeerLeave(handler) {
            peerLeaveHandler = typeof handler === 'function' ? handler : () => {};
        },
        getPeers() {
            const merged = {};
            for (const slot of rooms) {
                Object.assign(merged, slot.room.getPeers?.() || {});
                for (const peerId of slot.peers) merged[peerId] = merged[peerId] || true;
            }
            return merged;
        },
        leave() {
            // Tell consumers about every still-present peer before tearing down,
            // so HyParView and presence tracking can release per-peer state.
            const lingering = Array.from(peerSlots.keys());
            rooms.forEach(slot => slot.room.leave?.());
            peerSlots.clear();
            rooms.forEach(slot => slot.peers.clear());
            for (const peerId of lingering) {
                try { peerLeaveHandler(peerId); } catch { /* keep iterating */ }
            }
        },
        getStrategyPeers() {
            return Object.fromEntries(rooms.map(slot => [slot.name, Array.from(slot.peers)]));
        },
        getStrategyTimings() {
            return Object.fromEntries(rooms.map(slot => [slot.name, slot.firstPeerAt || null]));
        },
        getRaceWinner() {
            return firstPeerWinner;
        },
    };
};
