// @ts-check
import { joinRoom as joinTorrent, selfId } from './transport.js';
import { getShardName, hashStr, seededRNG, xpToLevel, rollLoot } from '../rules/index.js';
import { ICE_SERVERS, ARBITER_URL } from '../infra/constants.js';
import {
    worldState, localPlayer, hasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel,
    players, shadowPlayers, shardEnemies, trackPlayer, trackShadowPlayer, bans,
    _presenceDelta, clearPresenceDelta, evictPlayer, evictShadowPlayer,
    setArbiterLastSeenAt, isHardStateFrozen, hardStateQueue
} from '../state/store.js';
import { INSTANCE_CAP, ENEMIES, QUESTS, world as worldGraph } from '../content/data.js';
import { verifyMessage, signMessage, exportKey, importKey, stableStringify } from '../security/crypto.js';
import { Minisketch } from './minisketch.js';
import { HyParView } from './hyparview.js';
import { sendHLC } from './hlc.js';
import {
    unpackMove,
    unpackDuelCommit,
    unpackActionLog, unpackTradeCommit,
    packPresenceBatch, unpackPresenceBatch,
    presenceSignaturePayload
} from './packer.js';
import { arbiterPublicKey, playerKeys, myEntry } from '../security/identity.js';
import { log } from '../ui/index.js';
import { GAME_NAME } from '../content/data.js';
import { bus } from '../state/eventbus.js';
import { saveLocalState } from '../state/persistence.js';
import { getArbiterUrl } from '../infra/runtime.js';
import { NETWORK_ACTIONS } from './contracts.js';

// Modular Networking Components
import {
    ROLLUP_INTERVAL, PROPOSER_GRACE_MS, NETWORK_STALL_MS,
    NETWORK_HEAL_COOLDOWN_MS, NETWORK_EVENT_HEAL_DELAY_MS, NETWORK_HANDSHAKE_TIMEOUT_MS,
    NETWORK_STARTUP_TURN_FALLBACK_MS,
    NETWORK_PRESENCE_HEARTBEAT_MS, NETWORK_PEER_STALE_MS, NETWORK_PEER_SWEEP_MS,
    GHOST_TTL_MS, INTRODUCER_TTL_COLD_MS, INTRODUCER_TTL_WARM_MS,
    buildFastRoomConfig, buildTorrentConfig, isUsingTurnFallback
} from './config.js';
import { registerWithHints } from './arbiter-signal.js';
import {
    checkXpRate, checkAndUpdateHlc, buildLeafData, clearSecurityState, evictSecurityPeer
} from './security.js';
import { 
    buildSketch, packSignedPresence, unpackPresencePacket, seedFromSnapshot 
} from './presence.js';
import { updateSimulation, initOfflineDayTick } from './simulation.js';
import {
    getCurrentInstance, setCurrentInstance, preJoinShard, getPreJoined, clearShardState, clearShardChannels
} from './shard.js';
import { buildShardActions } from './actions.js';
import { filterConnectedPeerIds } from './peer-filter.js';
import { countUsableShardPeers, shouldRunEventHeal } from './heal.js';
import { markNetworkEvent, markPeerNetworkEvent } from './audit-debug.js';
import { installNetworkDiagnostics, setNetworkDiagnosticContextProvider } from './diagnostics.js';

export { seedFromSnapshot, updateSimulation, initOfflineDayTick, preJoinShard, buildFastRoomConfig, buildTorrentConfig, isProposer };

const netLog = (msg, color = '#555') => {
    if (localStorage.getItem(`${GAME_NAME}_debug`) === 'true') {
        log(`[Net] ${msg}`, color);
    }
};

export let gameActions = {};
export let rooms = { torrent: null };
export let globalRooms = { torrent: null };
export const globalKnownPeers = new Set();
export const shardKnownPeers = new Set();
export const knownPeers = shardKnownPeers;
const globalPeerHints = new Map();
// Stale hints can outlive the shard they advertise. Prune anything older than this
// before reading the map so dead peers stop influencing same-shard bootstrap.
const GLOBAL_PEER_HINT_TTL_MS = 5 * 60_000;
const NETWORK_RESUME_RECONNECT_MIN_HIDDEN_MS = 15_000;
const NETWORK_RESUME_RECONNECT_COOLDOWN_MS = 5_000;
const SHARD_SNAPSHOT_REFRESH_DELAYS_MS = [1500, 5000, 12000, 30000];
const pruneGlobalPeerHints = (now = Date.now()) => {
    for (const [peerId, hint] of globalPeerHints) {
        if (!hint || now - (hint.ts || 0) > GLOBAL_PEER_HINT_TTL_MS) globalPeerHints.delete(peerId);
    }
};
let lastShardHintAt = 0;
let lastShardHintCount = 0;
const recordShardPeerHints = (count, now = Date.now()) => {
    lastShardHintAt = now;
    lastShardHintCount = count;
};
const hasRecentShardPeerExpectation = (now = Date.now()) => {
    const currentShard = getShardName(localPlayer.location, getCurrentInstance());
    pruneGlobalPeerHints(now);
    for (const hint of globalPeerHints.values()) {
        if (hint?.shard === currentShard) return true;
    }
    return lastShardHintCount > 0 && now - lastShardHintAt <= GLOBAL_PEER_HINT_TTL_MS;
};
export let lastRollupReceivedAt = 0;
export let lastValidStatePacket = null;
export let currentRtcConfig = { iceServers: ICE_SERVERS };
export let joinTime = Date.now();
let lastShardPresenceAt = Date.now();
let lastNetworkHealAt = 0;
let networkHealInFlight = false;
let lastGlobalPeerAt = 0;
let scheduledHealTimer = null;
let healNetworking = async (_opts = {}) => {};
let networkResumeCleanup = null;
const scheduleHeal = (delay = NETWORK_EVENT_HEAL_DELAY_MS, options = {}) => {
    const { force = false, urgent = false } = options;
    if (scheduledHealTimer) clearTimeout(scheduledHealTimer);
    scheduledHealTimer = setTimeout(() => {
        scheduledHealTimer = null;
        healNetworking({ force, urgent }).catch(() => {});
    }, delay);
};

const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);
const roomPeerCount = (room) => room?.getPeers ? Object.keys(room.getPeers()).length : 0;
const supportsChannelEvents = (channel) =>
    channel && typeof channel.addEventListener === 'function' && typeof channel.removeEventListener === 'function';
const addChannelListener = (channel, handler) => {
    if (!supportsChannelEvents(channel)) return false;
    /** @type {BroadcastChannel} */ (channel).addEventListener('message', handler);
    return true;
};
const removeChannelListener = (channel, handler) => {
    if (!supportsChannelEvents(channel)) return;
    /** @type {BroadcastChannel} */ (channel).removeEventListener('message', handler);
};

const fetchArbiterPeerSnapshot = async (shard) => {
    const arbiterUrl = runtimeArbiterUrl();
    if (!arbiterUrl || typeof fetch !== 'function') return 0;
    try {
        const timeoutSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(3000)
            : undefined;
        const response = await fetch(`${arbiterUrl}/peers?shard=${encodeURIComponent(shard)}`, { signal: timeoutSignal });
        const body = response?.ok ? await response.json() : null;
        if (!body) return 0;
        if (Array.isArray(body)) {
            recordShardPeerHints(body.length);
            seedFromSnapshot(body);
            return body.length;
        }
        if (!body.signature || !Array.isArray(body.peers)) return 0;
        const payload = { peers: body.peers, shard: body.shard || null, ts: body.ts };
        const ok = await verifyMessage(stableStringify(payload), body.signature, arbiterPublicKey).catch(() => false);
        if (!ok) return 0;
        recordShardPeerHints(body.peers.length);
        seedFromSnapshot(body.peers);
        if (body.peers.length > 0) {
            markNetworkEvent('shard:arbiter_snapshot', { shard, count: body.peers.length });
        }
        return body.peers.length;
    } catch {
        return 0;
    }
};

// --- Introducer cache -------------------------------------------------------
// Persists up to 5 peer IDs per shard so rejoining players can seed HyParView
// with known-good introducers before tracker discovery completes.
// Only peers that have sent verified presence this session are saved (warm peers).
// Warm peers get 8h TTL; cold peers (cached from older sessions) get 2h TTL.
const INTRODUCER_CACHE_KEY = `${GAME_NAME}_introducers_v2`;

// Peers that have sent verified presence at least once this session.
// Bounded LRU so a long-running session does not accumulate every peer ever seen.
const INTRO_PEER_SET_CAP = 512;
const _addBoundedSetEntry = (set, value) => {
    if (set.has(value)) {
        set.delete(value);
        set.add(value);
        return;
    }
    if (set.size >= INTRO_PEER_SET_CAP) {
        const oldest = set.values().next().value;
        set.delete(oldest);
    }
    set.add(value);
};
const _introSuccessPeers = new Set();
// Peers that timed out on handshake this session — deprioritised on next load.
const _introFailedPeers = new Set();
const markIntroSuccess = (peerId) => _addBoundedSetEntry(_introSuccessPeers, peerId);
const markIntroFailed = (peerId) => _addBoundedSetEntry(_introFailedPeers, peerId);

