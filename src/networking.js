// @ts-check
import { joinRoom as joinTorrent, selfId } from './transport.js';
import { getShardName, hashStr, seededRNG, deriveWorldState, xpToLevel, rollLoot, getTimeOfDay } from './rules.js';
import { APP_ID, TORRENT_TRACKERS, STUN_SERVERS, TURN_SERVERS, ARBITER_URL } from './constants.js';
import { 
    worldState, localPlayer, hasSyncedWithArbiter, setHasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel, WORLD_STATE_KEY,
    players, shadowPlayers, shardEnemies, trackPlayer, trackShadowPlayer, bansHash, setBans, bans,
    _presenceDelta, clearPresenceDelta, evictPlayer, evictShadowPlayer
} from './store.js';
import { INSTANCE_CAP, ENEMIES, world } from './data.js';
import { verifyMessage, signMessage, exportKey, importKey } from './crypto.js';
import { Minisketch } from './minisketch.js';
import { HyParView } from './hyparview.js';
import { sendHLC, recvHLC, cmpHLC } from './hlc.js';
import { 
    packMove, unpackMove, packEmote, unpackEmote, 
    packPresence, unpackPresence, packDuelCommit, unpackDuelCommit,
    packActionLog, unpackActionLog, packTradeCommit, unpackTradeCommit,
    packPresenceBatch, unpackPresenceBatch,
    presenceSignaturePayload
} from './packer.js';
import { arbiterPublicKey, playerKeys, myEntry } from './identity.js';
import { log, printStatus } from './ui.js';
import { GAME_NAME } from './data.js';
import { bus } from './eventbus.js';
import { saveLocalState } from './persistence.js';
import { getArbiterUrl } from './runtime.js';

const netLog = (msg, color = '#555') => {
    if (localStorage.getItem(`${GAME_NAME}_debug`) === 'true') {
        log(`[Net] ${msg}`, color);
    }
};

export let gameActions = {};
export let rooms = { torrent: null };
export let globalRooms = { torrent: null };
export let knownPeers = new Set();
export let lastRollupReceivedAt = 0;
export let lastValidStatePacket = null;
export let currentInstance = 1;
export let currentRtcConfig = { iceServers: STUN_SERVERS };
export let joinTime = Date.now();
let lastPeerSeenAt = Date.now();
let lastNetworkHealAt = 0;
let networkHealInFlight = false;
const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);

const ROLLUP_INTERVAL = 10000;
const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;
const NETWORK_STALL_MS = 60000;
const NETWORK_HEAL_COOLDOWN_MS = 30000;

// Token bucket: max XP rate derived from the best enemy's XP value.
// Bucket holds 60s of max-rate XP so tab-switches and network gaps don't false-positive.
const MAX_XP_PER_MS = Math.max(...Object.values(ENEMIES).map(e => e.xp || 0), 1) / 5000;
const XP_BUCKET_CAPACITY = MAX_XP_PER_MS * 60000;

// Per-peer XP rate buckets and HLC tracking for causal ordering.
const xpBuckets = new Map();   // peerId → { tokens, lastRefill }
const peerHlc = new Map();     // peerId → last accepted HLC

// Pending commit-reveal entries: peerId → Map<seq, { commit, ts }>
const pendingCommits = new Map();

// Per-peer feed heads for append-only signed action chain.
const feedHeads = new Map();   // peerId → { seq, hash }

// x,y are excluded deliberately — tile position changes every keystroke and would
// cause false fraud alerts between the 10s rollup interval. Only level, xp, and
// location (room-level, bounded) belong in the consensus hash.
const buildLeafData = () => {
    const leaves = Array.from(players.entries())
        .filter(([id, p]) => id !== selfId && !p.ghost)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
    leaves.sort();
    return leaves;
};

const buildSketch = () => {
    const ms = new Minisketch(32);
    players.forEach((p, id) => {
        if (!p.ghost) ms.add(id);
    });
    ms.add(selfId);
    return ms;
};

const signPresence = async (entry) => {
    const signature = await signMessage(JSON.stringify(presenceSignaturePayload(entry)), playerKeys.privateKey);
    return { ...entry, signature };
};

const packSignedPresence = async (entry) => packPresence(await signPresence(entry));

const isPresenceLike = (value) => value && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof ArrayBuffer)
    && !ArrayBuffer.isView(value)
    && typeof value.name === 'string'
    && typeof value.location === 'string'
    && typeof value.ph === 'string'
    && typeof value.level === 'number'
    && typeof value.xp === 'number';

const unpackPresencePacket = (presence) => {
    if (isPresenceLike(presence)) return presence;
    if (!presence) return null;
    try {
        return unpackPresence(presence);
    } catch {
        return null;
    }
};

// Returns true if the XP gain is within the token bucket allowance for this peer.
const checkXpRate = (peerId, newXp, oldXp) => {
    const gain = newXp - oldXp;
    if (gain <= 0) return true;
    const now = Date.now();
    let bucket = xpBuckets.get(peerId);
    if (!bucket) {
        bucket = { tokens: XP_BUCKET_CAPACITY, lastRefill: now };
        xpBuckets.set(peerId, bucket);
    }
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(XP_BUCKET_CAPACITY, bucket.tokens + MAX_XP_PER_MS * elapsed);
    bucket.lastRefill = now;
    bucket.tokens -= gain;
    return bucket.tokens >= 0;
};

// Returns true if the incoming HLC is strictly newer than the last accepted one from this peer.
// Stores the peer's own HLC (not ours) so subsequent comparisons are peer-relative.
const checkAndUpdateHlc = (peerId, incoming) => {
    const last = peerHlc.get(peerId);
    if (last && cmpHLC(incoming, last) <= 0) return false;
    recvHLC(incoming); // advance local clock for causal ordering
    peerHlc.set(peerId, incoming); // track peer's own clock, not ours
    return true;
};

