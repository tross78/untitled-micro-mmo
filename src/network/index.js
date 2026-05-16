// @ts-check
import { joinRoom as joinTorrent, selfId } from './transport.js';
import { getShardName, hashStr, seededRNG, xpToLevel, rollLoot } from '../rules/index.js';
import { STUN_SERVERS, TURN_SERVERS, ARBITER_URL } from '../infra/constants.js';
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
    packPresence, unpackDuelCommit,
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
    buildTorrentConfig, isUsingTurnFallback 
} from './config.js';
import { 
    checkXpRate, checkAndUpdateHlc, buildLeafData, clearSecurityState, evictSecurityPeer 
} from './security.js';
import { 
    buildSketch, packSignedPresence, unpackPresencePacket, seedFromSnapshot 
} from './presence.js';
import { updateSimulation, initOfflineDayTick } from './simulation.js';
import {
    getCurrentInstance, setCurrentInstance, preJoinShard, getPreJoined, clearShardState
} from './shard.js';
import { buildShardActions } from './actions.js';
import { filterConnectedPeerIds } from './peer-filter.js';
import { countUsableShardPeers, shouldRunEventHeal } from './heal.js';

export { seedFromSnapshot, updateSimulation, initOfflineDayTick, preJoinShard, buildTorrentConfig, isProposer };

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
export let lastRollupReceivedAt = 0;
export let lastValidStatePacket = null;
export let currentRtcConfig = { iceServers: STUN_SERVERS };
export let joinTime = Date.now();
let lastPeerSeenAt = Date.now();
let lastShardPresenceAt = Date.now();
let lastNetworkHealAt = 0;
let networkHealInFlight = false;
let scheduledHealTimer = null;
let healNetworking = async (_opts = {}) => {};
const scheduleHeal = (delay = NETWORK_EVENT_HEAL_DELAY_MS, options = {}) => {
    const { force = false } = options;
    if (scheduledHealTimer) clearTimeout(scheduledHealTimer);
    scheduledHealTimer = setTimeout(() => {
        scheduledHealTimer = null;
        healNetworking({ force }).catch(() => {});
    }, delay);
};

const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);

// --- Introducer cache (item 5) -------------------------------------------
// Persists up to 5 peer IDs per shard so rejoining players can seed HyParView
// with known-good introducers before tracker discovery completes.
const INTRODUCER_CACHE_KEY = `${GAME_NAME}_introducers_v1`;
const INTRODUCER_TTL_MS = 8 * 3600_000; // 8 hours

const saveIntroducers = (shard) => {
    const directPeers = rooms.torrent?.getPeers?.() || {};
    const top = Object.keys(directPeers)
        .filter(id => players.has(id) && !players.get(id).ghost)
        .slice(0, 5);
    if (top.length === 0) return;
    try {
        const cache = JSON.parse(localStorage.getItem(INTRODUCER_CACHE_KEY) || '{}');
        cache[shard] = { peers: top, ts: Date.now() };
        localStorage.setItem(INTRODUCER_CACHE_KEY, JSON.stringify(cache));
    } catch (_) { /* ignore */ }
};

const loadIntroducers = (shard) => {
    try {
        const cache = JSON.parse(localStorage.getItem(INTRODUCER_CACHE_KEY) || '{}');
        const entry = cache[shard];
        if (!entry || Date.now() - entry.ts > INTRODUCER_TTL_MS) return [];
        return entry.peers || [];
    } catch (_) { return []; }
};