const saveIntroducers = (shard) => {
    const directPeers = rooms.torrent?.getPeers?.() || {};
    const top = Object.keys(directPeers)
        .filter(id => players.has(id) && !players.get(id).ghost && _introSuccessPeers.has(id))
        .slice(0, 5);
    if (top.length === 0) return;
    const warm = top.every(id => _introSuccessPeers.has(id));
    try {
        const cache = JSON.parse(localStorage.getItem(INTRODUCER_CACHE_KEY) || '{}');
        cache[shard] = { peers: top, ts: Date.now(), warm };
        localStorage.setItem(INTRODUCER_CACHE_KEY, JSON.stringify(cache));
    } catch (_) { /* ignore */ }
};

const loadIntroducers = (shard) => {
    try {
        const cache = JSON.parse(localStorage.getItem(INTRODUCER_CACHE_KEY) || '{}');
        const entry = cache[shard];
        if (!entry) return [];
        const ttl = entry.warm ? INTRODUCER_TTL_WARM_MS : INTRODUCER_TTL_COLD_MS;
        if (Date.now() - entry.ts > ttl) return [];
        // Filter out peers that failed handshake in this session.
        return (entry.peers || []).filter(id => !_introFailedPeers.has(id));
    } catch (_) { return []; }
};

const applyActionLogToShadow = (peerId, data) => {
    let shadow = shadowPlayers.get(peerId) || { level: 1, xp: 0, inventory: [], gold: 0, actionIndex: -1 };
    if (data.index <= shadow.actionIndex) return;
    const entry = players.get(peerId);
    const rng = seededRNG(hashStr(worldState.seed + '|' + entry.publicKey + '|' + data.index));
    if (data.type === 'kill' && ENEMIES[data.target]) {
        const expectedXp = ENEMIES[data.target].xp;
        // If the peer claimed a per-kill XP value (data.data) that doesn't match the
        // canonical enemy XP, that's an attempt to over-claim — submit xp_fraud.
        // Older clients send data: 0 which we treat as "no claim" (skip the check).
        if (data.data && data.data !== expectedXp && gameActions.submitFraudProof) {
            gameActions.submitFraudProof({
                type: 'xp_fraud',
                proof: {
                    publicKey: entry.publicKey,
                    feedEntry: { type: data.type, target: data.target, xp: data.data },
                    actionEntropy: worldState.seed + '|' + entry.publicKey + '|' + data.index,
                },
                witness: { publicKey: null },
            });
            return;
        }
        // Rate-limit XP gain from action_log the same way presence-announced XP is gated.
        // Without this, a peer can pump shadow XP via valid-signature kill spam even
        // when each individual kill claims the legitimate XP value.
        if (!checkXpRate(peerId, shadow.xp + expectedXp, shadow.xp)) return;
        shadow.xp += expectedXp;
        shadow.level = xpToLevel(shadow.xp);
        shadow.inventory.push(...rollLoot(data.target, rng));
        shadow.gold += rng(10);
    }
    shadow.actionIndex = data.index;
    trackShadowPlayer(peerId, shadow);
};