export const seedFromSnapshot = (snapshot) => {
    if (!Array.isArray(snapshot)) return;
    const existingPhs = new Set(Array.from(players.values()).map(p => p.ph));
    const now = Date.now();
    for (const entry of snapshot) {
        if (!entry.ph || !entry.location || existingPhs.has(entry.ph)) continue;
        // Security: Never seed ourselves as a ghost. Authority is our own localPlayer object.
        if (entry.ph === localPlayer.ph) continue;

        // Store as ghost — no peerId, no publicKey. Keyed by ph (display only).
        // Real P2P presence will overwrite when it arrives.
        const ghostKey = 'ghost:' + entry.ph;
        if (!players.has(ghostKey)) {
            // Use current time if snapshot ts is old or missing to avoid instant eviction
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

export const updateSimulation = (state) => {
    if (!state) return;
    
    // Security: Never allow P2P sync or Beacons to overwrite our cryptographic identity
    // or personal character progress.
    const personalFields = ['ph', 'name', 'xp', 'level', 'gold', 'inventory', 'quests', 'hp', 'maxHp'];
    personalFields.forEach(f => { if (f in state) delete state[f]; });

    if (state.type === 'ban') {
        log(`[Arbiter] Proposer banned: ${state.target.slice(0, 8)}`, '#f55');
        return;
    }

    // Sync Ban List if hash mismatch
    const arbiterUrl = runtimeArbiterUrl();
    if (state.bans && state.bans !== bansHash && arbiterUrl) {
        fetch(`${arbiterUrl}/bans`)
            .then(r => r.ok ? r.json() : [])
            .then(list => setBans(list, state.bans))
            .catch(() => {});
    }

    const newSeed = state.world_seed;
    const newDay = state.day || 1;
    const newTick = state.last_tick || 0;
    const firstSync = !hasSyncedWithArbiter;

    if (newSeed !== worldState.seed || newDay !== worldState.day || newTick !== worldState.lastTick) {
        const isNewDay = newDay > worldState.day && hasSyncedWithArbiter;
        worldState.seed = newSeed;
        worldState.day = newDay;
        worldState.lastTick = newTick;
        localStorage.setItem(WORLD_STATE_KEY, JSON.stringify({ seed: newSeed, day: newDay, lastTick: newTick }));
        const derived = deriveWorldState(newSeed, newDay);
        worldState.mood = derived.mood;
        worldState.season = derived.season;
        worldState.seasonNumber = derived.seasonNumber;
        worldState.threatLevel = derived.threatLevel;
        worldState.scarcity = derived.scarcity;
        worldState.event = derived.event;
        worldState.weather = derived.weather;

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            localPlayer.forestFights = 15; // Reset daily fights
            localPlayer.combatRound = 0;   // Reset round counter so RNG seeds stay small
            if (localPlayer.buffs) {
                localPlayer.buffs.rested = false;
                localPlayer.buffs.activeElixir = null;
            }
            printStatus();
            bus.emit('world:timeOfDay', { day: worldState.day, timeOfDay: 'day' });
        }
    }

    if (firstSync) {
        setHasSyncedWithArbiter(true);
        log(`\n[System] Connected — Day ${worldState.day}, ${worldState.mood.toUpperCase()}.`, '#0f0');
        printStatus();
        bus.emit('world:timeOfDay', { day: worldState.day, timeOfDay: getTimeOfDay() });
    }
};

// Use all trackers to ensure maximum peer discovery and prevent network fragmentation.
const getMyTrackers = () => TORRENT_TRACKERS;

export const buildTorrentConfig = (rtcConfig = currentRtcConfig) => ({
    appId: APP_ID,
    relayUrls: getMyTrackers(),
    rtcConfig
});

const isUsingTurnFallback = (rtcConfig = currentRtcConfig) => {
    const iceServers = rtcConfig?.iceServers || [];
    return iceServers.some(server => {
        const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
        return urls.some(url => typeof url === 'string' && url.startsWith('turn:'));
    });
};

// Pre-join cache: destination shard name → { room, timeout }
// Populated by preJoinShard() when the player walks near a portal.
const preJoinCache = new Map();

// Start connecting to a destination shard room before the player actually enters it.
// The room object is cached; joinInstance() will promote it to the active room.
export const preJoinShard = (location, instanceId) => {
    const shard = getShardName(location, instanceId ?? currentInstance);
    const currentShard = getShardName(localPlayer.location, currentInstance);
    if (shard === currentShard || preJoinCache.has(shard)) return;
    netLog(`[Pre-join] Starting early connect to ${shard}`);
    const room = joinTorrent(
        buildTorrentConfig(currentRtcConfig),
        shard
    );
    const timeout = setTimeout(() => {
        room.leave();
        preJoinCache.delete(shard);
    }, 30000);
    preJoinCache.set(shard, { room, timeout });
};

export const initNetworking = async (rtcConfig) => {
    currentRtcConfig = rtcConfig || { iceServers: STUN_SERVERS };

    const connectGlobal = async (config) => {
        if (globalRooms.torrent) globalRooms.torrent.leave();

        globalRooms.torrent = joinTorrent(buildTorrentConfig(config), 'global');

        const [sendRollup] = globalRooms.torrent.makeAction('rollup');
        const [sendFraud] = globalRooms.torrent.makeAction('fraud_proof');
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction('world_state');
        const [sendStateRequest, getStateRequest] = globalRooms.torrent.makeAction('state_request');
        const [sendRegisterPresence] = globalRooms.torrent.makeAction('register_presence');
        gameActions.sendRegisterPresence = (data) => sendRegisterPresence(data);
        const [sendStateOffer, getStateOffer] = globalRooms.torrent.makeAction('state_offer');

        // A2: Seeking shard relay
        const [sendSeekingShard, getSeekingShard] = globalRooms.torrent.makeAction('seeking_shard');
        gameActions.sendSeekingShard = (shard) => sendSeekingShard(shard);
        const [sendPresenceBootstrap, getPresenceBootstrap] = globalRooms.torrent.makeAction('presence_bootstrap');

        getSeekingShard(async (shard, peerId) => {
            // If we are in the shard the peer is seeking, push our presence to them globally
            const currentShard = getShardName(localPlayer.location, currentInstance);
            if (shard === currentShard) {
                const entry = await myEntry();
                if (entry) {
                    const hlc = sendHLC();
                    const packed = await packSignedPresence({ ...entry, hlc });
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
                // Ensure we pass a binary buffer to processPresence
                const buf = (packet.presence instanceof Uint8Array) ? packet.presence : packPresence(packet.presence);
                await gameActions.processPresence(buf, peerId);
            }
        });

        gameActions.submitRollup = (rollup) => sendRollup(rollup);
        gameActions.submitFraudProof = (proof) => sendFraud(proof);

        getState(async (data, peerId) => {
            netLog(`Received state from ${peerId.slice(0, 8)}`);
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            try {
                const valid = await verifyMessage(stateStr, signature, arbiterPublicKey);
                if (valid) {
                    netLog(`Signature valid! Updating simulation.`, '#0f0');
                    lastValidStatePacket = data;
                    TAB_CHANNEL.postMessage({ type: 'state', packet: data });
                    const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
                    updateSimulation(stateObj);
                    if (isProposer() && gameActions.relayState) gameActions.relayState(data);
                } else {
                    console.warn(`[Sync] Signature INVALID from ${peerId}. Check MASTER_PUBLIC_KEY.`);
                    log(`[Sync] Warning: Received signed state but signature failed verification.`, '#f55');
                }
            } catch (e) {
                console.error(`[Sync] Verification error:`, e);
                log(`[Sync] Error verifying Arbiter signature: ${e.message}`, '#f00');
            }
        });

        getIncomingRequest((_, peerId) => {
            if (lastValidStatePacket) sendWorldState(lastValidStatePacket, [peerId]);
        });

        globalRooms.torrent.onPeerJoin(peerId => {
            knownPeers.add(peerId);
            lastPeerSeenAt = Date.now();
            if (!hasSyncedWithArbiter) {
                console.log(`[Discovery] Peer ${peerId} joined global room. Requesting state...`);
                log(`[System] Found a peer (${peerId.slice(0, 8)}). Syncing...`, '#555');
            }
            requestState(true, [peerId]);
            if (lastValidStatePacket) {
                setTimeout(() => {
                    sendWorldState(lastValidStatePacket, [peerId]);
                }, 500);
            }
        });

        gameActions.requestState = requestState;
        gameActions.sendWorldState = sendWorldState;
        gameActions.sendStateRequest = sendStateRequest;

        getStateRequest((ph, peerId) => {
            // If we have a shadow player with this PH, offer the state
            for (const shadow of shadowPlayers.values()) {
                if (shadow.ph === ph) {
                    sendStateOffer(shadow, [peerId]);
                    break;
                }
            }
        });

        getStateOffer(async (shadow, peerId) => {
            if (!shadow || !shadow.ph || shadow.ph !== localPlayer.ph) return;

            // Security: derives must match and signature is REQUIRED for rescue
            const derivedLevel = xpToLevel(shadow.xp || 0);
            if (shadow.level !== derivedLevel) {
                console.warn(`[Rescue] Rejected: level mismatch (${shadow.level} vs ${derivedLevel})`);
                return;
            }

            const offerer = players.get(peerId);
            if (!shadow.signature || !offerer?.publicKey) {
                console.warn(`[Rescue] Rejected: missing signature or offerer public key`);
                return;
            }

            // Security: 10% XP ceiling — rescue shouldn't advance more than 10% beyond current progress
            const xpCeiling = Math.floor(localPlayer.xp * 1.10) + 100; // +100 base buffer for early game
            if (shadow.xp > xpCeiling) {
                console.warn(`[Rescue] Rejected: XP ceiling exceeded (${shadow.xp} vs ${xpCeiling})`);
                log(`[Rescue] Rejected: offer from ${peerId.slice(0, 8)} exceeds progress ceiling.`, '#f55');
                return;
            }

            try {
                const { signature, ...sigData } = shadow;
                const pubKey = await importKey(offerer.publicKey, 'public');
                // Note: since we are the ones being rescued, we verify against our own PH which 
                // the offerer has signed. The offerer is acting as the store.
                if (!await verifyMessage(JSON.stringify(presenceSignaturePayload(sigData)), signature, pubKey)) {
                    console.warn(`[Rescue] Rejected: signature verification failed`);
                    return;
                }
            } catch (e) { 
                console.error(`[Rescue] Verification error:`, e);
                return; 
            }

            log(`[System] Received state rescue offer from ${peerId.slice(0, 8)}!`, '#0f0');
            if (shadow.xp > localPlayer.xp) {
                if (shadow.name && !shadow.name.startsWith('Peer-')) {
                    localPlayer.name = shadow.name;
                }
                localPlayer.xp = shadow.xp;
                localPlayer.level = derivedLevel;
                localPlayer.gold = Math.max(localPlayer.gold, shadow.gold || 0);
                const myInv = new Set(localPlayer.inventory);
                (shadow.inventory || []).forEach(i => myInv.add(i));
                localPlayer.inventory = Array.from(myInv);
                Object.assign(localPlayer.quests, shadow.quests || {});
                log(`[System] State merged successfully. Welcome back, ${localPlayer.name}!`, '#0f0');
                saveLocalState(localPlayer, true);
            }
        });
    };

    await connectGlobal(currentRtcConfig);

    // Adaptive Silence Watchdog: Leave global room if we have enough peers to reduce tracker load
    let isSilenced = false;
    setInterval(async () => {
        const globalPeerCount = Object.keys(globalRooms.torrent?.getPeers() || {}).length;
        const shardPeerCount = Object.keys(rooms.torrent?.getPeers() || {}).length;
        if (!isSilenced && globalPeerCount >= 5) {
            netLog('Entering Adaptive Silence (leaving global room)...', '#0af');
            globalRooms.torrent.leave();
            isSilenced = true;
        } else if (isSilenced && shardPeerCount < 3) {
            // Use shard peer count — players map is cleared on every room join so
            // players.size was always 0 immediately after transition, causing constant re-joins.
            netLog('Leaving Adaptive Silence (rejoining global room)...', '#0af');
            await connectGlobal(currentRtcConfig);
            isSilenced = false;
        }
    }, 30000);

    // Networking Status Heartbeat
    setInterval(() => {
        const globalPeers = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
        const shardPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        const shardName = getShardName(localPlayer.location, currentInstance);
        console.log(`[P2P] Global Room: global (${globalPeers} peers) | Shard Room: ${shardName} (${shardPeers} peers) | Synced: ${hasSyncedWithArbiter}`);
    }, 10000);

    await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);

    const healNetworking = async () => {
        if (networkHealInFlight) return;

        const shardPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        const globalPeers = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
        const now = Date.now();
        const silentFor = now - Math.max(joinTime, lastPeerSeenAt);

        if (shardPeers > 0) return;
        if (silentFor < NETWORK_STALL_MS) return;
        if (now - lastNetworkHealAt < NETWORK_HEAL_COOLDOWN_MS) return;

        networkHealInFlight = true;
        lastNetworkHealAt = now;
        try {
            if (globalPeers > 0) {
                if (!isUsingTurnFallback(currentRtcConfig)) {
                    log(`\n[System] Discovery is active, but shard peering is stalled. Rejoining shard with TURN relay fallback...`, '#555');
                    currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                } else {
                    log(`\n[System] Discovery is active, but shard peering is stalled. Rejoining shard room...`, '#555');
                }
                await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);
            } else {
                if (!isUsingTurnFallback(currentRtcConfig)) {
                    log(`\n[System] No live peers found. Retrying with TURN relay fallback...`, '#555');
                    currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                } else {
                    log(`\n[System] No live peers found. Rejoining discovery rooms...`, '#555');
                }
                await connectGlobal(currentRtcConfig);
                await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);
            }
        } finally {
            networkHealInFlight = false;
        }
    };

    setInterval(() => {
        healNetworking().catch(err => console.warn('[P2P] Network heal failed:', err?.message || err));
    }, 10000);

    // Periodic Rollups & Sketching
    setInterval(async () => {
        if (!isProposer()) return;
        const leafData = buildLeafData();

        const { createMerkleRoot } = await import('./crypto.js');
        const root = await createMerkleRoot(leafData);
        if (!root) return;

        const proposerEpoch = Math.floor(Date.now() / ROLLUP_INTERVAL);
        const rollup = {
            shard: getShardName(localPlayer.location, currentInstance),
            root,
            timestamp: Date.now(),
            count: leafData.length,
            proposerEpoch,
        };
        const signature = await signMessage(JSON.stringify(rollup), playerKeys.privateKey);
        const data = { rollup, signature, publicKey: await exportKey(playerKeys.publicKey) };
        gameActions.submitRollup(data);
        gameActions.sendRollupLocal(data);
    }, ROLLUP_INTERVAL);

    // A1: Exponential Backoff Sketch Intervals
    const scheduleNextSketch = (attempt = 0) => {
        // Burst sequence: [200ms, 1s, 4s, 16s] then settle to steady-state formula
        let delay;
        if (attempt === 0) delay = 200;
        else if (attempt === 1) delay = 1000;
        else if (attempt === 2) delay = 4000;
        else if (attempt === 3) delay = 16000;
        else delay = 30000 + (players.size * 5000);

        setTimeout(() => {
            if (gameActions.sendSketch) gameActions.sendSketch(buildSketch().serialize());
            
            // A3: SWIM-inspired presence delta piggybacking
            if (_presenceDelta.joined.size > 0 || _presenceDelta.left.size > 0) {
                if (gameActions.sendPresenceDelta) {
                    gameActions.sendPresenceDelta({
                        joined: Array.from(_presenceDelta.joined),
                        left: Array.from(_presenceDelta.left)
                    });
                }
                clearPresenceDelta();
            }

            scheduleNextSketch(attempt + 1);
        }, delay);
    };
    scheduleNextSketch();
};

