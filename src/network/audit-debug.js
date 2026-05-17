import { getRuntimeParam, isE2EMode } from '../infra/runtime.js';

const MAX_HISTORY = 128;

const createState = () => ({
    startedAt: Date.now(),
    events: [],
    peers: new Map(),
});

let state = createState();

export const isNetworkAuditEnabled = () =>
    isE2EMode() && getRuntimeParam('debugnet') === '1';

export const resetNetworkAudit = () => {
    state = createState();
};

const pushEvent = (list, record) => {
    list.push(record);
    if (list.length > MAX_HISTORY) list.shift();
};

export const markNetworkEvent = (event, detail = null) => {
    if (!isNetworkAuditEnabled()) return;
    pushEvent(state.events, { event, at: Date.now(), detail });
};

export const markPeerNetworkEvent = (peerId, event, detail = null) => {
    if (!isNetworkAuditEnabled() || !peerId) return;
    let peer = state.peers.get(peerId);
    if (!peer) {
        peer = { events: {}, history: [] };
        state.peers.set(peerId, peer);
    }
    const at = Date.now();
    if (!peer.events[event]) peer.events[event] = at;
    pushEvent(peer.history, { event, at, detail });
};

export const getNetworkAuditSnapshot = (players, localLocation, shardKnownPeers, peerLastPresenceAt) => {
    if (!isNetworkAuditEnabled()) return null;
    const peers = {};
    for (const [peerId, peer] of state.peers.entries()) {
        peers[peerId] = {
            events: { ...peer.events },
            history: peer.history.slice(),
        };
    }
    const now = Date.now();
    const sameRoomLivePeers = Array.from(players.entries())
        .filter(([, entry]) => entry.location === localLocation && !entry.ghost && !!entry.publicKey)
        .map(([peerId]) => peerId);
    // Distinguish transport-connected, usable, and stale peers for failure classification.
    const transportPeers = shardKnownPeers ? Array.from(shardKnownPeers) : [];
    const usableShardPeers = transportPeers.filter(id => {
        const p = players.get(id);
        return p?.publicKey && !p.ghost;
    });
    const stalePeers = peerLastPresenceAt
        ? Array.from(peerLastPresenceAt.entries())
            .filter(([, ts]) => now - ts > 20000)
            .map(([id]) => id)
        : [];
    return {
        startedAt: state.startedAt,
        now,
        events: state.events.slice(),
        peers,
        sameRoomLivePeers,
        transportPeers,
        usableShardPeers,
        stalePeers,
    };
};