const replayQueuedActionLogs = async () => {
    if (hardStateQueue.length === 0) return;
    const queued = hardStateQueue.splice(0);
    for (const item of queued) {
        const { peerId, data, publicKey } = item || {};
        if (!peerId || !data || !publicKey) continue;
        try {
            const pubKey = await importKey(publicKey, 'public');
            if (!await verifyMessage(JSON.stringify({ type: data.type, index: data.index, target: data.target, data: data.data }), data.signature, pubKey)) continue;
            const entry = players.get(peerId);
            if (!entry) {
                trackPlayer(peerId, { publicKey, ph: (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0'), ts: Date.now() });
            }
            applyActionLogToShadow(peerId, data);
        } catch (_err) {
            continue;
        }
    }
};

// --- Router election state (item 7) --------------------------------------
// Routers are the top-8 peers by session uptime. They get prioritized into
// HyParView's active view to act as a stable backbone layer within each shard.
const peerJoinTimes = new Map(); // peerId -> joinTime (ms)

// --- 8.95b: Per-peer message throttle ---------------------------------------
const THROTTLE_WINDOW_MS = 1000;
const THROTTLE_MAX_MSGS = 20;
const _peerMsgCounts = new Map(); // peerId -> { count, windowStart }
const checkThrottle = (peerId) => {
    const now = Date.now();
    const rec = _peerMsgCounts.get(peerId) || { count: 0, windowStart: now };
    if (now - rec.windowStart > THROTTLE_WINDOW_MS) {
        rec.count = 1; rec.windowStart = now;
    } else {
        rec.count++;
    }
    _peerMsgCounts.set(peerId, rec);
    return rec.count <= THROTTLE_MAX_MSGS;
};

// --- Ghost-peer TTL (see config.js for GHOST_TTL_MS) -----------------------
const _peerLastPresenceAt = new Map(); // peerId -> timestamp
export const getPeerLastPresenceSnapshot = () => new Map(_peerLastPresenceAt);
let routerSet = new Set();

// Per-peer commit-reveal and feed heads
const pendingCommits = new Map();
const feedHeads = new Map();

const isProposer = () => {
    const all = Array.from(players.keys())
        .filter(id => {
            const peer = players.get(id);
            return peer?.presenceVerifiedAt && !peer.ghost;
        })
        .concat(selfId)
        .sort();
    if (all.length < 2) return false;

    const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
    if (all[slot] === selfId) return true;
    if (Date.now() - lastRollupReceivedAt > PROPOSER_GRACE_MS) {
        return all[(slot + 1) % all.length] === selfId;
    }
    return false;
};

export const initNetworking = async (rtcConfig) => {
    currentRtcConfig = rtcConfig || { iceServers: ICE_SERVERS };
    markNetworkEvent('network:init');
    setNetworkDiagnosticContextProvider(() => ({
        globalPeers: roomPeerCount(globalRooms.torrent),
        shardPeers: roomPeerCount(rooms.torrent),
        globalKnownPeers: globalKnownPeers.size,
        shardKnownPeers: shardKnownPeers.size,
        trackedPlayers: players.size,
        synced: hasSyncedWithArbiter,
        location: localPlayer.location,
        shard: getShardName(localPlayer.location, getCurrentInstance()),
    }));
    installNetworkDiagnostics();

    // Respond to same-origin tab shard probes with our current known non-ghost peers.
    addChannelListener(TAB_CHANNEL, (e) => {
        if (e.data?.type !== 'shard:probe') return;
        const currentShard = getShardName(localPlayer.location, getCurrentInstance());
        if (e.data.shard !== currentShard || e.data.selfId === selfId) return;
        const peers = Array.from(players.keys()).filter(id => !players.get(id)?.ghost);
        if (peers.length > 0) TAB_CHANNEL.postMessage({ type: 'shard:peers', shard: currentShard, peers });
    });

    const connectGlobal = async (config) => {
        markNetworkEvent('global:connect_start');
        if (globalRooms.torrent) globalRooms.torrent.leave();
        globalKnownPeers.clear();
        lastGlobalPeerAt = 0;
        globalPeerHints.clear();
        globalRooms.torrent = joinTorrent(buildTorrentConfig(config), 'global');

        const [sendRollup] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.ROLLUP_SUBMIT);
        const [sendFraud] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.FRAUD_REPORT);
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.WORLD_STATE);
        const [sendStateRequest, getStateRequest] = globalRooms.torrent.makeAction('state_request');
        const [sendRegisterPresence, getRegisterPresence] = globalRooms.torrent.makeAction('register_presence');
        gameActions.sendRegisterPresence = (data) => sendRegisterPresence(data);
        const [, getArbiterPeerHints] = globalRooms.torrent.makeAction('arbiter_peer_hints');
        getArbiterPeerHints((hints) => {
            if (!Array.isArray(hints) || hints.length === 0) return;
            recordShardPeerHints(hints.length);
            const peerIds = hints.map(h => h.id).filter(Boolean);
            if (peerIds.length > 0 && gameActions.seedShardIntroducers) gameActions.seedShardIntroducers(peerIds);
        });
        const [sendStateOffer, getStateOffer] = globalRooms.torrent.makeAction('state_offer');
        const [sendSeekingShard, getSeekingShard] = globalRooms.torrent.makeAction('seeking_shard');
        gameActions.sendSeekingShard = (shard) => sendSeekingShard(shard);
        const [sendPresenceBootstrap, getPresenceBootstrap] = globalRooms.torrent.makeAction('presence_bootstrap');
        const currentShardName = () => getShardName(localPlayer.location, getCurrentInstance());
        const buildRegistration = async (shard) => {
            if (!playerKeys) return null;
            const entry = await myEntry();
            if (!entry) return null;
            return {
                ...entry,
                id: selfId,
                publicKey: await exportKey(playerKeys.publicKey),
                shard,
            };
        };
        const maybeSendSameShardBootstrap = async (peerId, shard = currentShardName()) => {
            if (!peerId || peerId === selfId || shard !== currentShardName()) return;
            const registration = await buildRegistration(shard);
            if (!registration || bans.has(registration.publicKey)) return;
            const { publicKey, shard: _shard, ...presenceEntry } = registration;
            sendPresenceBootstrap({
                presence: await packSignedPresence({ ...presenceEntry, hlc: sendHLC() }),
                publicKey,
            }, [peerId]);
        };
        const announceCurrentShardToPeer = async (peerId) => {
            if (!peerId || peerId === selfId) return;
            const shard = currentShardName();
            sendSeekingShard(shard, [peerId]);
            const registration = await buildRegistration(shard);
            if (registration) sendRegisterPresence(registration, [peerId]);
            pruneGlobalPeerHints();
            if (globalPeerHints.get(peerId)?.shard === shard) await maybeSendSameShardBootstrap(peerId, shard);
        };

        getSeekingShard(async (payload, peerId) => {
            const shard = typeof payload === 'string' ? payload : payload?.shard;
            const migrate = typeof payload === 'object' && payload?.migrate;
            if (migrate) {
                // 8.95f: peer suggests we migrate to a less-populated shard instance
                bus.emit('shard:migrate', { shard });
                return;
            }
            const currentShard = currentShardName();
            if (shard === currentShard) {
                const registration = await buildRegistration(currentShard);
                if (registration) {
                    const { publicKey, shard: _shard, ...presenceEntry } = registration;
                    const packed = await packSignedPresence({ ...presenceEntry, hlc: sendHLC() });
                    sendPresenceBootstrap({
                        presence: packed,
                        publicKey
                    }, [peerId]);
                }
            }
        });

        getRegisterPresence(async (payload, peerId) => {
            if (!payload || peerId === selfId) return;
            globalPeerHints.set(peerId, {
                shard: payload.shard,
                publicKey: payload.publicKey,
                ph: payload.ph,
                ts: Date.now(),
            });
            if (payload.publicKey && !bans.has(payload.publicKey)) {
                const entry = players.get(peerId) || {};
                const ph = payload.ph || (hashStr(payload.publicKey) >>> 0).toString(16).padStart(8, '0');
                trackPlayer(peerId, { ...entry, publicKey: payload.publicKey, ph, ts: Date.now() });
            }
            if (payload.shard === currentShardName()) {
                // Seed the shard's HyParView introducer list so the trystero shard room
                // connects to this peer immediately instead of waiting for tracker discovery.
                if (gameActions.seedShardIntroducers && peerId) {
                    gameActions.seedShardIntroducers([peerId]);
                }
                await maybeSendSameShardBootstrap(peerId, payload.shard);
            }
        });

        getPresenceBootstrap(async (packet, peerId) => {
            if (peerId === selfId) return;
            if (!packet?.presence || !packet?.publicKey || bans.has(packet.publicKey)) return;
            markPeerNetworkEvent(peerId, 'global:presence_bootstrap');
            const entry = players.get(peerId) || {};
            const ph = (hashStr(packet.publicKey) >>> 0).toString(16).padStart(8, '0');
            trackPlayer(peerId, { ...entry, publicKey: packet.publicKey, ph, ts: Date.now() });
            markPeerNetworkEvent(peerId, 'peer:identity_known');
            if (gameActions.processPresence) {
                // Trystero serializes Uint8Array fields inside plain objects via msgpack/JSON,
                // which may arrive as a plain object with numeric keys or a regular Array.
                // Normalize to Uint8Array regardless of the wire form — never try to re-pack.
                const raw = packet.presence;
                const buf = raw instanceof Uint8Array ? raw
                    : new Uint8Array(Array.isArray(raw) ? raw : Object.values(raw));
                await gameActions.processPresence(buf, peerId);
            }
        });

        gameActions.submitRollup = (rollup) => sendRollup(rollup);
        gameActions.submitFraudProof = (proof) => sendFraud(proof);

        getState(async (data, _peerId) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : stableStringify(state);
            try {
                if (await verifyMessage(stateStr, signature, arbiterPublicKey)) {
                    setArbiterLastSeenAt();
                    lastValidStatePacket = data;
                    TAB_CHANNEL.postMessage({ type: 'state', packet: data });
                    updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
                    if (isProposer() && gameActions.relayState) gameActions.relayState(data);
                    if (hardStateQueue.length > 0) {
                        netLog(`[HardState] Replaying ${hardStateQueue.length} queued peer ops`, '#0f0');
                        await replayQueuedActionLogs();
                    }
                }
            } catch (e) { console.error(`[Sync] Verification error:`, e); }
        });

        getIncomingRequest((_, peerId) => { if (lastValidStatePacket) sendWorldState(lastValidStatePacket, [peerId]); });

        globalRooms.torrent.onPeerJoin(async peerId => {
            globalKnownPeers.add(peerId);
            lastGlobalPeerAt = Date.now();
            markPeerNetworkEvent(peerId, 'global:peer_join');
            requestState(true, [peerId]);
            if (lastValidStatePacket) setTimeout(() => sendWorldState(lastValidStatePacket, [peerId]), 500);
            await announceCurrentShardToPeer(peerId);
        });
        globalRooms.torrent.onPeerLeave(peerId => {
            globalKnownPeers.delete(peerId);
            globalPeerHints.delete(peerId);
            markPeerNetworkEvent(peerId, 'global:peer_leave');
        });

        gameActions.requestState = requestState;
        gameActions.sendWorldState = sendWorldState;
        gameActions.sendStateRequest = sendStateRequest;

        getStateRequest((ph, peerId) => {
            for (const shadow of shadowPlayers.values()) {
                if (shadow.ph === ph) { sendStateOffer(shadow, [peerId]); break; }
            }
        });

        getStateOffer(async (shadow, peerId) => {
            if (!shadow || !shadow.ph || shadow.ph !== localPlayer.ph) return;
            const derivedLevel = xpToLevel(shadow.xp || 0);
            if (shadow.level !== derivedLevel) return;
            const offerer = players.get(peerId);
            if (!shadow.signature || !offerer?.publicKey) return;

            const xpCeiling = Math.floor(localPlayer.xp * 1.10) + 100;
            if (shadow.xp > xpCeiling) return;

            try {
                const { signature, ...sigData } = shadow;
                const pubKey = await importKey(offerer.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(presenceSignaturePayload(sigData)), signature, pubKey)) return;
            } catch { return; }

            log(`[System] Received state rescue offer from ${peerId.slice(0, 8)}!`, '#0f0');
            if (shadow.xp > localPlayer.xp) {
                // localPlayer.name is locally authoritative — never overwrite from a
                // peer-supplied shadow. The offerer cannot legitimately claim a name change.
                localPlayer.xp = shadow.xp;
                localPlayer.level = derivedLevel;
                localPlayer.gold = Math.max(localPlayer.gold, shadow.gold || 0);
                const myInv = new Set(localPlayer.inventory);
                (shadow.inventory || []).forEach(i => myInv.add(i));
                localPlayer.inventory = Array.from(myInv);
                // Validate incoming quests: only accept known IDs where prerequisites are already met
                Object.entries(shadow.quests || {}).forEach(([qid, pq]) => {
                    if (!QUESTS[qid]) return;
                    const q = QUESTS[qid];
                    const prereqs = Array.isArray(q.prerequisite) ? q.prerequisite : (q.prerequisite ? [q.prerequisite] : []);
                    const prereqsMet = prereqs.every(pid => localPlayer.quests[pid]?.completed || shadow.quests?.[pid]?.completed);
                    if (!prereqsMet && pq.completed) return;
                    if (!localPlayer.quests[qid] || pq.progress > (localPlayer.quests[qid].progress || 0)) {
                        localPlayer.quests[qid] = pq;
                    }
                });
                log(`[System] State merged successfully. Welcome back, ${localPlayer.name}!`, '#0f0');
                saveLocalState(localPlayer, true);
            }
        });
    };

    await connectGlobal(currentRtcConfig);

    // Silencing the global room was removed: it broke arbiter-bound rollup and
    // fraud submission. submitRollup/submitFraudProof are captured by closures
    // bound to the live globalRooms.torrent senders, so leaving the room dropped
    // every subsequent rollup/fraud-report into a dead closure. The savings
    // (one extra tracker WS per peer) is not worth giving up fraud detection.

    let zeroPeerDiagHintShown = false;
    setInterval(() => {
        const g = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
        const s = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        console.log(`[P2P] Global (${g}) | Shard (${s}) | Synced: ${hasSyncedWithArbiter}`);
        if (!zeroPeerDiagHintShown && g === 0 && s === 0 && Date.now() - joinTime > 15000) {
            zeroPeerDiagHintShown = true;
            console.log('[P2P] No WebRTC peers yet. Run window.__fenhollowNetDiag() for tracker/ICE diagnostics.');
        }
    }, 10000);

    await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
    setTimeout(async () => {
        // TURN is included in the initial ICE config, so this is a no-op in normal operation.
        // Kept as a safety net in case initNetworking is called with a STUN-only override.
        if (isUsingTurnFallback(currentRtcConfig)) return;
        const usableShardPeers = countUsableShardPeers(shardKnownPeers, players);
        // Also check Trystero's live peer count — onPeerJoin fires after data channel opens,
        // but getPeers() may show peers whose ICE is still connecting. Either is sufficient
        // to confirm a live network and skip the destructive connectGlobal call.
        if (usableShardPeers > 0 || globalKnownPeers.size > 0
            || roomPeerCount(globalRooms.torrent) > 0 || roomPeerCount(rooms.torrent) > 0) return;
        currentRtcConfig = { iceServers: ICE_SERVERS };
        markNetworkEvent('heal:start', { force: true, reason: 'startup_turn_fallback', globalPeers: 0, usableShardPeers: 0 });
        await connectGlobal(currentRtcConfig);
        await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
    }, NETWORK_STARTUP_TURN_FALLBACK_MS);

    // 8.95d: exponential backoff for reconnect attempts (1s → 2s → 4s → 30s cap)
    let _healAttempts = 0;
    const _healBackoffMs = () => Math.min(1000 * (2 ** _healAttempts), 30000);

        healNetworking = async ({ force = false, urgent = false } = {}) => {
            if (networkHealInFlight) return;
            const usableShardPeers = countUsableShardPeers(shardKnownPeers, players);
            const globalPeers = globalKnownPeers.size;
            const now = Date.now();
            const silentFor = now - Math.max(joinTime, lastShardPresenceAt);

            if (usableShardPeers > 0) { _healAttempts = 0; return; }
            if (!force && !urgent && !hasRecentShardPeerExpectation(now)) { _healAttempts = 0; return; }
            if (!force && !urgent && silentFor < NETWORK_STALL_MS) return;
            if (!force && !urgent && now - lastNetworkHealAt < _healBackoffMs()) return;
            // force: event-driven heal with cooldown guard
            if (force && !urgent && !shouldRunEventHeal(usableShardPeers, now - lastNetworkHealAt, NETWORK_HEAL_COOLDOWN_MS)) return;
            // urgent: last peer just dropped — bypass cooldown, but still rate-limit to once/3s
            if (urgent && now - lastNetworkHealAt < 3000) return;

            networkHealInFlight = true;
            lastNetworkHealAt = now;
            _healAttempts++;
            markNetworkEvent('heal:start', { force, urgent, usableShardPeers, globalPeers, attempt: _healAttempts });
        try {
            // Urgent heal = last shard peer just left. The global room is still alive.
            // Just re-announce presence in place; no room leave/rejoin needed.
            // Previously gated on !isUsingTurnFallback but ICE_SERVERS always includes TURN,
            // making that condition always false and sending every urgent heal through the
            // destructive leave+rejoin path, which caused the arbiter to see rapid peer cycles.
            if (urgent && rooms.torrent && globalRooms.torrent) {
                markNetworkEvent('heal:reuse_room');
            } else if (!urgent && (globalPeers > 0 || (globalRooms.torrent && now - lastGlobalPeerAt < NETWORK_STALL_MS))) {
                // Global room is alive — just rejoin the shard.
                if (!isUsingTurnFallback(currentRtcConfig)) currentRtcConfig = { iceServers: ICE_SERVERS };
                await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
            } else {
                // Global room appears dead — full reconnect.
                if (!isUsingTurnFallback(currentRtcConfig)) currentRtcConfig = { iceServers: ICE_SERVERS };
                await connectGlobal(currentRtcConfig);
                await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
            }
            // Re-announce presence immediately after reconnect rather than waiting for the
            // next heartbeat tick, so the remote peer can update _peerLastPresenceAt and not
            // evict us as stale during the reconnect window.
            if (playerKeys && gameActions.sendPresenceSingle) {
                const entry = await myEntry();
                if (entry) {
                    const pubKey = await exportKey(playerKeys.publicKey);
                    if (gameActions.sendIdentity) gameActions.sendIdentity({ publicKey: pubKey });
                    gameActions.sendPresenceSingle(entry);
                    markNetworkEvent('heal:presence_reannounced');
                }
            }
        } finally { networkHealInFlight = false; }
    };

    let lastPageHiddenAt = 0;
    let lastResumeReconnectAt = 0;
    let resumeReconnectInFlight = false;

    const shouldReconnectOnResume = (reason, now) => {
        if (reason === 'online' || reason === 'pageshow_bfcache') return true;
        const hiddenLongEnough = lastPageHiddenAt > 0
            && now - lastPageHiddenAt >= NETWORK_RESUME_RECONNECT_MIN_HIDDEN_MS;
        const transportLooksEmpty = roomPeerCount(globalRooms.torrent) === 0
            && roomPeerCount(rooms.torrent) === 0;
        const silentLongEnough = now - Math.max(joinTime, lastShardPresenceAt) >= NETWORK_STALL_MS;
        return hiddenLongEnough || (transportLooksEmpty && silentLongEnough);
    };

    const reconnectAfterResume = async (reason) => {
        const now = Date.now();
        if (resumeReconnectInFlight) return;
        if (now - lastResumeReconnectAt < NETWORK_RESUME_RECONNECT_COOLDOWN_MS) return;
        if (!shouldReconnectOnResume(reason, now)) return;

        resumeReconnectInFlight = true;
        lastResumeReconnectAt = now;
        _healAttempts = 0;
        lastNetworkHealAt = 0;
        markNetworkEvent('network:resume_reconnect', {
            reason,
            globalPeers: roomPeerCount(globalRooms.torrent),
            shardPeers: roomPeerCount(rooms.torrent),
        });
        try {
            await connectGlobal(currentRtcConfig);
            await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
            if (playerKeys && gameActions.sendPresenceSingle) {
                const entry = await myEntry();
                if (entry) {
                    const pubKey = await exportKey(playerKeys.publicKey);
                    if (gameActions.sendIdentity) gameActions.sendIdentity({ publicKey: pubKey });
                    gameActions.sendPresenceSingle(entry);
                }
            }
        } finally {
            resumeReconnectInFlight = false;
        }
    };

    const bindNetworkResumeLifecycle = () => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return null;
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                lastPageHiddenAt = Date.now();
                return;
            }
            reconnectAfterResume('visibility').catch(() => {});
        };
        const onPageShow = (event) => {
            const reason = event?.persisted ? 'pageshow_bfcache' : 'pageshow';
            reconnectAfterResume(reason).catch(() => {});
        };
        const onOnline = () => reconnectAfterResume('online').catch(() => {});
        const onFocus = () => reconnectAfterResume('focus').catch(() => {});
        // iOS Safari sometimes fires blur/focus instead of visibilitychange on app-switch.
        // Record blur so focus can correctly compute hiddenLongEnough.
        const onBlur = () => { if (lastPageHiddenAt === 0 || document.visibilityState !== 'hidden') lastPageHiddenAt = Date.now(); };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pageshow', onPageShow);
        window.addEventListener('online', onOnline);
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pageshow', onPageShow);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
        };
    };

    if (networkResumeCleanup) networkResumeCleanup();
    networkResumeCleanup = bindNetworkResumeLifecycle();

    setInterval(() => { healNetworking().catch(() => {}); }, 10000);

    setInterval(async () => {
        if (!isProposer()) return;
        const leafData = buildLeafData();
        const { createMerkleRoot } = await import('../security/crypto.js');
        const root = await createMerkleRoot(leafData);
        if (!root) return;
        const rollup = { shard: getShardName(localPlayer.location, getCurrentInstance()), root, timestamp: Date.now(), count: leafData.length, proposerEpoch: Math.floor(Date.now() / ROLLUP_INTERVAL) };
        const signature = await signMessage(stableStringify(rollup), playerKeys.privateKey);
        const data = { rollup, signature, publicKey: await exportKey(playerKeys.publicKey) };
        gameActions.submitRollup(data);
        gameActions.sendRollupLocal(data);
    }, ROLLUP_INTERVAL);

    const scheduleNextSketch = (attempt = 0) => {
        let delay = [200, 1000, 4000, 16000][attempt] || (30000 + (players.size * 5000));
        setTimeout(() => {
            if (gameActions.sendSketch) gameActions.sendSketch(buildSketch().serialize());
            if (_presenceDelta.joined.size > 0 || _presenceDelta.left.size > 0) {
                if (gameActions.sendPresenceDelta) gameActions.sendPresenceDelta({ joined: Array.from(_presenceDelta.joined), left: Array.from(_presenceDelta.left) });
                clearPresenceDelta();
            }
            scheduleNextSketch(attempt + 1);
        }, delay);
    };
    scheduleNextSketch();
};

