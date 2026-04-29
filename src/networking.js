import { joinRoom as joinTorrent, selfId } from '@trystero-p2p/torrent';
import { getShardName, hashStr, seededRNG, deriveWorldState, xpToLevel, rollLoot, validateMove, getTimeOfDay } from './rules.js';
import { APP_ID, TORRENT_TRACKERS, STUN_SERVERS, TURN_SERVERS, ARBITER_URL } from './constants.js';
import { 
    worldState, localPlayer, hasSyncedWithArbiter, setHasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel, WORLD_STATE_KEY,
    players, shadowPlayers, shardEnemies, trackPlayer, trackShadowPlayer, bansHash, setBans, bans
} from './store.js';
import { INSTANCE_CAP, ENEMIES, world } from './data.js';
import { verifyMessage, signMessage, exportKey, importKey } from './crypto.js';
import { Minisketch } from './minisketch.js';
import { HyParView } from './hyparview.js';
import { sendHLC, recvHLC, cmpHLC } from './hlc.js';
import { 
    packMove, unpackMove, packEmote, unpackEmote, 
    packPresence, unpackPresence, packDuelCommit, unpackDuelCommit,
    packActionLog, unpackActionLog, packTradeCommit, unpackTradeCommit
} from './packer.js';
import { arbiterPublicKey, playerKeys, myEntry } from './identity.js';
import { log, printStatus } from './ui.js';
import { GAME_NAME } from './data.js';
import { bus } from './eventbus.js';

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

const ROLLUP_INTERVAL = 10000;
const SKETCH_INTERVAL = 30000;
const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;

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
        .filter(([id]) => id !== selfId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
    leaves.sort();
    return leaves;
};