const applyActionLogToShadow = (peerId, data) => {
    let shadow = shadowPlayers.get(peerId) || { level: 1, xp: 0, inventory: [], gold: 0, actionIndex: -1 };
    if (data.index <= shadow.actionIndex) return;
    const entry = players.get(peerId);
    const rng = seededRNG(hashStr(worldState.seed + '|' + entry.publicKey + '|' + data.index));
    if (data.type === 'kill' && ENEMIES[data.target]) {
        shadow.xp += ENEMIES[data.target].xp;
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

// --- 8.95c: Ghost-peer TTL --------------------------------------------------
const GHOST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _peerLastPresenceAt = new Map(); // peerId -> timestamp
let routerSet = new Set();

// Per-peer commit-reveal and feed heads
const pendingCommits = new Map();
const feedHeads = new Map();

const isProposer = () => {
    const all = Array.from(players.keys()).filter(id => !players.get(id).ghost).concat(selfId).sort();
    if (all.length < 2) return false;

    const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
    if (all[slot] === selfId) return true;
    if (Date.now() - lastRollupReceivedAt > PROPOSER_GRACE_MS) {
        return all[(slot + 1) % all.length] === selfId;
    }
    return false;
};

export const initNetworking = async (rtcConfig) => {
    currentRtcConfig = rtcConfig || { iceServers: STUN_SERVERS };

    const connectGlobal = async (config) => {
        if (globalRooms.torrent) globalRooms.torrent.leave();
        globalKnownPeers.clear();
        globalRooms.torrent = joinTorrent(buildTorrentConfig(config), 'global');

        const [sendRollup] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.ROLLUP_SUBMIT);
        const [sendFraud] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.FRAUD_REPORT);
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction(NETWORK_ACTIONS.WORLD_STATE);
        const [sendStateRequest, getStateRequest] = globalRooms.torrent.makeAction('state_request');
        const [sendRegisterPresence] = globalRooms.torrent.makeAction('register_presence');
        gameActions.sendRegisterPresence = (data) => sendRegisterPresence(data);
        const [sendStateOffer, getStateOffer] = globalRooms.torrent.makeAction('state_offer');
        const [sendSeekingShard, getSeekingShard] = globalRooms.torrent.makeAction('seeking_shard');
        gameActions.sendSeekingShard = (shard) => sendSeekingShard(shard);
        const [sendPresenceBootstrap, getPresenceBootstrap] = globalRooms.torrent.makeAction('presence_bootstrap');

        getSeekingShard(async (payload, peerId) => {
            const shard = typeof payload === 'string' ? payload : payload?.shard;
            const migrate = typeof payload === 'object' && payload?.migrate;
            if (migrate) {
                // 8.95f: peer suggests we migrate to a less-populated shard instance
                bus.emit('shard:migrate', { shard });
                return;
            }
            const currentShard = getShardName(localPlayer.location, getCurrentInstance());
            if (shard === currentShard) {
                const entry = await myEntry();
                if (entry) {
                    const packed = await packSignedPresence({ ...entry, hlc: sendHLC() });
                    sendPresenceBootstrap({
                        presence: packed,
                        publicKey: await exportKey(playerKeys.publicKey)
                    }, [peerId]);
                }
            }
        });

        getPresenceBootstrap(async (packet, peerId) => {
            if (peerId === selfId) return;
            if (!packet?.presence || !packet?.publicKey || bans.has(packet.publicKey)) return;
            const entry = players.get(peerId) || {};
            const ph = (hashStr(packet.publicKey) >>> 0).toString(16).padStart(8, '0');
            trackPlayer(peerId, { ...entry, publicKey: packet.publicKey, ph, ts: Date.now() });
            if (gameActions.processPresence) {
                const buf = (packet.presence instanceof Uint8Array) ? packet.presence : packPresence(packet.presence);
                await gameActions.processPresence(buf, peerId);
            }
        });

        gameActions.submitRollup = (rollup) => sendRollup(rollup);
        gameActions.submitFraudProof = (proof) => sendFraud(proof);

        getState(async (data, _peerId) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
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

        globalRooms.torrent.onPeerJoin(peerId => {
            globalKnownPeers.add(peerId);
            lastPeerSeenAt = Date.now();
            requestState(true, [peerId]);
            if (lastValidStatePacket) setTimeout(() => sendWorldState(lastValidStatePacket, [peerId]), 500);
        });
        globalRooms.torrent.onPeerLeave(peerId => {
            globalKnownPeers.delete(peerId);
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
                if (shadow.name) localPlayer.name = shadow.name;
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

    let isSilenced = false;
    setInterval(async () => {
        const globalPeerCount = globalKnownPeers.size;
        const usableShardPeers = countUsableShardPeers(shardKnownPeers, players);
        if (!isSilenced && globalPeerCount >= 5 && usableShardPeers > 0) {
            globalRooms.torrent.leave();
            globalKnownPeers.clear();
            isSilenced = true;
        } else if (isSilenced && usableShardPeers === 0) {
            await connectGlobal(currentRtcConfig);
            isSilenced = false;
        }
    }, 30000);

    setInterval(() => {
        const g = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
        const s = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        console.log(`[P2P] Global (${g}) | Shard (${s}) | Synced: ${hasSyncedWithArbiter}`);
    }, 10000);

    await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);

    // 8.95d: exponential backoff for reconnect attempts (1s → 2s → 4s → 30s cap)
    let _healAttempts = 0;
    const _healBackoffMs = () => Math.min(1000 * (2 ** _healAttempts), 30000);

        healNetworking = async ({ force = false } = {}) => {
            if (networkHealInFlight) return;
            const usableShardPeers = countUsableShardPeers(shardKnownPeers, players);
            const globalPeers = globalKnownPeers.size;
            const now = Date.now();
            const silentFor = now - Math.max(joinTime, lastShardPresenceAt);

            if (usableShardPeers > 0) { _healAttempts = 0; return; }
            if (!force && silentFor < NETWORK_STALL_MS) return;
            if (!force && now - lastNetworkHealAt < _healBackoffMs()) return;
            if (force && !shouldRunEventHeal(usableShardPeers, now - lastNetworkHealAt, NETWORK_HEAL_COOLDOWN_MS)) return;

            networkHealInFlight = true;
            lastNetworkHealAt = now;
            _healAttempts++;
        try {
            if (globalPeers > 0) {
                if (!isUsingTurnFallback(currentRtcConfig)) currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
            } else {
                if (!isUsingTurnFallback(currentRtcConfig)) currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                await connectGlobal(currentRtcConfig);
                await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
            }
        } finally { networkHealInFlight = false; }
    };

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
    // Save introducers and tear down overlay timers before leaving the old shard.
    if (rooms.torrent) {
        const currentShard = getShardName(localPlayer.location, getCurrentInstance());
        saveIntroducers(currentShard);
        if (_shardTeardown) { _shardTeardown(); _shardTeardown = null; }
        rooms.torrent.leave();
    }
    shardKnownPeers.clear();
    clearShardState(location);
    clearSecurityState();
    pendingCommits.clear();
    feedHeads.clear();
    joinTime = Date.now();
    lastShardPresenceAt = joinTime;
    setCurrentInstance(instanceId);

    const shard = getShardName(location, instanceId);
    console.log(`[P2P] Joining Shard Room: ${shard}`);
    const config = rtcConfig || currentRtcConfig;

    if (globalRooms.torrent && gameActions.sendSeekingShard) gameActions.sendSeekingShard(shard);

    const arbiterUrl = runtimeArbiterUrl();
    if (arbiterUrl) {
        fetch(`${arbiterUrl}/peers?shard=${encodeURIComponent(shard)}`, { signal: AbortSignal.timeout(3000) })
            .then(r => r.ok ? r.json() : [])
            .then(entries => seedFromSnapshot(entries))
            .catch(() => { });
    }

    const preJoined = getPreJoined(shard);
    if (preJoined) {
        rooms.torrent = preJoined.room;
        netLog(`[Pre-join] Promoted pre-joined room for ${shard}`);
    } else {
        rooms.torrent = joinTorrent(buildTorrentConfig(config), shard);
    }

    const registerWithArbiter = async (attempt = 0) => {
        if (!playerKeys) { if (attempt < 10) setTimeout(() => registerWithArbiter(attempt + 1), 500); return; }
        const entry = await myEntry();
        if (!entry) return;
        if (gameActions.sendRegisterPresence && globalRooms.torrent) gameActions.sendRegisterPresence({ ...entry, shard });
        if (arbiterUrl) {
            fetch(`${arbiterUrl}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...entry, shard }), signal: AbortSignal.timeout(3000) }).catch(() => {});
        }
    };
    setTimeout(registerWithArbiter, 1000);

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

        const hpv = new HyParView();
        const _pendingPresence = new Map();

        // HyParView SHUFFLE (item 2) — periodic passive-view exchange keeps the
        // overlay self-healing under churn without manual re-discovery.
        getIdentity(({ publicKey }, peerId) => {
            if (!publicKey || peerId === selfId) return;
            const ph = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
            trackPlayer(peerId, { publicKey, ph, ts: Date.now() });
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

        // 8.95c: Evict peers that haven't sent a presence update in GHOST_TTL_MS
        const ghostTimer = setInterval(() => {
            const now = Date.now();
            for (const [peerId, lastSeen] of _peerLastPresenceAt) {
                if (now - lastSeen > GHOST_TTL_MS) {
                    _peerLastPresenceAt.delete(peerId);
                    _peerMsgCounts.delete(peerId);
                    evictPlayer(peerId);
                    evictShadowPlayer(peerId);
                    netLog(`Ghost-peer evicted: ${peerId}`, '#a00');
                }
            }
        }, 60_000);

        getPresenceDelta(async ({ joined, left }, peerId) => {
            (left || []).forEach(id => { if (id !== selfId) evictPlayer(id); });
            const missing = (joined || []).filter(id => id !== selfId && !players.has(id));
            if (missing.length > 0) sendRequest(missing, [peerId]);
        });

        const localIds = () => [...Array.from(players.keys()).filter(id => !players.get(id).ghost), selfId];

        const processPresenceSingle = async (buf, peerId) => {
            if (!buf || peerId === selfId) return;
            if (!checkThrottle(peerId)) return;
            _peerLastPresenceAt.set(peerId, Date.now());
            lastPeerSeenAt = Date.now();
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

            trackPlayer(peerId, { ...entry, ...unpacked, ts: Date.now(), rawPresence: buf });
            trackShadowPlayer(peerId, unpacked);
            lastShardPresenceAt = Date.now();
            players.delete('ghost:' + unpacked.ph);
        };

        const connectedOnly = (ids) => filterConnectedPeerIds(r, ids);
        const plumSend = (packed) => {
            const msgId = HyParView.msgId(hashStr, packed);
            hpv.markSeen(msgId);
            const eager = connectedOnly(hpv.eagerPeers());
            const lazy = connectedOnly(hpv.lazyPeers());
            if (eager.length) sendPresenceSingle(packed, eager); else sendPresenceSingle(packed);
            if (lazy.length) sendAnnounce({ msgId }, lazy);
        };

        const broadcastWhenReady = async (attempt = 0) => {
            if (!playerKeys) { if (attempt < 50) setTimeout(() => broadcastWhenReady(attempt + 1), 200); return; }
            const entry = await myEntry();
            if (entry) {
                const pubKey = await exportKey(playerKeys.publicKey);
                sendIdentity({ publicKey: pubKey });
                plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
            }
        };
        broadcastWhenReady();

        getAnnounce(async ({ msgId }, peerId) => {
            if (hpv.hasSeen(msgId)) return;
            hpv.promote(peerId);
            sendRequest([peerId], [peerId]);
        });

        getSketch(async (remoteArr, peerId) => {
            const localMs = buildSketch();
            const remoteMs = Minisketch.fromSerialized(remoteArr);
            const { added, removed, failure } = Minisketch.decode(localMs, remoteMs);
            if (failure) { sendRequest(localIds().map(String), [peerId]); return; }
            if (added.length > 32 || removed.length > 32) return;
            if (removed.length > 0) {
                const response = {};
                for (const id of localIds()) {
                    const h = Number(Minisketch.hashId(id));
                    if (!removed.some(r => r === h)) continue;
                    if (id === selfId) continue;
                    const data = players.get(id);
                    if (data?.rawPresence) response[id] = { presence: data.rawPresence, publicKey: data.publicKey };
                }
                if (removed.some(r => r === Number(Minisketch.hashId(selfId)))) {
                    const entry = await myEntry();
                    if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
                }
                if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
            }
            if (added.length > 0) sendRequest(added.map(String), [peerId]);
        });

        getRequest(async (idStrings, peerId) => {
            const response = {};
            const myIdHash = Number(Minisketch.hashId(selfId));
            const matchesSelf = idStrings.some(s => s === selfId || (Number.isInteger(Number(s)) && Number(s) === myIdHash));
            for (const [id, data] of players.entries()) {
                if (data.ghost) continue;
                const matches = idStrings.some(s => s === id || (Number.isInteger(Number(s)) && Number(s) === Number(Minisketch.hashId(id))));
                if (matches && (data.rawPresence || data.ph)) response[id] = { presence: data.rawPresence || packPresence(data), publicKey: data.publicKey };
            }
            if (matchesSelf) {
                const entry = await myEntry();
                if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
            }
            if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
        });

        getPresenceSingle(async (buf, peerId) => { if (peerId === selfId) return; hpv.markSeen(HyParView.msgId(hashStr, buf)); await processPresenceSingle(buf, peerId); });

        getPresenceBatch(async (data) => {
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
            if (await verifyMessage(typeof state === 'string' ? state : JSON.stringify(state), signature, arbiterPublicKey)) updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
        });

        getActionLog(async (buf, peerId) => {
            const data = unpackActionLog(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            // During an arbiter outage, queue durable peer rewards rather than
            // apply them immediately — shadow state may be reconciled later.
            if (isHardStateFrozen()) {
                hardStateQueue.push({ peerId, publicKey: entry.publicKey, data, ts: Date.now() });
                return;
            }
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify({ type: data.type, index: data.index, target: data.target, data: data.data }), data.signature, pubKey)) return;
                applyActionLogToShadow(peerId, data);
            } catch (e) { console.error('[Security] ActionLog fail:', e); }
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

        getMove(async (buf, peerId) => {
            if (!checkThrottle(peerId)) return;
            const data = unpackMove(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            try {
                const movePayload = { from: data.from, to: data.to, x: data.x, y: data.y, ts: data.ts };
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(movePayload), data.signature, pubKey)) return;

                // Detect illegal room transition and report to arbiter
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
        });

        getMonsterDmg((data, peerId) => {
            if (!checkThrottle(peerId)) return;
            const s = shardEnemies.get(data.roomId);
            if (s) { s.hp = Math.max(0, s.hp - data.damage); s.lastUpdate = Date.now(); bus.emit('monster:damaged', { roomId: data.roomId, damage: data.damage }); }
        });

        r.onPeerJoin(async peerId => {
            shardKnownPeers.add(peerId); lastPeerSeenAt = Date.now();
            if (!peerJoinTimes.has(peerId)) peerJoinTimes.set(peerId, Date.now());
            hpv.onJoin(peerId);
            try { sendSketch(buildSketch().serialize(), [peerId]); } catch (_e) { /* ignore */ }
            const handshake = async () => {
                if (!shardKnownPeers.has(peerId) || !playerKeys) return;
                try {
                    sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) }, [peerId]);
                    const e = await myEntry(); if (e) sendPresenceSingle(await packSignedPresence({ ...e, hlc: sendHLC() }), [peerId]);
                } catch (_e2) { /* ignore */ }
                if (!players.get(peerId)?.publicKey) setTimeout(handshake, 3000);
            };
            setTimeout(handshake, 100);
            setTimeout(() => {
                if (!shardKnownPeers.has(peerId)) return;
                if (players.get(peerId)?.publicKey) return;
                scheduleHeal(NETWORK_EVENT_HEAL_DELAY_MS, { force: true });
            }, NETWORK_HANDSHAKE_TIMEOUT_MS);
        });

        r.onPeerLeave(peerId => {
            bus.emit('peer:leave', { peerId }); shardKnownPeers.delete(peerId); hpv.onLeave(peerId);
            peerJoinTimes.delete(peerId);
            evictPlayer(peerId); evictShadowPlayer(peerId); evictSecurityPeer(peerId);
            feedHeads.delete(peerId); pendingCommits.delete(peerId); _pendingPresence.delete(peerId);
            const c = activeChannels.get(peerId); if (c) { clearTimeout(c.timeoutId); activeChannels.delete(peerId); }
            if (countUsableShardPeers(shardKnownPeers, players) === 0) {
                scheduleHeal(NETWORK_EVENT_HEAL_DELAY_MS, { force: true });
            }
        });

        return {
            sendMove, sendMonsterDmg, sendPresenceSingle, sendPresenceBatch,
            sendRelay, sendRollupLocal, sendSketch, sendRequest,
            sendDuelChallenge, sendDuelAccept, sendDuelCommit,
            sendActionLog, sendTradeOffer, sendTradeAccept, sendTradeCommit, sendTradeFinal,
            sendCommit, sendReveal, plumSend, sendPresenceDelta, sendIdentity,
            processPresenceSingle,
            seedIntroducers: (peerIds) => hpv.mergeShuffle(peerIds, selfId),
            teardown: () => {
                clearInterval(shuffleTimer);
                clearInterval(routerTimer);
                clearInterval(ghostTimer);
                if (scheduledHealTimer) { clearTimeout(scheduledHealTimer); scheduledHealTimer = null; }
            },
        };
    };

    const r = setupShard(rooms.torrent);
    _shardTeardown = r.teardown;

    // Seed HyParView passive view with cached introducers (item 5) so they get
    // priority when tracker discovery re-connects us to them.
    const cachedIntroducers = loadIntroducers(getShardName(localPlayer.location, instanceId));
    if (cachedIntroducers.length > 0) {
        r.seedIntroducers(cachedIntroducers);
        netLog(`[Introducers] ${cachedIntroducers.length} cached peers loaded for shard`, '#555');
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