export const isProposer = () => {
    const all = Array.from(players.keys()).filter(id => !players.get(id).ghost).concat(selfId).sort();
    if (all.length < 2) return false;

    const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
    if (all[slot] === selfId) return true;
    if (Date.now() - lastRollupReceivedAt > PROPOSER_GRACE_MS) {
        return all[(slot + 1) % all.length] === selfId;
    }
    return false;
};

export const joinInstance = async (location, instanceId, rtcConfig) => {
    if (rooms.torrent) rooms.torrent.leave();
    players.clear();
    // Clear all per-peer shard state so stale data from the old room doesn't
    // poison security checks or action chains in the new room.
    feedHeads.clear();
    peerHlc.clear();
    xpBuckets.clear();
    pendingCommits.clear();
    // Abandon any in-flight duels — the action channel belongs to the old shard room.
    for (const [, chan] of activeChannels) clearTimeout(chan.timeoutId);
    activeChannels.clear();
    shardEnemies.delete(location);
    // Clear phantom combat state — the shard is fresh, no enemy is confirmed alive yet
    localPlayer.currentEnemy = null;
    joinTime = Date.now();

    const shard = getShardName(location, instanceId);
    console.log(`[P2P] Joining Shard Room: ${shard}`);
    const config = rtcConfig || currentRtcConfig;

    // A2: Global-to-shard relay bootstrap
    if (globalRooms.torrent && gameActions.sendSeekingShard) {
        gameActions.sendSeekingShard(shard);
    }

    // Technique B: Fetch shard-specific peer snapshot from Arbiter.
    const arbiterUrl = runtimeArbiterUrl();
    if (arbiterUrl) {
        fetch(`${arbiterUrl}/peers?shard=${encodeURIComponent(shard)}`, {
            signal: AbortSignal.timeout(3000)
        })
            .then(r => r.ok ? r.json() : [])
            .then(entries => seedFromSnapshot(entries))
            .catch(() => { }); // non-fatal — P2P still works without this
    }

    // Promote a pre-joined room if we started connecting early (zero ICE latency).
    const preJoined = preJoinCache.get(shard);
    if (preJoined) {
        clearTimeout(preJoined.timeout);
        preJoinCache.delete(shard);
        rooms.torrent = preJoined.room;
        netLog(`[Pre-join] Promoted pre-joined room for ${shard}`);
    } else {
        rooms.torrent = joinTorrent(buildTorrentConfig(config), shard);
    }

    // Register presence with Arbiter for rendezvous bootstrap.
    // Uses the sendRegisterPresence action created once in connectGlobal — never calls
    // makeAction again here (calling makeAction repeatedly stacks listeners on the same room).
    const registerWithArbiter = async (attempt = 0) => {
        if (!playerKeys) {
            // Keys not ready yet — retry rather than silently dropping registration
            if (attempt < 10) setTimeout(() => registerWithArbiter(attempt + 1), 500);
            return;
        }
        const entry = await myEntry();
        if (!entry) return;
        // Only send via P2P if the global room is still open (Adaptive Silence may have closed it)
        if (gameActions.sendRegisterPresence && globalRooms.torrent) {
            gameActions.sendRegisterPresence({ ...entry, shard });
        }
        const arbiterUrl = runtimeArbiterUrl();
        if (arbiterUrl) {
            fetch(`${arbiterUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...entry, shard }),
                signal: AbortSignal.timeout(3000),
            }).catch(() => {});
        }
    };
    setTimeout(registerWithArbiter, 1000);

    const checkFull = async () => {
        const peerCount = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        if (peerCount >= INSTANCE_CAP && instanceId < 10) {
            log(`[System] Instance ${instanceId} is full, moving to ${instanceId + 1}...`, '#aaa');
            currentInstance = instanceId + 1;
            await joinInstance(location, currentInstance, rtcConfig);
        }
    };
    setTimeout(checkFull, 5000);

    const setupShard = (r) => {
        const [sendMove, getMove] = r.makeAction('move');
        const [sendEmote, getEmote] = r.makeAction('emote');
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
        // A3: Presence delta piggybacking
        const [sendPresenceDelta, getPresenceDelta] = r.makeAction('presence_delta');

        // Plumtree lazy-push announcements and commit-reveal wire actions
        const [sendAnnounce, getAnnounce] = r.makeAction('presence_announce');
        const [sendCommit, getCommit] = r.makeAction('commit_action');
        const [sendReveal, getReveal] = r.makeAction('reveal_action');

        // HyParView logical overlay for this shard
        const hpv = new HyParView();

        // Presence packets that arrive before the peer's public key is known
        // are queued here (keyed by peerId, one packet max — newest wins).
        const _pendingPresence = new Map();

        getPresenceDelta(async ({ joined, left }, peerId) => {
            // SWIM-inspired: immediately update peer roster from delta
            (left || []).forEach(id => {
                if (id !== selfId) evictPlayer(id);
            });
            // If we see joined IDs we don't have, request them
            const missing = (joined || []).filter(id => id !== selfId && !players.has(id));
            if (missing.length > 0) sendRequest(missing, [peerId]);
        });

        // --- helpers ---

        const localIds = () => [...Array.from(players.keys()).filter(id => !players.get(id).ghost), selfId];

        const processPresenceSingle = async (buf, peerId) => {
            if (!buf || peerId === selfId) return;
            lastPeerSeenAt = Date.now();
            const entry = players.get(peerId);
            if (!entry?.publicKey) {
                _pendingPresence.set(peerId, buf);
                return;
            }

            if (bans.has(entry.publicKey)) {
                evictPlayer(peerId);
                _pendingPresence.delete(peerId);
                return;
            }

            const unpacked = unpackPresencePacket(buf);
            if (!unpacked) return;

            // Security: ph must derive from the sender's known public key
            const expectedPh = (hashStr(entry.publicKey) >>> 0).toString(16).padStart(8, '0');
            if (unpacked.ph !== expectedPh) {
                console.warn(`[Security] ph mismatch for ${peerId.slice(0,8)}: got ${unpacked.ph}, expected ${expectedPh}`);
                return;
            }

            // Security: Ed25519 signature
            try {
                const { signature, ...sigData } = unpacked;
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(presenceSignaturePayload(sigData)), signature, pubKey)) return;
            } catch { return; }

            // HLC causal ordering: reject stale/replayed presence (ONLY AFTER VERIFICATION)
            if (unpacked.hlc && !checkAndUpdateHlc(peerId, unpacked.hlc)) return;

            // Security: level must match XP formula (always), and XP rate must be sane
            if (unpacked.level !== xpToLevel(unpacked.xp)) return;
            const shadow = shadowPlayers.get(peerId);
            if (!checkXpRate(peerId, unpacked.xp, shadow?.xp || 0)) {
                console.warn(`[Security] XP rate exceeded for ${peerId.slice(0,8)}: ${unpacked.xp} vs ${shadow?.xp || 0}`);
                return;
            }
            if (shadow && unpacked.level > shadow.level + 1) return;

            trackPlayer(peerId, { ...entry, ...unpacked, ts: Date.now(), rawPresence: buf });
            trackShadowPlayer(peerId, unpacked);
            players.delete('ghost:' + unpacked.ph); // evict stale ghost for this identity
        };

        // Plumtree: send full payload to eager peers, lazy announcement to passive peers.
        const plumSend = (packed) => {
            const msgId = HyParView.msgId(hashStr, packed);
            hpv.markSeen(msgId);
            const eager = hpv.eagerPeers();
            const lazy = hpv.lazyPeers();
            if (eager.length) sendPresenceSingle(packed, eager);
            else sendPresenceSingle(packed); // fallback broadcast when no eager peers yet
            if (lazy.length) sendAnnounce({ msgId }, lazy);
        };

        // --- action handlers ---

        // Broadcast presence once identity is ready. If playerKeys aren't loaded yet,
        // poll until they are — the onPeerJoin handshake will handle newly-connecting peers,
        // but this covers peers already in the room when we join.
        const broadcastWhenReady = async (attempt = 0) => {
            if (!playerKeys) {
                if (attempt < 50) setTimeout(() => broadcastWhenReady(attempt + 1), 200); // max 10s
                return;
            }
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
            // We haven't seen this payload — pull it from the announcing peer.
            hpv.promote(peerId);
            sendRequest([peerId], [peerId]); // request announcing peer's presence by their ID string
        });

        getSketch(async (remoteArr, peerId) => {
            const localMs = buildSketch();
            const remoteMs = Minisketch.fromSerialized(remoteArr);
            // decode convention: removed = we have, remote doesn't; added = remote has, we don't
            const { added, removed, failure } = Minisketch.decode(localMs, remoteMs, localIds(), []);
            
            if (failure) {
                // Minisketch reconciliation failed — fallback: request full roster
                netLog(`Sketch reconciliation failed with ${peerId.slice(0, 8)}. Falling back to full request.`, '#f55');
                sendRequest(localIds().map(String), [peerId]);
                return;
            }

            if (added.length > 32 || removed.length > 32) return; // cap for safety

            // removed: we have these peers, remote doesn't — push their presences
            if (removed.length > 0) {
                const response = {};
                for (const id of localIds()) {
                    const h = Number(Minisketch.hashId(id));
                    if (!removed.some(r => r === h)) continue;
                    if (id === selfId) continue; // handled below
                    const data = players.get(id);
                    if (data?.rawPresence) {
                        response[id] = { presence: data.rawPresence, publicKey: data.publicKey };
                    }
                }
                if (removed.some(r => r === Number(Minisketch.hashId(selfId)))) {
                    const entry = await myEntry();
                    if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
                }
                if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
            }

            // added: remote has these peers, we don't — request them by sending the hash numbers
            if (added.length > 0) sendRequest(added.map(String), [peerId]);
        });

        getRequest(async (idStrings, peerId) => {
            const response = {};
            const myIdHash = Number(Minisketch.hashId(selfId));
            const matchesSelf = idStrings.some(s => {
                const n = Number(s);
                return s === selfId || (Number.isInteger(n) && n === myIdHash);
            });
            for (const [id, data] of players.entries()) {
                if (data.ghost) continue;
                const idHash = Number(Minisketch.hashId(id));
                const matches = idStrings.some(s => {
                    const n = Number(s);
                    return s === id || (Number.isInteger(n) && n === idHash);
                });
                if (matches) {
                    if (data.rawPresence) {
                        response[id] = { presence: data.rawPresence, publicKey: data.publicKey };
                    } else {
                        response[id] = { presence: packPresence(data), publicKey: data.publicKey };
                    }
                }
            }
            if (matchesSelf) {
                const entry = await myEntry();
                if (entry) response[selfId] = { presence: await packSignedPresence({ ...entry, hlc: sendHLC() }), publicKey: await exportKey(playerKeys.publicKey) };
            }
            if (Object.keys(response).length > 0) sendPresenceBatch(packPresenceBatch(response), [peerId]);
        });

        getPresenceSingle(async (buf, peerId) => {
            if (peerId === selfId) return;
            const msgId = HyParView.msgId(hashStr, buf);
            hpv.markSeen(msgId);
            await processPresenceSingle(buf, peerId);
        });

        getPresenceBatch(async (data, _) => {
            const batch = unpackPresenceBatch(data);
            for (const [id, { presence, publicKey }] of Object.entries(batch)) {
                if (id === selfId || !publicKey) continue;
                if (bans.has(publicKey)) continue;
                try {
                    const entry = players.get(id) || {};
                    if (!entry.publicKey) {
                        const ph = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
                        trackPlayer(id, { ...entry, publicKey, ph, ts: Date.now() });
                    }
                    await processPresenceSingle(presence, id);
                    hpv.onJoin(id); 
                } catch (e) { console.error(`[Net] Batch presence error:`, e); }
            }
        });

        // Commit-reveal: peer commits to a kill action before claiming XP.
        getCommit(({ seq, commit }, peerId) => {
            if (!pendingCommits.has(peerId)) pendingCommits.set(peerId, new Map());
            pendingCommits.get(peerId).set(seq, { commit, ts: Date.now() });
        });

        getReveal(async ({ seq, type, target, nonce }, peerId) => {
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            const commits = pendingCommits.get(peerId);
            const pending = commits?.get(seq);
            if (!pending) return; // no matching commit — ignore
            commits.delete(seq);

            // Verify hash: H(type|target|nonce) must match committed hash
            const revealStr = `${type}|${target}|${nonce}`;
            const expectedCommit = (hashStr(revealStr) >>> 0).toString(16).padStart(8, '0');
            if (pending.commit !== expectedCommit) {
                console.warn(`[Security] Commit-reveal mismatch for ${peerId.slice(0,8)}: seq ${seq}`);
                return;
            }

            // Verify action feed chain
            const head = feedHeads.get(peerId);
            const prevHash = head ? (hashStr(`${head.seq}:${head.hash}`) >>> 0).toString(16).padStart(8, '0') : '00000000';
            const expectedSeq = head ? head.seq + 1 : 1;
            if (seq !== expectedSeq) {
                console.warn(`[Security] Feed seq gap for ${peerId.slice(0,8)}: got ${seq}, expected ${expectedSeq}`);
                return;
            }
            const entryHash = (hashStr(`${seq}:${type}:${target}:${prevHash}`) >>> 0).toString(16).padStart(8, '0');
            feedHeads.set(peerId, { seq, hash: entryHash });
        });

        getRollupLocal((_) => {
            lastRollupReceivedAt = Date.now();
        });

        getRelay(async (data) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            if (await verifyMessage(stateStr, signature, arbiterPublicKey)) {
                updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
            }
        });

        getActionLog(async (buf, peerId) => {
            const data = unpackActionLog(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                const sigData = JSON.stringify({ type: data.type, index: data.index, target: data.target, data: data.data });
                if (!await verifyMessage(sigData, data.signature, pubKey)) return;
                let shadow = shadowPlayers.get(peerId);
                if (!shadow) shadow = { level: 1, xp: 0, inventory: [], gold: 0, actionIndex: -1 };
                trackShadowPlayer(peerId, shadow);
                if (data.index <= shadow.actionIndex) return;
                const actionEntropy = hashStr(worldState.seed + '|' + entry.publicKey + '|' + data.index);
                const rng = seededRNG(actionEntropy);
                if (data.type === 'kill') {
                    const enemyDef = ENEMIES[data.target];
                    if (enemyDef) {
                        shadow.xp += enemyDef.xp;
                        shadow.level = xpToLevel(shadow.xp);
                        const loot = rollLoot(data.target, rng);
                        shadow.inventory.push(...loot);
                        shadow.gold += rng(10);
                    }
                }
                shadow.actionIndex = data.index;
            } catch (e) { console.error('[Security] ActionLog fail:', e); }
        });

        getTradeOffer((data, peerId) => {
            log(`\n[Trade] ${data.fromName} wants to trade!`, '#ff0');
            bus.emit('trade:offer-received', { partnerId: peerId, partnerName: data.fromName, offer: data.offer });
        });

        getTradeAccept((data, peerId) => {
            bus.emit('trade:accept-received', { partnerId: peerId, offer: data.offer });
        });

        getTradeCommit(async (buf, peerId) => {
            const data = unpackTradeCommit(buf);
            bus.emit('trade:commit-received', { partnerId: peerId, commit: data });
        });

        getTradeFinal((data) => {
            const { peerA, peerB, delta } = data;
            [peerA, peerB].forEach(id => {
                const shadow = shadowPlayers.get(id);
                if (shadow) {
                    const d = delta[id];
                    shadow.gold -= (d.gives_gold || 0);
                    shadow.gold += (d.gets_gold || 0);
                    if (d.gives_items) shadow.inventory = shadow.inventory.filter(i => !d.gives_items.includes(i));
                    if (d.gets_items) shadow.inventory.push(...d.gets_items);
                }
            });
        });

        getDuelChallenge((data, peerId) => {
            if (data.target !== selfId) return;
            log(`\n[DUEL] ${data.fromName} challenges you to a duel!`, '#ff0');
            setPendingDuel({ challengerId: peerId, challengerName: data.fromName, expiresAt: Date.now() + 60000, day: worldState.day });
            bus.emit('duel:incoming', { challengerId: peerId, challengerName: data.fromName });
        });

        getDuelAccept(async (data, peerId) => {
            if (data.target !== selfId) return;
            log(`\n[DUEL] ${data.fromName} accepted your challenge! Initiating combat...`, '#0f0');
            bus.emit('duel:start', { targetId: peerId, targetName: data.fromName, day: worldState.day });
        });

        getDuelCommit(async (buf, peerId) => {
            const chan = activeChannels.get(peerId);
            if (!chan) return;
            const processCommit = async (retryCount = 0) => {
                const playerEntry = players.get(peerId);
                if (!playerEntry?.publicKey) {
                    if (retryCount < 5) setTimeout(() => processCommit(retryCount + 1), 1000);
                    else console.warn(`[Duel] Handshake timeout for ${peerId}.`);
                    return;
                }
                const { commit, signature } = unpackDuelCommit(buf);
                try {
                    const opponentPubKey = await importKey(playerEntry.publicKey, 'public');
                    if (!await verifyMessage(JSON.stringify(commit), signature, opponentPubKey)) return;
                    chan.theirHistory.push(commit);
                    bus.emit('duel:commit-received', { targetId: peerId });
                } catch (e) { console.error(`[Duel] Error processing commit from ${peerId}:`, e.message); }
            };
            await processCommit();
        });

        getMove(async (buf, peerId) => {
            const data = unpackMove(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                const sigData = JSON.stringify({ from: data.from, to: data.to, x: data.x, y: data.y, ts: data.ts });
                if (!await verifyMessage(sigData, data.signature, pubKey)) {
                    console.warn(`[Security] Invalid move signature from ${peerId}`);
                    return;
                }
                const isValidRoomJump = Object.values(world[data.from]?.exits || {}).includes(data.to);
                const isMicroMove = data.from === data.to;
                if (isMicroMove && entry.x !== undefined) {
                    const dist = Math.abs(data.x - entry.x) + Math.abs(data.y - entry.y);
                    if (dist > 1) {
                        console.warn(`[Security] Illegal micro-move jump by ${peerId}: dist=${dist}`);
                        return;
                    }
                }
                if (!isValidRoomJump && !isMicroMove) {
                    console.warn(`[Security] Illegal teleport attempt by ${peerId}: ${data.from} -> ${data.to}`);
                    if (gameActions.submitFraudProof) {
                        gameActions.submitFraudProof({
                            type: 'illegal_move',
                            proof: {
                                peerId,
                                move: { from: data.from, to: data.to, x: data.x, y: data.y, ts: data.ts },
                                signature: data.signature,
                                publicKey: entry.publicKey
                            },
                            witness: {
                                id: selfId,
                                signature: await signMessage(JSON.stringify({ disputedPeer: peerId, disputedTs: data.ts }), playerKeys.privateKey),
                                publicKey: await exportKey(playerKeys.publicKey)
                            }
                        });
                    }
                    return;
                }
                trackPlayer(peerId, { ...entry, location: data.to, x: data.x, y: data.y, ts: Date.now() });
                bus.emit('peer:move', { peerId, data });
            } catch (e) { console.error('[Security] Move validation fail:', e); }
        });

        getEmote((buf, peerId) => {
            bus.emit('peer:emote', { peerId, data: unpackEmote(buf) });
        });

        getMonsterDmg((data) => {
            const { roomId, damage } = data;
            const state = shardEnemies.get(roomId);
            if (state) {
                state.hp = Math.max(0, state.hp - damage);
                state.lastUpdate = Date.now();
                bus.emit('monster:damaged', { roomId, damage });
            }
        });

        r.onPeerJoin(async peerId => {
            knownPeers.add(peerId);
            lastPeerSeenAt = Date.now();
            hpv.onJoin(peerId);

            // Immediate targeted sketch — reconcile peer roster within ~200ms of connection.
            // Wrapped in try-catch so a sketch error never blocks the identity handshake.
            try { sendSketch(buildSketch().serialize(), [peerId]); } catch (e) {
                console.warn('[P2P] Sketch send failed on join:', e.message);
            }

            const handshake = async () => {
                if (!knownPeers.has(peerId)) return;
                // Guard: identity keys may not be ready yet (async init). Retry shortly.
                if (!playerKeys) { setTimeout(handshake, 500); return; }
                try {
                    const pubKey = await exportKey(playerKeys.publicKey);
                    sendIdentity({ publicKey: pubKey }, [peerId]);
                    const entry = await myEntry();
                    if (entry && gameActions.sendPresenceSingle) {
                        gameActions.sendPresenceSingle(entry, [peerId]);
                    }
                } catch (e) {
                    console.warn('[P2P] Handshake error:', e.message);
                }
                // Stop retrying once the remote has acknowledged us (we have their publicKey
                // AND they have ours — indicated by our presence being in their sketch).
                // Simple heuristic: stop after identity is confirmed via getIdentity reciprocation.
                if (!players.get(peerId)?.publicKey) setTimeout(handshake, 3000);
            };
            setTimeout(handshake, 100); // reduced from 500ms
        });

        getIdentity(async ({ publicKey }, peerId) => {
            if (bans.has(publicKey)) return;
            lastPeerSeenAt = Date.now();
            const entry = players.get(peerId) || {};
            const isNew = !entry.publicKey;
            const ph = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
            trackPlayer(peerId, { ...entry, publicKey, ph, ts: Date.now() });
            hpv.onJoin(peerId); // Ensure they are in the logical overlay
            if (isNew) log(`[Social] Peer ${peerId.slice(0,4)} entered the world.`, '#aaa');
            // SYN→SYN-ACK: reciprocate our identity+presence so both sides become visible
            if (isNew && playerKeys) {
                exportKey(playerKeys.publicKey).then(pubKey => {
                    sendIdentity({ publicKey: pubKey }, [peerId]);
                    return myEntry();
                }).then(e => {
                    if (e && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(e, [peerId]);
                }).catch(() => {});
            }
            const pending = _pendingPresence.get(peerId);
            if (pending) {
                _pendingPresence.delete(peerId);
                await processPresenceSingle(pending, peerId);
            }
        });

        r.onPeerLeave(peerId => {
            bus.emit('peer:leave', { peerId });
            knownPeers.delete(peerId);
            hpv.onLeave(peerId);
            evictPlayer(peerId);
            evictShadowPlayer(peerId);
            xpBuckets.delete(peerId);
            peerHlc.delete(peerId);
            feedHeads.delete(peerId);
            pendingCommits.delete(peerId);
            _pendingPresence.delete(peerId);
            const chan = activeChannels.get(peerId);
            if (chan) {
                clearTimeout(chan.timeoutId);
                activeChannels.delete(peerId);
            }
        });

        return {
            sendMove, sendEmote, sendMonsterDmg, sendPresenceSingle, sendPresenceBatch,
            sendRelay, sendRollupLocal, sendSketch, sendRequest,
            sendDuelChallenge, sendDuelAccept, sendDuelCommit,
            sendActionLog, sendTradeOffer, sendTradeAccept, sendTradeCommit, sendTradeFinal,
            sendCommit, sendReveal, plumSend, sendPresenceDelta, sendIdentity,
            processPresenceSingle,
        };
    };

    const r = setupShard(rooms.torrent);

    // Re-broadcast presence 800ms after joining — catches peers whose data channel
    // wasn't open when the initial sendPresenceSingle fired in setupShard.
    setTimeout(async () => {
        const entry = await myEntry();
        if (entry && playerKeys) {
            const pubKey = await exportKey(playerKeys.publicKey);
            r.sendIdentity({ publicKey: pubKey });
            r.plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
        }
    }, 800);

    const shardActions = {
        sendMove: async (data) => {
            const hlc = sendHLC();
            const moveData = { from: data.from, to: data.to, x: data.x || 0, y: data.y || 0, ts: hlc.wall };
            const signature = await signMessage(JSON.stringify(moveData), playerKeys.privateKey);
            r.sendMove(packMove({ ...moveData, signature }));
        },
        sendEmote: (data) => r.sendEmote(packEmote(data.text)),
        sendMonsterDmg: (data) => r.sendMonsterDmg(data),
        sendActionLog: (data) => r.sendActionLog(packActionLog(data)),
        sendPresenceSingle: (data, target) => {
            if (!playerKeys) return;
            const hlc = sendHLC();
            packSignedPresence({ ...data, hlc }).then(packed => {
                if (target) r.sendPresenceSingle(packed, target);
                else r.plumSend(packed);
            }).catch(e => console.warn('[P2P] Presence signing failed:', e.message));
        },
        sendPresenceBatch: (data, target) => {
            const packed = packPresenceBatch(data);
            target ? r.sendPresenceBatch(packed, target) : r.sendPresenceBatch(packed);
        },
        relayState: (data) => r.sendRelay(data),
        sendRollupLocal: (data) => r.sendRollupLocal(data),
        sendDuelChallenge: (data) => r.sendDuelChallenge(data),
        sendDuelAccept: (data) => r.sendDuelAccept(data),
        sendDuelCommit: (data, target) => r.sendDuelCommit(packDuelCommit({ ...data.commit, signature: data.signature }), target),
        sendTradeOffer: (data, target) => r.sendTradeOffer(data, target),
        sendTradeAccept: (data, target) => r.sendTradeAccept(data, target),
        sendTradeCommit: (data, target) => r.sendTradeCommit(packTradeCommit(data), target),
        sendTradeFinal: (data) => r.sendTradeFinal(data),
        sendSketch: (data, target) => target ? r.sendSketch(data, target) : r.sendSketch(data),
        sendRequest: (data, target) => r.sendRequest(data, target),
        sendPresenceDelta: (data, target) => target ? r.sendPresenceDelta(data, target) : r.sendPresenceDelta(data),
        processPresence: async (packed, peerId) => await r.processPresenceSingle(packed, peerId),
        // Commit-reveal: call sendCommitAction before the kill, sendRevealAction after.
        sendCommitAction: ({ seq, type, target, nonce }) => {
            const commit = (hashStr(`${type}|${target}|${nonce}`) >>> 0).toString(16).padStart(8, '0');
            r.sendCommit({ seq, commit });
        },
        sendRevealAction: (data) => r.sendReveal(data),
    };

    Object.assign(gameActions, shardActions);
    return shardActions;
};