const buildSketch = () => {
    const ms = new Minisketch(32);
    players.forEach((_, id) => ms.add(id));
    ms.add(selfId);
    return ms;
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

export const updateSimulation = (state) => {
    if (state.type === 'ban') {
        log(`[Arbiter] Proposer banned: ${state.target.slice(0, 8)}`, '#f55');
        return;
    }

    // Sync Ban List if hash mismatch
    if (state.bans && state.bans !== bansHash && ARBITER_URL) {
        fetch(`${ARBITER_URL}/bans`)
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

export const initNetworking = async (rtcConfig) => {
    currentRtcConfig = rtcConfig || { iceServers: STUN_SERVERS };

    // Deterministic Tracker Allocation: each peer only uses 2 trackers to reduce global load
    const myTrackers = [];
    if (TORRENT_TRACKERS.length > 0) {
        const seed = parseInt(selfId.slice(0, 8), 16) || 0;
        const idx1 = seed % TORRENT_TRACKERS.length;
        const idx2 = (seed + 1) % TORRENT_TRACKERS.length;
        myTrackers.push(TORRENT_TRACKERS[idx1]);
        if (idx1 !== idx2) myTrackers.push(TORRENT_TRACKERS[idx2]);
    }

    const connectGlobal = async (config) => {
        if (globalRooms.torrent) globalRooms.torrent.leave();
        
        globalRooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: myTrackers, rtcConfig: config }, 'global');

        const [sendRollup] = globalRooms.torrent.makeAction('rollup');
        const [sendFraud] = globalRooms.torrent.makeAction('fraud_proof');
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction('world_state');
        const [sendStateRequest, getStateRequest] = globalRooms.torrent.makeAction('state_request');
        const [sendStateOffer, getStateOffer] = globalRooms.torrent.makeAction('state_offer');

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
            for (const [sid, shadow] of shadowPlayers.entries()) {
                if (shadow.ph === ph) {
                    sendStateOffer(shadow, [peerId]);
                    break;
                }
            }
        });

        getStateOffer(async (shadow, peerId) => {
            if (!shadow || !shadow.signature) return;
            // Verify shadow state (must be signed by the player being rescued)
            // But wait, the shadow state we store is just the data.
            // For a proper rescue, we need the original signed presence blob.
            // Since we updated presence to include everything, 'shadow' IS the unpacked presence.
            
            // For now, let's assume if it matches our ph and the levels are higher, we consider it.
            if (shadow.ph === localPlayer.ph) {
                log(`[System] Received state rescue offer from ${peerId.slice(0, 8)}!`, '#0f0');
                // Merge logic: take higher level/xp, union items/quests
                if (shadow.xp > localPlayer.xp) {
                    localPlayer.xp = shadow.xp;
                    localPlayer.level = shadow.level;
                    localPlayer.gold = Math.max(localPlayer.gold, shadow.gold);
                    // Union inventory
                    const myInv = new Set(localPlayer.inventory);
                    shadow.inventory.forEach(i => myInv.add(i));
                    localPlayer.inventory = Array.from(myInv);
                    // Union quests
                    Object.assign(localPlayer.quests, shadow.quests);
                    log(`[System] State merged successfully.`, '#0f0');
                    saveLocalState(localPlayer, true);
                }
            }
        });
    };

    await connectGlobal(currentRtcConfig);

    // Adaptive Silence Watchdog: Leave global room if we have enough peers to reduce tracker load
    let isSilenced = false;
    setInterval(async () => {
        const peerCount = Object.keys(globalRooms.torrent?.getPeers() || {}).length;
        if (!isSilenced && peerCount >= 5) {
            netLog('Entering Adaptive Silence (leaving global room)...', '#0af');
            globalRooms.torrent.leave();
            isSilenced = true;
        } else if (isSilenced && players.size < 3) {
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

    // Fallback to TURN after 20 seconds
    setTimeout(async () => {
        const shardPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        if (!hasSyncedWithArbiter && shardPeers === 0) {
            log(`\n[System] Connection sparse. Attempting relay fallback...`, '#555');
            currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
            if (globalRooms.torrent) globalRooms.torrent.leave();
            await connectGlobal(currentRtcConfig);
            await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);
        }
    }, 20000);

    await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);

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

    // Dynamic Sketch Intervals: scale with population to prevent chatter storms
    const scheduleNextSketch = () => {
        const delay = 30000 + (players.size * 5000);
        setTimeout(() => {
            if (gameActions.sendSketch) gameActions.sendSketch(buildSketch().serialize());
            scheduleNextSketch();
        }, delay);
    };
    scheduleNextSketch();
};

