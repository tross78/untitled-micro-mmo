import { joinRoom as joinTorrent, selfId } from '@trystero-p2p/torrent';
import { getShardName, hashStr, seededRNG, deriveWorldState, xpToLevel, rollLoot, validateMove, getTimeOfDay } from './rules.js';
import { APP_ID, TORRENT_TRACKERS, STUN_SERVERS, TURN_SERVERS, ARBITER_URL } from './constants.js';
import { 
    worldState, localPlayer, hasSyncedWithArbiter, setHasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel, WORLD_STATE_KEY,
    players, shadowPlayers, shardEnemies, trackPlayer, trackShadowPlayer, bansHash, setBans, bans
} from './store.js';
import { INSTANCE_CAP, ENEMIES } from './data.js';
import { verifyMessage, signMessage, exportKey, importKey } from './crypto.js';
import { IBLT } from './iblt.js';
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

const buildLeafData = () => {
    const leaves = Array.from(players.entries())
        .filter(([id]) => id !== selfId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}:${p.x || 0}:${p.y || 0}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}:${localPlayer.x || 0}:${localPlayer.y || 0}`);
    leaves.sort();
    return leaves;
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
            const iblt = new IBLT();
            players.forEach((_, id) => iblt.insert(id));
            iblt.insert(selfId);
            if (gameActions.sendSketch) gameActions.sendSketch(iblt.serialize());
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

        myEntry().then(entry => {
            if (entry) sendPresenceSingle(packPresence(entry));
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
                if (!shadow) {
                    shadow = { level: 1, xp: 0, inventory: [], gold: 0, actionIndex: -1 };
                }
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
            window.dispatchEvent(new CustomEvent('trade-offer-received', { detail: { partnerId: peerId, partnerName: data.fromName, offer: data.offer } }));
        });

        getTradeAccept((data, peerId) => {
            window.dispatchEvent(new CustomEvent('trade-accept-received', { detail: { partnerId: peerId, offer: data.offer } }));
        });

        getTradeCommit(async (buf, peerId) => {
            const data = unpackTradeCommit(buf);
            window.dispatchEvent(new CustomEvent('trade-commit-received', { detail: { partnerId: peerId, commit: data } }));
        });

        getTradeFinal((data) => {
            const { peerA, peerB, delta } = data;
            [peerA, peerB].forEach(id => {
                let shadow = shadowPlayers.get(id);
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
            window.dispatchEvent(new CustomEvent('start-duel', { detail: { targetId: peerId, targetName: data.fromName, day: worldState.day } }));
        });

        getDuelCommit(async (buf, peerId) => {
            const chan = activeChannels.get(peerId);
            if (!chan) return;

            const processCommit = async (retryCount = 0) => {
                const playerEntry = players.get(peerId);
                if (!playerEntry?.publicKey) {
                    if (retryCount < 5) {
                        console.log(`[Duel] Waiting for handshake from ${peerId}... (Retry ${retryCount + 1})`);
                        setTimeout(() => processCommit(retryCount + 1), 1000);
                    } else {
                        console.warn(`[Duel] Handshake timeout for ${peerId}.`);
                    }
                    return;
                }

                const { commit, signature } = unpackDuelCommit(buf);
                try {
                    const opponentPubKey = await importKey(playerEntry.publicKey, 'public');
                    if (!await verifyMessage(JSON.stringify(commit), signature, opponentPubKey)) {
                        console.error(`[Duel] Signature verification failed for ${peerId}`);
                        return;
                    }
                    chan.theirHistory.push(commit);
                    window.dispatchEvent(new CustomEvent('duel-commit-received', { detail: { targetId: peerId } }));
                } catch (e) {
                    console.error(`[Duel] Error processing commit from ${peerId}:`, e.message);
                }
            };

            await processCommit();
        });

        getSketch(async (remoteTable, peerId) => {
            const localIblt = new IBLT();
            players.forEach((_, id) => localIblt.insert(id));
            localIblt.insert(selfId);
            const remoteIblt = IBLT.fromSerialized(remoteTable);
            const diff = IBLT.subtract(localIblt, remoteIblt);
            const { added, removed, success } = diff.decode();
            if (!success) return;
            // Cap diff size to prevent a malicious zero-IBLT from enumerating all shard players
            if (added.length > 50 || removed.length > 50) return;
            if (removed.length > 0) sendRequest(removed.map(id => id.toString()), peerId);
            if (added.length > 0) {
                const response = {};
                for (const [id, data] of players.entries()) {
                    if (added.some(h => h === IBLT.hashId(id))) {
                        response[id] = { presence: packPresence(data), publicKey: data.publicKey };
                    }
                }
                if (added.some(h => h === IBLT.hashId(selfId))) {
                    const entry = await myEntry();
                    response[selfId] = { presence: packPresence(entry), publicKey: await exportKey(playerKeys.publicKey) };
                }
                if (Object.keys(response).length > 0) sendPresenceBatch(response, peerId);
            }
        });

        getRequest(async (idStrings, peerId) => {
            const ids = idStrings.map(s => BigInt(s));
            const response = {};
            for (const [id, data] of players.entries()) {
                if (ids.some(x => x === IBLT.hashId(id))) {
                    response[id] = { presence: packPresence(data), publicKey: data.publicKey };
                }
            }
            if (ids.some(x => x === IBLT.hashId(selfId))) {
                const entry = await myEntry();
                response[selfId] = { presence: packPresence(entry), publicKey: await exportKey(playerKeys.publicKey) };
            }
            if (Object.keys(response).length > 0) sendPresenceBatch(response, peerId);
        });

        getPresenceSingle(async (buf, peerId) => {
            if (peerId === selfId) return;
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;

            // Security: Arbiter Blacklist
            if (bans.has(entry.publicKey)) {
                players.delete(peerId);
                return;
            }

            const unpacked = unpackPresence(buf);

            // Security: verify ph is derived from the sender's known public key
            const expectedPh = (hashStr(entry.publicKey) >>> 0).toString(16).padStart(8, '0');
            if (unpacked.ph !== expectedPh) return;

            // Security: verify Ed25519 signature
            try {
                const { signature, ...sigData } = unpacked;
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify(sigData), signature, pubKey)) return;
            } catch { return; }

            // Security: shadow validation (XP/level sanity)
            const shadow = shadowPlayers.get(peerId);
            if (shadow) {
                if (unpacked.xp > shadow.xp + 100) return;
                if (unpacked.level > shadow.level + 1) return;
            }

            trackPlayer(peerId, { ...entry, ...unpacked, ts: Date.now() });
            trackShadowPlayer(peerId, unpacked);
        });

        getPresenceBatch(async (data) => {
            for (const [id, { presence, publicKey }] of Object.entries(data)) {
                if (id === selfId || !publicKey) continue;

                // Security: Arbiter Blacklist
                if (bans.has(publicKey)) continue;

                try {
                    const unpacked = unpackPresence(presence);
                    
                    // Security Check: Shadow Validation
                    const shadow = shadowPlayers.get(id);
                    if (shadow) {
                        if (unpacked.xp > shadow.xp + 100) {
                            console.warn(`[Security] Rejecting XP jump for ${id}: ${unpacked.xp} > ${shadow.xp}`);
                            continue;
                        }
                        if (unpacked.level > shadow.level + 1) {
                            console.warn(`[Security] Rejecting Level jump for ${id}: ${unpacked.level} > ${shadow.level}`);
                            continue;
                        }
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

        getRollupLocal(async (data) => {
            lastRollupReceivedAt = Date.now();
            const { rollup, signature, publicKey } = data;
            const myPubKeyB64 = await exportKey(playerKeys.publicKey);
            if (publicKey === myPubKeyB64) return;
            const proposerPubKey = await importKey(publicKey, 'public');
            if (!await verifyMessage(JSON.stringify(rollup), signature, proposerPubKey)) return;
            if (Date.now() - joinTime < 3000) return;

            const leafData = buildLeafData();
            const { createMerkleRoot } = await import('./crypto.js');
            const ourRoot = await createMerkleRoot(leafData);

            if (ourRoot !== rollup.root) {
                log(`[System] Fraud detected in instance! Submitting proof to Arbiter...`, '#f55');
                const myPresenceData = {
                    name: localPlayer.name, location: localPlayer.location, ph: localPlayer.ph,
                    level: localPlayer.level, xp: localPlayer.xp, ts: Date.now(),
                    disputedRoot: rollup.root,
                };
                const witnessSig = await signMessage(JSON.stringify(myPresenceData), playerKeys.privateKey);
                gameActions.submitFraudProof({
                    rollup: data,
                    witness: {
                        id: selfId,
                        presence: myPresenceData,
                        signature: witnessSig,
                        publicKey: await exportKey(playerKeys.publicKey),
                    }
                });
            }
        });

        getRelay(async (data) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            if (await verifyMessage(stateStr, signature, arbiterPublicKey)) {
                updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
            }
        });

        getMove(async (buf, peerId) => {
            const data = unpackMove(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;

            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                const sigData = JSON.stringify({ from: data.from, to: data.to, ts: data.ts });
                if (!await verifyMessage(sigData, data.signature, pubKey)) {
                    console.warn(`[Security] Invalid move signature from ${peerId}`);
                    return;
                }

                // Path Validation (from data.js world graph)
                const isValidRoomJump = Object.values(world[data.from]?.exits || {}).includes(data.to);
                const isMicroMove = data.from === data.to;
                
                // Enforce max 1-tile distance for micro-moves to prevent blinking
                if (isMicroMove && entry.x !== undefined) {
                    const dist = Math.abs(data.x - entry.x) + Math.abs(data.y - entry.y);
                    if (dist > 1) {
                        console.warn(`[Security] Illegal micro-move jump by ${peerId}: dist=${dist}`);
                        return;
                    }
                }

                if (!isValidRoomJump && !isMicroMove) {
                    console.warn(`[Security] Illegal teleport attempt by ${peerId}: ${data.from} -> ${data.to}`);
                    
                    // Submit Fraud Proof to Arbiter
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

                // Update peer coordinates locally
                trackPlayer(peerId, { ...entry, location: data.to, x: data.x, y: data.y, ts: Date.now() });

                window.dispatchEvent(new CustomEvent('player-move', { detail: { peerId, data } }));
            } catch (e) { console.error('[Security] Move validation fail:', e); }
        });

        getEmote((buf, peerId) => {
            const data = unpackEmote(buf);
            window.dispatchEvent(new CustomEvent('player-emote', { detail: { peerId, data } }));
        });

        getMonsterDmg((data) => {
            const { roomId, damage } = data;
            const state = shardEnemies.get(roomId);
            if (state) {
                state.hp = Math.max(0, state.hp - damage);
                state.lastUpdate = Date.now();
                window.dispatchEvent(new CustomEvent('monster-damaged', { detail: { roomId, damage } }));
            }
        });

        const [sendIdentity, getIdentity] = r.makeAction('identity_handshake');

        r.onPeerJoin(async peerId => {
            knownPeers.add(peerId);
            const handshake = async () => {
                if (!knownPeers.has(peerId) || players.get(peerId)?.publicKey) return;
                sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) }, [peerId]);
                const entry = await myEntry();
                if (entry && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry, [peerId]);
                setTimeout(handshake, 3000);
            };
            setTimeout(handshake, 500);
        });

        getIdentity(({ publicKey }, peerId) => {
            // Security: Arbiter Blacklist
            if (bans.has(publicKey)) return;

            const entry = players.get(peerId) || {};
            const isNew = !entry.publicKey;
            trackPlayer(peerId, { ...entry, publicKey, ts: Date.now() });
            if (isNew) log(`[Social] Peer ${peerId.slice(0,4)} entered the world.`, '#aaa');
        });

        r.onPeerLeave(peerId => {
            window.dispatchEvent(new CustomEvent('player-leave', { detail: { peerId } }));
            knownPeers.delete(peerId);
            players.delete(peerId);
            shadowPlayers.delete(peerId);
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
            sendActionLog, sendTradeOffer, sendTradeAccept, sendTradeCommit, sendTradeFinal
        };
    };

    const r = setupShard(rooms.torrent);

    Object.assign(gameActions, {
        sendMove: async (data) => {
            const moveData = { from: data.from, to: data.to, x: data.x || 0, y: data.y || 0, ts: Date.now() };
            const signature = await signMessage(JSON.stringify(moveData), playerKeys.privateKey);
            r.sendMove(packMove({ ...moveData, signature }));
        },
        sendEmote: (data) => r.sendEmote(packEmote(data.text)),
        sendMonsterDmg: (data) => r.sendMonsterDmg(data),
        sendActionLog: (data) => r.sendActionLog(packActionLog(data)),
        sendPresenceSingle: (data, target) => {
            const packed = packPresence(data);
            target ? r.sendPresenceSingle(packed, target) : r.sendPresenceSingle(packed);
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
        sendSketch: (data) => r.sendSketch(data),
        sendRequest: (data, target) => r.sendRequest(data, target),
    });
};