let _shardTeardown = null;

export const joinInstance = async (location, instanceId, rtcConfig) => {
    const incomingShard = getShardName(location, instanceId);
    const activeShard = rooms.torrent ? getShardName(localPlayer.location, getCurrentInstance()) : null;
    const isSameShard = activeShard === incomingShard;

    // Save introducers and tear down overlay timers before leaving the old shard.
    if (rooms.torrent) {
        saveIntroducers(activeShard);
        if (_shardTeardown) { _shardTeardown(); _shardTeardown = null; }
        rooms.torrent.leave();
    }
    shardKnownPeers.clear();
    _peerLastPresenceAt.clear();
    // Preserve the players map when rejoining the same shard (heal / ICE escalation).
    // Only wipe it on actual room transitions so peer sprites survive reconnects.
    if (isSameShard) {
        clearShardChannels(location);
        // Drop join-time records for peers no longer in the preserved players map
        // so router election (refreshRouters) doesn't keep promoting stale ids.
        for (const id of peerJoinTimes.keys()) {
            if (!players.has(id)) peerJoinTimes.delete(id);
        }
    } else {
        clearShardState(location);
        peerJoinTimes.clear();
        // Different shard means different peer set — drop HLC monotonicity records
        // since they were keyed to peers we will no longer interact with.
        clearSecurityState();
    }
    // Same-shard rejoin preserves peerHlc to keep replay defense intact during heal.
    pendingCommits.clear();
    feedHeads.clear();
    joinTime = Date.now();
    lastShardPresenceAt = joinTime;
    setCurrentInstance(instanceId);

    const shard = getShardName(location, instanceId);
    markNetworkEvent('shard:join_start', { shard, location, instanceId });
    console.log(`[P2P] Joining Shard Room: ${shard}`);
    recordShardPeerHints(0);
    const config = rtcConfig || currentRtcConfig;

    if (globalRooms.torrent && gameActions.sendSeekingShard) gameActions.sendSeekingShard(shard);

    fetchArbiterPeerSnapshot(shard);
    const snapshotRefreshTimers = SHARD_SNAPSHOT_REFRESH_DELAYS_MS
        .map(delay => setTimeout(() => { fetchArbiterPeerSnapshot(shard); }, delay));

    const preJoined = getPreJoined(shard);
    if (preJoined) {
        rooms.torrent = preJoined.room;
        markNetworkEvent('shard:prejoin_promoted', { shard });
        netLog(`[Pre-join] Promoted pre-joined room for ${shard}`);
    } else {
        rooms.torrent = joinTorrent(buildFastRoomConfig(config), shard);
    }

    markNetworkEvent('shard:room_ready', { shard });
    const buildRegistrationEntry = async (targetShard) => {
        if (!playerKeys) return null;
        const entry = await myEntry();
        if (!entry) return null;
        return {
            ...entry,
            id: selfId,
            publicKey: await exportKey(playerKeys.publicKey),
            shard: targetShard,
        };
    };

    let shardApi = null;
    const registerWithArbiter = async (attempt = 0) => {
        if (!playerKeys) { if (attempt < 10) setTimeout(() => registerWithArbiter(attempt + 1), 500); return; }
        const registration = await buildRegistrationEntry(shard);
        if (!registration) return;
        if (gameActions.sendRegisterPresence && globalRooms.torrent) gameActions.sendRegisterPresence(registration);
        // registerWithHints returns peer hints synchronously in the HTTP response,
        // bypassing a full tracker announce cycle for the warm path.
        const hintedPeers = await registerWithHints(shard, registration);
        recordShardPeerHints(hintedPeers.length);
        if (hintedPeers.length > 0 && shardApi?.seedIntroducers) {
            shardApi.seedIntroducers(hintedPeers.map(p => p.id || p.ph).filter(Boolean));
            markNetworkEvent('shard:arbiter_hints', { count: hintedPeers.length, source: 'register' });
        }
    };

    const SHARD_REBALANCE_CAP = 80;

    const checkFull = async () => {
        const peerCount = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        if (peerCount >= INSTANCE_CAP && instanceId < 10) {
            log(`[System] Instance ${instanceId} is full, moving to ${instanceId + 1}...`, '#aaa');
            setCurrentInstance(instanceId + 1);
            await joinInstance(location, getCurrentInstance(), rtcConfig);
        } else if (peerCount >= SHARD_REBALANCE_CAP && instanceId < 10) {
            // 8.95f: suggest migration to least-populated adjacent instance — no forced eviction
            const targetInstance = instanceId + 1;
            const targetShard = getShardName(location, targetInstance);
            if (gameActions.sendSeekingShard) {
                gameActions.sendSeekingShard({ shard: targetShard, migrate: true });
                netLog(`[Rebalance] Shard at ${peerCount} peers — suggesting migrate to ${targetShard}`, '#fa0');
            }
        }
    };
    setTimeout(checkFull, 5000);

    const setupShard = (r) => {
        const [sendMove, getMove] = r.makeAction('move');
        const [sendMonsterDmg, getMonsterDmg] = r.makeAction('monster_damage');
        const [sendPresenceSingle, getPresenceSingle] = r.makeAction('presence_single');
        const [sendPresenceBatch, getPresenceBatch] = r.makeAction('presence_batch');
        const [sendRelay, getRelay] = r.makeAction('world_state_relay');
        const [sendRollupLocal, getRollupLocal] = r.makeAction('rollup_local');
        const [sendDuelChallenge, getDuelChallenge] = r.makeAction('duel_challenge');
        const [sendDuelAccept, getDuelAccept] = r.makeAction('duel_accept');
        const [sendDuelCommit, getDuelCommit] = r.makeAction('duel_commit');
        const [sendActionLog, getActionLog] = r.makeAction('action_log');
        const [sendTradeOffer, getTradeOffer] = r.makeAction('trade_offer');
        const [sendTradeAccept, getTradeAccept] = r.makeAction('trade_accept');
        const [sendTradeCommit, getTradeCommit] = r.makeAction('trade_commit');
        const [sendTradeFinal, getTradeFinal] = r.makeAction('trade_finalized');
        const [sendSketch, getSketch] = r.makeAction('presence_sketch');
        const [sendRequest, getRequest] = r.makeAction('request_presence');
        const [sendIdentity, getIdentity] = r.makeAction('identity_handshake');
        const [sendPresenceDelta, getPresenceDelta] = r.makeAction('presence_delta');
        const [sendAnnounce, getAnnounce] = r.makeAction('presence_announce');
        const [sendCommit, getCommit] = r.makeAction('commit_action');
        const [sendReveal, getReveal] = r.makeAction('reveal_action');
        const [sendShuffle, getShuffle] = r.makeAction('hpv_shuffle');
        const [sendLazyPull, getLazyPull] = r.makeAction('lazy_pull');
        const [sendLazyPush, getLazyPush] = r.makeAction('lazy_push');

        const hpv = new HyParView();

        // Bounded message cache for Plumtree lazy-pull responses (60s TTL, 512 cap).
        const MSG_CACHE_CAP = 512;
        const _msgCache = new Map();
        const _cacheMsg = (msgId, type, buf, originPeerId = null) => {
            if (_msgCache.size >= MSG_CACHE_CAP) _msgCache.delete(_msgCache.keys().next().value);
            _msgCache.set(msgId, { type, buf, ts: Date.now(), originPeerId });
        };

        const _pendingPresence = new Map();
        const evictShardPeer = (peerId, { dropFromShard = false, emitLeave = false } = {}) => {
            if (!peerId) return;
            if (dropFromShard) shardKnownPeers.delete(peerId);
            if (emitLeave) bus.emit('peer:leave', { peerId });
            peerJoinTimes.delete(peerId);
            evictPlayer(peerId);
            evictShadowPlayer(peerId);
            evictSecurityPeer(peerId);
            feedHeads.delete(peerId);
            pendingCommits.delete(peerId);
            _pendingPresence.delete(peerId);
            _peerLastPresenceAt.delete(peerId);
            _peerMsgCounts.delete(peerId);
            const c = activeChannels.get(peerId);
            if (c) { clearTimeout(c.timeoutId); activeChannels.delete(peerId); }
        };

        // Mark a peer's data as stale without removing them. Their sprite stays
        // rendered at their last-known position so the world doesn't appear to
        // teleport-empty during transient shard WebRTC drops. The ghost sweep
        // still hard-evicts at GHOST_TTL_MS if presence never resumes.
        const markPeerStale = (peerId) => {
            if (!peerId) return;
            const entry = players.get(peerId);
            if (!entry || entry.stale) return;
            trackPlayer(peerId, { ...entry, stale: true, staleSince: Date.now() });
        };

        // HyParView SHUFFLE (item 2) — periodic passive-view exchange keeps the
        // overlay self-healing under churn without manual re-discovery.
        getIdentity(({ publicKey }, peerId) => {
            if (!publicKey || peerId === selfId) return;
            // Refuse identity packets from peerIds Trystero no longer attributes to the room.
            // Without this, a stale handshake delivered after the peer disconnected would
            // re-add them and keep them counting toward usable-peer totals until the ghost
            // sweep fires up to GHOST_TTL_MS later.
            if (filterConnectedPeerIds(r, [peerId]).length === 0) return;
            shardKnownPeers.add(peerId);
            const ph = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
            trackPlayer(peerId, { publicKey, ph, ts: Date.now() });
            markPeerNetworkEvent(peerId, 'peer:identity_known');
            const pending = _pendingPresence.get(peerId);
            if (pending) { _pendingPresence.delete(peerId); processPresenceSingle(pending, peerId); }
        });

        getShuffle((peerIds, peerId) => {
            hpv.mergeShuffle(peerIds, selfId);
            const reply = hpv.shuffle();
            if (reply.length > 0 && shardKnownPeers.has(peerId)) sendShuffle(reply, [peerId]);
        });
        const shuffleTimer = setInterval(() => {
            const eager = connectedOnly(hpv.eagerPeers());
            if (eager.length === 0) return;
            const target = eager[Date.now() % eager.length | 0];
            const sample = hpv.shuffle();
            if (sample.length > 0) sendShuffle(sample, [target]);
        }, 30_000);

        // Router election (item 7) — top-8 peers by session uptime get priority
        // in the active view, forming a stable backbone for the shard.
        const refreshRouters = () => {
            const now = Date.now();
            const candidates = Array.from(peerJoinTimes.entries())
                .filter(([id]) => players.has(id) && !players.get(id).ghost)
                .map(([id, joined]) => ({ id, uptime: now - joined }))
                .sort((a, b) => b.uptime - a.uptime)
                .slice(0, 8);
            routerSet = new Set(candidates.map(c => c.id));
            for (const id of routerSet) hpv.prioritize(id);
            netLog(`[Routers] elected: ${routerSet.size}`, '#555');
        };
        const routerTimer = setInterval(refreshRouters, 60_000);

        // Ghost sweep: hard-evict peers silent for GHOST_TTL_MS (must be > STALE_MS).
        // Peers that reach this threshold were not caught by the stale sweep, which
        // implies _peerLastPresenceAt was never set (no presence received at all).
        const ghostTimer = setInterval(() => {
            const now = Date.now();
            let evictedAny = false;
            for (const [peerId, lastSeen] of _peerLastPresenceAt) {
                if (now - lastSeen <= GHOST_TTL_MS) continue;
                evictShardPeer(peerId, { dropFromShard: true, emitLeave: true });
                netLog(`Ghost-peer evicted: ${peerId}`, '#a00');
                evictedAny = true;
            }
            if (evictedAny && countUsableShardPeers(shardKnownPeers, players) === 0) {
                healNetworking({ urgent: true }).catch(() => {});
            }
        }, GHOST_TTL_MS);
        const stalePeerTimer = setInterval(() => {
            const now = Date.now();
            let staledAny = false;
            for (const [peerId, lastSeen] of _peerLastPresenceAt) {
                if (now - lastSeen <= NETWORK_PEER_STALE_MS) continue;
                const entry = players.get(peerId);
                if (!entry || entry.stale) continue;
                markPeerNetworkEvent(peerId, 'peer:stale_timeout', { sinceMs: now - lastSeen });
                markPeerStale(peerId);
                staledAny = true;
            }
            // Heal the shard if we have no fresh peers left — same trigger as before,
            // but counted via the entry's stale flag rather than full eviction.
            if (staledAny && countUsableShardPeers(shardKnownPeers, players) === 0) {
                healNetworking({ urgent: true }).catch(() => {});
            }
        }, NETWORK_PEER_SWEEP_MS);

        getPresenceDelta(async ({ joined, left }, peerId) => {
            (left || []).forEach(id => { if (id !== selfId) evictPlayer(id); });
            const missing = (joined || []).filter(id => id !== selfId && !players.has(id));
            if (missing.length > 0) sendRequest(missing, [peerId]);
        });

        const localIds = () => [
            ...Array.from(players.keys()).filter(id => {
                const peer = players.get(id);
                return peer?.presenceVerifiedAt && !peer.ghost;
            }),
            selfId
        ];

        const processPresenceSingle = async (buf, peerId) => {
            if (!buf || peerId === selfId) return;
            if (!checkThrottle(peerId)) return;
            shardKnownPeers.add(peerId);
            const entry = players.get(peerId);
            if (!entry?.publicKey) { _pendingPresence.set(peerId, buf); return; }
            if (bans.has(entry.publicKey)) { evictPlayer(peerId); _pendingPresence.delete(peerId); return; }

            const unpacked = unpackPresencePacket(buf);
            if (!unpacked) return;
            const expectedPh = (hashStr(entry.publicKey) >>> 0).toString(16).padStart(8, '0');
            if (unpacked.ph !== expectedPh) return;

            try {
                const { signature, ...sigData } = unpacked;
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(presenceSignaturePayload(sigData)), signature, pubKey)) return;
            } catch (_e) { return; }

            if (unpacked.hlc && !checkAndUpdateHlc(peerId, unpacked.hlc)) return;
            if (unpacked.level !== xpToLevel(unpacked.xp)) return;
            const shadow = shadowPlayers.get(peerId);
            if (!checkXpRate(peerId, unpacked.xp, shadow?.xp || 0)) return;
            if (shadow && unpacked.level > shadow.level + 1) return;

            const verifiedAt = Date.now();
            _peerLastPresenceAt.set(peerId, verifiedAt);
            // Strip stale flag — fresh presence means they're back.
            const { stale: _stale, staleSince: _staleSince, ...prior } = entry;
            // rawPresence is the peer's signed buffer; we forward it verbatim during
            // sketch reconciliation since we cannot sign on their behalf. The HLC check
            // above guarantees we only overwrite it with a strictly newer signed packet,
            // so old captures cannot be re-introduced through this path.
            trackPlayer(peerId, { ...prior, ...unpacked, ts: verifiedAt, rawPresence: buf, presenceVerifiedAt: verifiedAt });
            trackShadowPlayer(peerId, unpacked);
            lastShardPresenceAt = verifiedAt;
            markIntroSuccess(peerId);
            markPeerNetworkEvent(peerId, 'peer:presence_verified', { location: unpacked.location, x: unpacked.x, y: unpacked.y });
            players.delete('ghost:' + unpacked.ph);
        };

        const connectedOnly = (ids) => filterConnectedPeerIds(r, ids);

        // Plumtree generic broadcast: eager peers get the full payload immediately;
        // lazy peers receive only a { msgId, type } announcement and pull on cache miss.
        const TYPE_SENDERS = {
            presence:   (buf, t) => t ? sendPresenceSingle(buf, t) : sendPresenceSingle(buf),
            move:       (buf, t) => t ? sendMove(buf, t)           : sendMove(buf),
            action_log: (buf, t) => t ? sendActionLog(buf, t)      : sendActionLog(buf),
        };
        const plumBroadcast = (type, buf) => {
            const sendFn = TYPE_SENDERS[type];
            if (!sendFn) return;
            const msgId = HyParView.msgId(hashStr, buf);
            if (!hpv.markSeen(msgId)) return;
            _cacheMsg(msgId, type, buf, selfId);
            const eager = connectedOnly(hpv.eagerPeers());
            const lazy  = connectedOnly(hpv.lazyPeers());
            if (eager.length > 0) sendFn(buf, eager); else sendFn(buf);
            if (lazy.length  > 0) sendAnnounce({ msgId, type }, lazy);
        };
        const plumSend = (packed) => plumBroadcast('presence', packed);

        const broadcastWhenReady = async (attempt = 0) => {
            if (!playerKeys) { if (attempt < 50) setTimeout(() => broadcastWhenReady(attempt + 1), 200); return; }
            const entry = await myEntry();
            if (entry) {
                const pubKey = await exportKey(playerKeys.publicKey);
                markNetworkEvent('shard:broadcast_initial_presence');
                sendIdentity({ publicKey: pubKey });
                plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
            }
        };
        broadcastWhenReady();
        const heartbeatTimer = setInterval(async () => {
            if (!playerKeys || shardKnownPeers.size === 0) return;
            const entry = await myEntry();
            if (!entry) return;
            plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
        }, NETWORK_PRESENCE_HEARTBEAT_MS);

        getAnnounce(async ({ msgId, type }, peerId) => {
            if (hpv.hasSeen(msgId)) return;
            hpv.promote(peerId);
            if (!type || type === 'presence') {
                sendRequest([peerId], [peerId]);
            } else {
                sendLazyPull(msgId, [peerId]);
            }
        });

        getLazyPull((msgId, peerId) => {
            const cached = _msgCache.get(msgId);
            if (!cached) return;
            sendLazyPush({ msgId, type: cached.type, data: Array.from(cached.buf), originPeerId: cached.originPeerId }, [peerId]);
        });

        // Reject sketch/request work originating from peers whose key we have banned.
        // Decoding a sketch is bounded but non-trivial; a banned peer must not be able
        // to keep triggering Minisketch.decode + Ed25519 verifies on every honest peer.
        const isBannedPeer = (peerId) => {
            const pub = players.get(peerId)?.publicKey;
            return pub ? bans.has(pub) : false;
        };

        getSketch(async (remoteArr, peerId) => {
            if (isBannedPeer(peerId)) return;
            const localMs = buildSketch();
            const remoteMs = Minisketch.fromSerialized(remoteArr);
            const { added, removed, failure } = Minisketch.decode(localMs, remoteMs);
            if (failure) { sendRequest(localIds().map(String), [peerId]); return; }
            if (added.length > 32 || removed.length > 32) return;
            if (removed.length > 0) {
                const response = {};
                for (const id of localIds()) {
                    const h = Minisketch.hashId(id);
                    if (!removed.some(r => r === h)) continue;
                    if (id === selfId) continue;
                    const data = players.get(id);
                    if (data?.rawPresence) response[id] = { presence: data.rawPresence, publicKey: data.publicKey };
                }
                if (removed.some(r => r === Minisketch.hashId(selfId))) {
                    const entry = await myEntry();
                    if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
                }
                if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
            }
            if (added.length > 0) sendRequest(added.map(String), [peerId]);
        });

        getRequest(async (idStrings, peerId) => {
            if (isBannedPeer(peerId)) return;
            const response = {};
            const myIdHash = Minisketch.hashId(selfId);
            const matchesSelf = idStrings.some(s => s === selfId || s === String(myIdHash));
            for (const [id, data] of players.entries()) {
                if (data.ghost) continue;
                const idHash = Minisketch.hashId(id);
                const matches = idStrings.some(s => s === id || s === String(idHash));
                if (matches && data.rawPresence) response[id] = { presence: data.rawPresence, publicKey: data.publicKey };
            }
            if (matchesSelf) {
                const entry = await myEntry();
                if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
            }
            if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
        });

        getPresenceSingle(async (buf, peerId) => {
            if (peerId === selfId) return;
            if (isBannedPeer(peerId)) return;
            const msgId = HyParView.msgId(hashStr, buf);
            if (!hpv.markSeen(msgId)) { hpv.prune(peerId); return; }
            await processPresenceSingle(buf, peerId);
        });

        getPresenceBatch(async (data, peerId) => {
            if (isBannedPeer(peerId)) return;
            const batch = unpackPresenceBatch(data);
            for (const [id, { presence, publicKey }] of Object.entries(batch)) {
                if (id === selfId || !publicKey || bans.has(publicKey)) continue;
                try {
                    const entry = players.get(id) || {};
                    if (!entry.publicKey) {
                        const ph = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
                        trackPlayer(id, { ...entry, publicKey, ph, ts: Date.now() });
                    }
                    await processPresenceSingle(presence, id);
                    hpv.onJoin(id); 
                } catch (e) { console.error(`[Net] Batch error:`, e); }
            }
        });

        getCommit(({ seq, commit }, peerId) => {
            if (!pendingCommits.has(peerId)) pendingCommits.set(peerId, new Map());
            pendingCommits.get(peerId).set(seq, { commit, ts: Date.now() });
        });

        getReveal(async ({ seq, type, target, nonce }, peerId) => {
            const entry = players.get(peerId);
            const commits = pendingCommits.get(peerId);
            const pending = commits?.get(seq);
            if (!entry?.publicKey || !pending) return;
            commits.delete(seq);
            if (pending.commit !== (hashStr(`${type}|${target}|${nonce}`) >>> 0).toString(16).padStart(8, '0')) return;

            const head = feedHeads.get(peerId);
            const prevHash = head ? (hashStr(`${head.seq}:${head.hash}`) >>> 0).toString(16).padStart(8, '0') : '00000000';
            if (seq !== (head ? head.seq + 1 : 1)) return;
            feedHeads.set(peerId, { seq, hash: (hashStr(`${seq}:${type}:${target}:${prevHash}`) >>> 0).toString(16).padStart(8, '0') });
        });

        getRollupLocal(() => { lastRollupReceivedAt = Date.now(); });

        getRelay(async (data) => {
            const { state, signature } = data;
            if (await verifyMessage(typeof state === 'string' ? state : stableStringify(state), signature, arbiterPublicKey)) updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
        });

        getActionLog(async (buf, peerId) => {
            const msgId = HyParView.msgId(hashStr, buf);
            if (!hpv.markSeen(msgId)) { hpv.prune(peerId); return; }
            const eager = connectedOnly(hpv.eagerPeers()).filter(id => id !== peerId);
            const lazy  = connectedOnly(hpv.lazyPeers()).filter(id => id !== peerId);
            if (eager.length > 0) sendActionLog(buf, eager);
            if (lazy.length  > 0) sendAnnounce({ msgId, type: 'action_log' }, lazy);
            _cacheMsg(msgId, 'action_log', buf, peerId);
            await dispatchActionLog(buf, peerId);
        });

        getTradeOffer((data, peerId) => bus.emit('trade:offer-received', { partnerId: peerId, partnerName: data.fromName, offer: data.offer }));
        getTradeAccept((data, peerId) => bus.emit('trade:accept-received', { partnerId: peerId, offer: data.offer }));
        getTradeCommit(async (buf, peerId) => bus.emit('trade:commit-received', { partnerId: peerId, commit: unpackTradeCommit(buf) }));
        getTradeFinal((data) => {
            [data.peerA, data.peerB].forEach(id => {
                const s = shadowPlayers.get(id); if (!s) return;
                const d = data.delta[id]; s.gold += (d.gets_gold || 0) - (d.gives_gold || 0);
                if (d.gives_items) s.inventory = s.inventory.filter(i => !d.gives_items.includes(i));
                if (d.gets_items) s.inventory.push(...d.gets_items);
            });
        });

        getDuelChallenge((data, peerId) => { if (data.target === selfId) setPendingDuel({ challengerId: peerId, challengerName: data.fromName, expiresAt: Date.now() + 60000, day: worldState.day }); bus.emit('duel:incoming', { challengerId: peerId, challengerName: data.fromName }); });
        getDuelAccept(async (data, peerId) => { if (data.target === selfId) bus.emit('duel:start', { targetId: peerId, targetName: data.fromName, day: worldState.day }); });
        getDuelCommit(async (buf, peerId) => {
            const chan = activeChannels.get(peerId); if (!chan) return;
            const { commit, signature } = unpackDuelCommit(buf);
            const opponentPubKey = await importKey(players.get(peerId)?.publicKey, 'public');
            if (await verifyMessage(JSON.stringify(commit), signature, opponentPubKey)) { chan.theirHistory.push(commit); bus.emit('duel:commit-received', { targetId: peerId }); }
        });

        // Extracted move processor — called by getMove and getLazyPush.
        const dispatchMove = async (buf, peerId) => {
            const data = unpackMove(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            try {
                const movePayload = { from: data.from, to: data.to, x: data.x, y: data.y, hlc: data.hlc };
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(movePayload), data.signature, pubKey)) return;
                // Reject replays — peerHlc tracks per-peer monotonicity so old signed bytes
                // can't be re-injected after the seen-msg cache evicts them. Check runs after
                // verification so a junk-signature message can't pre-bump the HLC ceiling.
                if (data.hlc && !checkAndUpdateHlc(peerId, data.hlc)) return;
                if (data.from !== data.to) {
                    const validExits = Object.values(worldGraph[data.from]?.exits || {});
                    if (!validExits.includes(data.to)) {
                        gameActions.submitFraudProof({
                            type: 'illegal_move',
                            proof: { move: movePayload, signature: data.signature, publicKey: entry.publicKey },
                            witness: {}
                        });
                        return;
                    }
                }
                if (data.from === data.to && entry.x !== undefined && (Math.abs(data.x - entry.x) + Math.abs(data.y - entry.y)) > 1) return;
                trackPlayer(peerId, { ...entry, location: data.to, x: data.x, y: data.y, ts: Date.now() });
                bus.emit('peer:move', { peerId, data });
            } catch (_e) { /* ignore */ }
        };

        // Extracted action-log processor — called by getActionLog and getLazyPush.
        const dispatchActionLog = async (buf, peerId) => {
            const data = unpackActionLog(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            if (isHardStateFrozen()) {
                hardStateQueue.push({ peerId, publicKey: entry.publicKey, data, ts: Date.now() });
                return;
            }
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify({ type: data.type, index: data.index, target: data.target, data: data.data }), data.signature, pubKey)) return;
                applyActionLogToShadow(peerId, data);
            } catch (e) { console.error('[Security] ActionLog fail:', e); }
        };

        // Deliver a lazy-pushed payload: verify not seen, forward onward, process locally.
        getLazyPush(async ({ msgId, type, data, originPeerId }, peerId) => {
            if (hpv.hasSeen(msgId)) return;
            hpv.markSeen(msgId);
            // Trystero may deliver `data` as a Uint8Array, a plain Array (from
            // Array.from at the sender), or a numeric-keyed object (msgpack-via-JSON).
            // Mirror the same normalizer used by presence_bootstrap.
            const buf = data instanceof Uint8Array ? data
                : new Uint8Array(Array.isArray(data) ? data : Object.values(data || {}));
            const origin = originPeerId || peerId;
            const eager = connectedOnly(hpv.eagerPeers()).filter(id => id !== peerId);
            const lazy  = connectedOnly(hpv.lazyPeers()).filter(id => id !== peerId);
            _cacheMsg(msgId, type, buf, origin);
            if (type === 'move') {
                if (eager.length > 0) sendMove(buf, eager);
                if (lazy.length  > 0) sendAnnounce({ msgId, type }, lazy);
                await dispatchMove(buf, origin);
            } else if (type === 'action_log') {
                if (eager.length > 0) sendActionLog(buf, eager);
                if (lazy.length  > 0) sendAnnounce({ msgId, type }, lazy);
                await dispatchActionLog(buf, origin);
            }
        });

        getMove(async (buf, peerId) => {
            if (!checkThrottle(peerId)) return;
            const msgId = HyParView.msgId(hashStr, buf);
            if (!hpv.markSeen(msgId)) { hpv.prune(peerId); return; }
            const eager = connectedOnly(hpv.eagerPeers()).filter(id => id !== peerId);
            const lazy  = connectedOnly(hpv.lazyPeers()).filter(id => id !== peerId);
            if (eager.length > 0) sendMove(buf, eager);
            if (lazy.length  > 0) sendAnnounce({ msgId, type: 'move' }, lazy);
            _cacheMsg(msgId, 'move', buf, peerId);
            await dispatchMove(buf, peerId);
        });

        getMonsterDmg((data, peerId) => {
            if (!checkThrottle(peerId)) return;
            const msgId = HyParView.msgId(hashStr, data);
            if (!hpv.markSeen(msgId)) return;
            const eager = connectedOnly(hpv.eagerPeers()).filter(id => id !== peerId);
            if (eager.length > 0) sendMonsterDmg(data, eager);
            const s = shardEnemies.get(data.roomId);
            if (s) { s.hp = Math.max(0, s.hp - data.damage); s.lastUpdate = Date.now(); bus.emit('monster:damaged', { roomId: data.roomId, damage: data.damage }); }
        });

        // Expose shard-scoped presence decoder to the global presence_bootstrap path.
        // Without this, same-shard peers learned via the global room only get publicKey+ph
        // and never their location/x/y, so they're invisible in the world view until the
        // shard room's own presence_single arrives (which may be slow with small rooms).
        gameActions.processPresence = processPresenceSingle;
        // seedAsActive (not mergeShuffle) so introducer hints get the first broadcast
        // directly — saves a lazy-pull round trip on cold paths.
        gameActions.seedShardIntroducers = (peerIds) => hpv.seedAsActive(peerIds, selfId);

        r.onPeerJoin(async peerId => {
            shardKnownPeers.add(peerId);
            markPeerNetworkEvent(peerId, 'shard:peer_join');
            if (!peerJoinTimes.has(peerId)) peerJoinTimes.set(peerId, Date.now());
            hpv.onJoin(peerId);
            try { sendSketch(buildSketch().serialize(), [peerId]); } catch (_e) { /* ignore */ }
            const handshake = async (attempt = 0) => {
                if (!shardKnownPeers.has(peerId) || !playerKeys || attempt >= 5) return;
                try {
                    markPeerNetworkEvent(peerId, 'peer:identity_sent');
                    sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) }, [peerId]);
                    const e = await myEntry(); if (e) sendPresenceSingle(await packSignedPresence({ ...e, hlc: sendHLC() }), [peerId]);
                    markPeerNetworkEvent(peerId, 'peer:presence_sent');
                } catch (_e2) { /* ignore */ }
                if (!players.get(peerId)?.publicKey) setTimeout(() => handshake(attempt + 1), 3000);
            };
            setTimeout(handshake, 100);
            setTimeout(async () => {
                if (!shardKnownPeers.has(peerId)) return;
                if (players.get(peerId)?.presenceVerifiedAt) return;
                markPeerNetworkEvent(peerId, 'peer:handshake_timeout');
                markIntroFailed(peerId);
                // Re-send identity to the stuck peer rather than rejoining the shard room.
                // Rejoining causes the remote side to see a leave event, which triggers
                // their heal — cascading into a storm. Identity re-send unblocks the
                // pending presence queue on the remote side without disrupting the room.
                try {
                    if (playerKeys && gameActions.sendIdentity) {
                        const pubKey = await exportKey(playerKeys.publicKey);
                        gameActions.sendIdentity({ publicKey: pubKey }, [peerId]);
                    }
                } catch (_e3) { /* ignore */ }
            }, NETWORK_HANDSHAKE_TIMEOUT_MS);
        });

        r.onPeerLeave(peerId => {
            markPeerNetworkEvent(peerId, 'shard:peer_leave');
            shardKnownPeers.delete(peerId);
            hpv.onLeave(peerId);
            evictShardPeer(peerId, { emitLeave: true });
            if (countUsableShardPeers(shardKnownPeers, players) === 0) {
                // Last usable peer just left — bypass cooldown via urgent.
                scheduleHeal(NETWORK_EVENT_HEAL_DELAY_MS, { force: true, urgent: true });
            }
        });

        const msgCacheTimer = setInterval(() => {
            const cutoff = Date.now() - 60000;
            for (const [k, v] of _msgCache) { if (v.ts < cutoff) _msgCache.delete(k); }
        }, 15000);

        return {
            sendMove, sendMonsterDmg, sendPresenceSingle, sendPresenceBatch,
            sendRelay, sendRollupLocal, sendSketch, sendRequest,
            sendDuelChallenge, sendDuelAccept, sendDuelCommit,
            sendActionLog, sendTradeOffer, sendTradeAccept, sendTradeCommit, sendTradeFinal,
            sendCommit, sendReveal, plumSend, plumBroadcast, sendPresenceDelta, sendIdentity,
            processPresenceSingle,
            seedIntroducers: (peerIds) => hpv.seedAsActive(peerIds, selfId),
            teardown: () => {
                clearInterval(shuffleTimer);
                clearInterval(routerTimer);
                clearInterval(ghostTimer);
                clearInterval(stalePeerTimer);
                clearInterval(heartbeatTimer);
                clearInterval(msgCacheTimer);
                if (scheduledHealTimer) { clearTimeout(scheduledHealTimer); scheduledHealTimer = null; }
            },
        };
    };

    const r = setupShard(rooms.torrent);
    shardApi = r;
    const registerStartTimer = setTimeout(registerWithArbiter, 1000);
    // Refresh the arbiter's /peers directory so warm hints stay current for
    // late joiners. Hints only — actual signaling stays on Trystero torrent.
    const registerHeartbeatTimer = setInterval(registerWithArbiter, 30000);
    _shardTeardown = () => {
        clearTimeout(registerStartTimer);
        clearInterval(registerHeartbeatTimer);
        snapshotRefreshTimers.forEach(clearTimeout);
        r.teardown();
    };

    // Seed HyParView passive view with cached introducers so they get priority
    // when tracker discovery re-connects us to them.
    const cachedIntroducers = loadIntroducers(shard);
    if (cachedIntroducers.length > 0) {
        r.seedIntroducers(cachedIntroducers);
        netLog(`[Introducers] ${cachedIntroducers.length} cached peers loaded for shard`, '#555');
    }

    // BroadcastChannel probe: ask other same-origin tabs if they're in this shard.
    // Zero-latency for same-device discovery; falls through silently if no tab responds.
    if (supportsChannelEvents(TAB_CHANNEL) && TAB_CHANNEL.postMessage) {
        TAB_CHANNEL.postMessage({ type: 'shard:probe', shard, selfId });
        const _bcProbeHandler = (/** @type {MessageEvent} */ e) => {
            if (e.data?.type !== 'shard:peers' || e.data?.shard !== shard) return;
            const peers = e.data.peers;
            if (Array.isArray(peers) && peers.length > 0 && r.seedIntroducers) {
                r.seedIntroducers(peers);
                markNetworkEvent('shard:broadcast_channel_peers', { count: peers.length });
            }
        };
        addChannelListener(TAB_CHANNEL, _bcProbeHandler);
        setTimeout(() => removeChannelListener(TAB_CHANNEL, _bcProbeHandler), 2000);
    }

    setTimeout(async () => {
        const entry = await myEntry();
        if (entry && playerKeys && localPlayer.ph && localPlayer.ph !== '00000000') {
            r.sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) });
            r.plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
        }
    }, 800);

    const shardActions = buildShardActions(r);
    Object.assign(gameActions, shardActions);
    return shardActions;
};