export const isProposer = () => {
    const all = Array.from(players.keys()).concat(selfId).sort();
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
    shardEnemies.delete(location);
    // Clear phantom combat state — the shard is fresh, no enemy is confirmed alive yet
    localPlayer.currentEnemy = null;
    joinTime = Date.now();

    const shard = getShardName(location, instanceId);
    console.log(`[P2P] Joining Shard Room: ${shard}`);
    const config = rtcConfig || currentRtcConfig;

    // Deterministic Tracker Allocation
    const myTrackers = [];
    if (TORRENT_TRACKERS.length > 0) {
        const seed = parseInt(selfId.slice(0, 8), 16) || 0;
        const idx1 = seed % TORRENT_TRACKERS.length;
        const idx2 = (seed + 1) % TORRENT_TRACKERS.length;
        myTrackers.push(TORRENT_TRACKERS[idx1]);
        if (idx1 !== idx2) myTrackers.push(TORRENT_TRACKERS[idx2]);
    }

    rooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: myTrackers, rtcConfig: config }, shard);

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
        // Plumtree lazy-push announcements and commit-reveal wire actions
        const [sendAnnounce, getAnnounce] = r.makeAction('presence_announce');
        const [sendCommit, getCommit] = r.makeAction('commit_action');
        const [sendReveal, getReveal] = r.makeAction('reveal_action');

        // HyParView logical overlay for this shard
        const hpv = new HyParView();

        // Presence packets that arrive before the peer's public key is known
        // are queued here (keyed by peerId, one packet max — newest wins).
        const _pendingPresence = new Map();

        // --- helpers ---

        const localIds = () => [...players.keys(), selfId];

        const processPresenceSingle = async (buf, peerId) => {
            const entry = players.get(peerId);
            if (!entry?.publicKey) {
                _pendingPresence.set(peerId, buf);
                return;
            }

            if (bans.has(entry.publicKey)) {
                players.delete(peerId);
                _pendingPresence.delete(peerId);
                return;
            }

            const unpacked = unpackPresence(buf);

            // HLC causal ordering: reject stale/replayed presence
            if (unpacked.hlc && !checkAndUpdateHlc(peerId, unpacked.hlc)) return;

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
                if (!await verifyMessage(JSON.stringify(sigData), signature, pubKey)) return;
            } catch { return; }

            // Security: token bucket XP rate check
            const shadow = shadowPlayers.get(peerId);
            if (shadow) {
                if (!checkXpRate(peerId, unpacked.xp, shadow.xp)) {
                    console.warn(`[Security] XP rate exceeded for ${peerId.slice(0,8)}: ${unpacked.xp} vs ${shadow.xp}`);
                    return;
                }
                if (unpacked.level > shadow.level + 1) return;
            }

            trackPlayer(peerId, { ...entry, ...unpacked, ts: Date.now() });
            trackShadowPlayer(peerId, unpacked);
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

        myEntry().then(entry => {
            if (entry) plumSend(packPresence(entry));
        });

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
            const { added, removed } = Minisketch.decode(localMs, remoteMs, localIds(), []);
            if (added.length > 32 || removed.length > 32) return; // cap for safety

            // removed: we have these peers, remote doesn't — push their presences
            if (removed.length > 0) {
                const response = {};
                for (const id of localIds()) {
                    const h = Number(Minisketch.hashId(id));
                    if (!removed.some(r => r === h)) continue;
                    if (id === selfId) continue; // handled below
                    const data = players.get(id);
                    if (data) response[id] = { presence: packPresence(data), publicKey: data.publicKey };
                }
                if (removed.some(r => r === Number(Minisketch.hashId(selfId)))) {
                    const entry = await myEntry();
                    if (entry) response[selfId] = { presence: packPresence(entry), publicKey: await exportKey(playerKeys.publicKey) };
                }
                if (Object.keys(response).length > 0) sendPresenceBatch(response, [peerId]);
            }

            // added: remote has these peers, we don't — request them by sending the hash numbers
            if (added.length > 0) sendRequest(added.map(String), [peerId]);
        });

        getRequest(async (idStrings, peerId) => {
            // idStrings can be:
            //   - stringified uint32 hash numbers (from sketch reconciliation)
            //   - actual peer ID strings (from getAnnounce)
            // Match strategy: if the string parses to a number, match by hash; otherwise match by direct ID.
            const response = {};
            const matchesSelf = idStrings.some(s => {
                const n = Number(s);
                return s === selfId || (Number.isInteger(n) && n === Number(Minisketch.hashId(selfId)));
            });
            for (const [id, data] of players.entries()) {
                const idHash = Number(Minisketch.hashId(id));
                const matches = idStrings.some(s => {
                    const n = Number(s);
                    return s === id || (Number.isInteger(n) && n === idHash);
                });
                if (matches) response[id] = { presence: packPresence(data), publicKey: data.publicKey };
            }
            if (matchesSelf) {
                const entry = await myEntry();
                if (entry) response[selfId] = { presence: packPresence(entry), publicKey: await exportKey(playerKeys.publicKey) };
            }
            if (Object.keys(response).length > 0) sendPresenceBatch(response, [peerId]);
        });

        getPresenceSingle(async (buf, peerId) => {
            if (peerId === selfId) return;
            const msgId = HyParView.msgId(hashStr, buf);
            hpv.markSeen(msgId);
            await processPresenceSingle(buf, peerId);
        });

        getPresenceBatch(async (data) => {
            for (const [id, { presence, publicKey }] of Object.entries(data)) {
                if (id === selfId || !publicKey) continue;
                if (bans.has(publicKey)) continue;
                try {
                    const unpacked = unpackPresence(presence);

                    // HLC causal ordering
                    if (unpacked.hlc && !checkAndUpdateHlc(id, unpacked.hlc)) continue;

                    const shadow = shadowPlayers.get(id);
                    if (shadow) {
                        if (!checkXpRate(id, unpacked.xp, shadow.xp)) {
                            console.warn(`[Security] XP rate exceeded for ${id.slice(0,8)}`);
                            continue;
                        }
                        if (unpacked.level > shadow.level + 1) continue;
                    }

                    const expectedPh = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
                    if (unpacked.ph !== expectedPh) continue;
                    const { signature, ...sigData } = unpacked;
                    const pubKey = await importKey(publicKey, 'public');
                    if (!await verifyMessage(JSON.stringify(sigData), signature, pubKey)) continue;
                    const entry = players.get(id) || {};
                    trackPlayer(id, { ...entry, ...unpacked, ts: Date.now(), publicKey });
                    trackShadowPlayer(id, unpacked);
                } catch { }
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

        getRollupLocal((data) => {
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
            hpv.onJoin(peerId);

            // Immediate targeted sketch — reconcile peer roster within ~200ms of connection.
            // Wrapped in try-catch so a sketch error never blocks the identity handshake.
            try { sendSketch(buildSketch().serialize(), [peerId]); } catch (e) {
                console.warn('[P2P] Sketch send failed on join:', e.message);
            }

            const handshake = async () => {
                if (!knownPeers.has(peerId) || players.get(peerId)?.publicKey) return;
                sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) }, [peerId]);
                const entry = await myEntry();
                if (entry && gameActions.sendPresenceSingle) {
                    gameActions.sendPresenceSingle(entry, [peerId]);
                }
                setTimeout(handshake, 3000);
            };
            setTimeout(handshake, 100); // reduced from 500ms
        });

        getIdentity(({ publicKey }, peerId) => {
            if (bans.has(publicKey)) return;
            const entry = players.get(peerId) || {};
            const isNew = !entry.publicKey;
            trackPlayer(peerId, { ...entry, publicKey, ts: Date.now() });
            if (isNew) log(`[Social] Peer ${peerId.slice(0,4)} entered the world.`, '#aaa');
            const pending = _pendingPresence.get(peerId);
            if (pending) {
                _pendingPresence.delete(peerId);
                processPresenceSingle(pending, peerId);
            }
        });

        r.onPeerLeave(peerId => {
            bus.emit('peer:leave', { peerId });
            knownPeers.delete(peerId);
            hpv.onLeave(peerId);
            players.delete(peerId);
            shadowPlayers.delete(peerId);
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
            sendCommit, sendReveal, plumSend,
        };
    };

    const r = setupShard(rooms.torrent);

    // Re-broadcast presence 800ms after joining — catches peers whose data channel
    // wasn't open when the initial sendPresenceSingle fired in setupShard.
    setTimeout(async () => {
        const entry = await myEntry();
        if (entry) r.plumSend(packPresence(entry));
    }, 800);

    Object.assign(gameActions, {
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
            const hlc = sendHLC();
            const packed = packPresence({ ...data, hlc });
            if (target) r.sendPresenceSingle(packed, target);
            else r.plumSend(packed);
        },
        sendPresenceBatch: (data, target) => {
            target ? r.sendPresenceBatch(data, target) : r.sendPresenceBatch(data);
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
        // Commit-reveal: call sendCommitAction before the kill, sendRevealAction after.
        sendCommitAction: ({ seq, type, target, nonce }) => {
            const commit = (hashStr(`${type}|${target}|${nonce}`) >>> 0).toString(16).padStart(8, '0');
            r.sendCommit({ seq, commit });
        },
        sendRevealAction: (data) => r.sendReveal(data),
    });
};
