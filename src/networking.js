// @ts-check
import { joinRoom as joinTorrent, selfId } from './transport.js';
import { getShardName, hashStr, seededRNG, xpToLevel, rollLoot, getTimeOfDay } from './rules.js';
import { TORRENT_TRACKERS, STUN_SERVERS, TURN_SERVERS, ARBITER_URL } from './constants.js';
import { 
    worldState, localPlayer, hasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel, WORLD_STATE_KEY,
    players, shadowPlayers, shardEnemies, trackPlayer, trackShadowPlayer, bansHash, bans,
    _presenceDelta, clearPresenceDelta, evictPlayer, evictShadowPlayer
} from './store.js';
import { INSTANCE_CAP, ENEMIES, world } from './data.js';
import { verifyMessage, signMessage, exportKey, importKey } from './crypto.js';
import { Minisketch } from './minisketch.js';
import { HyParView } from './hyparview.js';
import { sendHLC, recvHLC } from './hlc.js';
import { 
    packMove, unpackMove, packEmote, unpackEmote, 
    packPresence, packDuelCommit, unpackDuelCommit,
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

// Modular Networking Components
import { 
    ROLLUP_INTERVAL, PROPOSER_GRACE_MS, NETWORK_STALL_MS, NETWORK_HEAL_COOLDOWN_MS,
    buildTorrentConfig, isUsingTurnFallback 
} from './network/config.js';
import { 
    checkXpRate, checkAndUpdateHlc, buildLeafData, clearSecurityState 
} from './network/security.js';
import { 
    buildSketch, packSignedPresence, unpackPresencePacket, seedFromSnapshot 
} from './network/presence.js';
import { updateSimulation } from './network/simulation.js';
import { 
    getCurrentInstance, setCurrentInstance, preJoinShard, getPreJoined, clearShardState 
} from './network/shard.js';

export { seedFromSnapshot, updateSimulation, preJoinShard, buildTorrentConfig, isProposer };

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
export let currentRtcConfig = { iceServers: STUN_SERVERS };
export let joinTime = Date.now();
let lastPeerSeenAt = Date.now();
let lastNetworkHealAt = 0;
let networkHealInFlight = false;

const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);

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
        globalRooms.torrent = joinTorrent(buildTorrentConfig(config), 'global');

        const [sendRollup] = globalRooms.torrent.makeAction('rollup');
        const [sendFraud] = globalRooms.torrent.makeAction('fraud_proof');
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction('world_state');
        const [sendStateRequest, getStateRequest] = globalRooms.torrent.makeAction('state_request');
        const [sendRegisterPresence] = globalRooms.torrent.makeAction('register_presence');
        gameActions.sendRegisterPresence = (data) => sendRegisterPresence(data);
        const [sendStateOffer, getStateOffer] = globalRooms.torrent.makeAction('state_offer');
        const [sendSeekingShard, getSeekingShard] = globalRooms.torrent.makeAction('seeking_shard');
        gameActions.sendSeekingShard = (shard) => sendSeekingShard(shard);
        const [sendPresenceBootstrap, getPresenceBootstrap] = globalRooms.torrent.makeAction('presence_bootstrap');

        getSeekingShard(async (shard, peerId) => {
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

        getState(async (data, peerId) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            try {
                if (await verifyMessage(stateStr, signature, arbiterPublicKey)) {
                    lastValidStatePacket = data;
                    TAB_CHANNEL.postMessage({ type: 'state', packet: data });
                    updateSimulation(typeof state === 'string' ? JSON.parse(state) : state);
                    if (isProposer() && gameActions.relayState) gameActions.relayState(data);
                }
            } catch (e) { console.error(`[Sync] Verification error:`, e); }
        });

        getIncomingRequest((_, peerId) => { if (lastValidStatePacket) sendWorldState(lastValidStatePacket, [peerId]); });

        globalRooms.torrent.onPeerJoin(peerId => {
            knownPeers.add(peerId);
            lastPeerSeenAt = Date.now();
            requestState(true, [peerId]);
            if (lastValidStatePacket) setTimeout(() => sendWorldState(lastValidStatePacket, [peerId]), 500);
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
                if (shadow.name && !shadow.name.startsWith('Peer-')) localPlayer.name = shadow.name;
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

    let isSilenced = false;
    setInterval(async () => {
        const globalPeerCount = Object.keys(globalRooms.torrent?.getPeers() || {}).length;
        const shardPeerCount = Object.keys(rooms.torrent?.getPeers() || {}).length;
        if (!isSilenced && globalPeerCount >= 5) {
            globalRooms.torrent.leave();
            isSilenced = true;
        } else if (isSilenced && shardPeerCount < 3) {
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

    const healNetworking = async () => {
        if (networkHealInFlight) return;
        const shardPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        const globalPeers = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
        const now = Date.now();
        const silentFor = now - Math.max(joinTime, lastPeerSeenAt);

        if (shardPeers > 0 || silentFor < NETWORK_STALL_MS) return;
        if (now - lastNetworkHealAt < NETWORK_HEAL_COOLDOWN_MS) return;

        networkHealInFlight = true;
        lastNetworkHealAt = now;
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
        const { createMerkleRoot } = await import('./crypto.js');
        const root = await createMerkleRoot(leafData);
        if (!root) return;
        const rollup = { shard: getShardName(localPlayer.location, getCurrentInstance()), root, timestamp: Date.now(), count: leafData.length, proposerEpoch: Math.floor(Date.now() / ROLLUP_INTERVAL) };
        const signature = await signMessage(JSON.stringify(rollup), playerKeys.privateKey);
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

export const joinInstance = async (location, instanceId, rtcConfig) => {
    if (rooms.torrent) rooms.torrent.leave();
    clearShardState(location);
    clearSecurityState();
    pendingCommits.clear();
    feedHeads.clear();
    joinTime = Date.now();
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

    const checkFull = async () => {
        const peerCount = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
        if (peerCount >= INSTANCE_CAP && instanceId < 10) {
            log(`[System] Instance ${instanceId} is full, moving to ${instanceId + 1}...`, '#aaa');
            setCurrentInstance(instanceId + 1);
            await joinInstance(location, getCurrentInstance(), rtcConfig);
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
        const [sendPresenceDelta, getPresenceDelta] = r.makeAction('presence_delta');
        const [sendAnnounce, getAnnounce] = r.makeAction('presence_announce');
        const [sendCommit, getCommit] = r.makeAction('commit_action');
        const [sendReveal, getReveal] = r.makeAction('reveal_action');

        const hpv = new HyParView();
        const _pendingPresence = new Map();

        getPresenceDelta(async ({ joined, left }) => {
            (left || []).forEach(id => { if (id !== selfId) evictPlayer(id); });
            const missing = (joined || []).filter(id => id !== selfId && !players.has(id));
            if (missing.length > 0) sendRequest(missing, [peerId]);
        });

        const localIds = () => [...Array.from(players.keys()).filter(id => !players.get(id).ghost), selfId];

        const processPresenceSingle = async (buf, peerId) => {
            if (!buf || peerId === selfId) return;
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
            } catch { return; }

            if (unpacked.hlc && !checkAndUpdateHlc(peerId, unpacked.hlc)) return;
            if (unpacked.level !== xpToLevel(unpacked.xp)) return;
            const shadow = shadowPlayers.get(peerId);
            if (!checkXpRate(peerId, unpacked.xp, shadow?.xp || 0)) return;
            if (shadow && unpacked.level > shadow.level + 1) return;

            trackPlayer(peerId, { ...entry, ...unpacked, ts: Date.now(), rawPresence: buf });
            trackShadowPlayer(peerId, unpacked);
            players.delete('ghost:' + unpacked.ph);
        };

        const plumSend = (packed) => {
            const msgId = HyParView.msgId(hashStr, packed);
            hpv.markSeen(msgId);
            const eager = hpv.eagerPeers();
            const lazy = hpv.lazyPeers();
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
            const { added, removed, failure } = Minisketch.decode(localMs, remoteMs, localIds(), []);
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
                if (matches) response[id] = { presence: data.rawPresence || packPresence(data), publicKey: data.publicKey };
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
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify({ type: data.type, index: data.index, target: data.target, data: data.data }), data.signature, pubKey)) return;
                let shadow = shadowPlayers.get(peerId) || { level: 1, xp: 0, inventory: [], gold: 0, actionIndex: -1 };
                if (data.index <= shadow.actionIndex) return;
                const rng = seededRNG(hashStr(worldState.seed + '|' + entry.publicKey + '|' + data.index));
                if (data.type === 'kill' && ENEMIES[data.target]) {
                    shadow.xp += ENEMIES[data.target].xp; shadow.level = xpToLevel(shadow.xp);
                    shadow.inventory.push(...rollLoot(data.target, rng)); shadow.gold += rng(10);
                }
                shadow.actionIndex = data.index;
                trackShadowPlayer(peerId, shadow);
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
            const data = unpackMove(buf);
            const entry = players.get(peerId);
            if (!entry?.publicKey) return;
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                if (!await verifyMessage(JSON.stringify({ from: data.from, to: data.to, x: data.x, y: data.y, ts: data.ts }), data.signature, pubKey)) return;
                if (data.from === data.to && entry.x !== undefined && (Math.abs(data.x - entry.x) + Math.abs(data.y - entry.y)) > 1) return;
                trackPlayer(peerId, { ...entry, location: data.to, x: data.x, y: data.y, ts: Date.now() });
                bus.emit('peer:move', { peerId, data });
            } catch { }
        });

        getEmote((buf, peerId) => bus.emit('peer:emote', { peerId, data: unpackEmote(buf) }));
        getMonsterDmg((data) => {
            const s = shardEnemies.get(data.roomId);
            if (s) { s.hp = Math.max(0, s.hp - data.damage); s.lastUpdate = Date.now(); bus.emit('monster:damaged', { roomId: data.roomId, damage: data.damage }); }
        });

        r.onPeerJoin(async peerId => {
            knownPeers.add(peerId); lastPeerSeenAt = Date.now(); hpv.onJoin(peerId);
            try { sendSketch(buildSketch().serialize(), [peerId]); } catch { }
            const handshake = async () => {
                if (!knownPeers.has(peerId) || !playerKeys) return;
                try {
                    sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) }, [peerId]);
                    const e = await myEntry(); if (e) sendPresenceSingle(e, [peerId]);
                } catch { }
                if (!players.get(peerId)?.publicKey) setTimeout(handshake, 3000);
            };
            setTimeout(handshake, 100);
        });

        r.onPeerLeave(peerId => {
            bus.emit('peer:leave', { peerId }); knownPeers.delete(peerId); hpv.onLeave(peerId);
            evictPlayer(peerId); evictShadowPlayer(peerId); xpBuckets.delete(peerId); peerHlc.delete(peerId);
            feedHeads.delete(peerId); pendingCommits.delete(peerId); _pendingPresence.delete(peerId);
            const c = activeChannels.get(peerId); if (c) { clearTimeout(c.timeoutId); activeChannels.delete(peerId); }
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

    setTimeout(async () => {
        const entry = await myEntry();
        if (entry && playerKeys && localPlayer.ph && localPlayer.ph !== '00000000') {
            r.sendIdentity({ publicKey: await exportKey(playerKeys.publicKey) });
            r.plumSend(await packSignedPresence({ ...entry, hlc: sendHLC() }));
        }
    }, 800);

    const shardActions = {
        sendMove: async (data) => {
            if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return;
            const moveData = { from: data.from, to: data.to, x: data.x || 0, y: data.y || 0, ts: Date.now() };
            r.sendMove(packMove({ ...moveData, signature: await signMessage(JSON.stringify(moveData), playerKeys.privateKey) }));
        },
        sendEmote: (data) => r.sendEmote(packEmote(data.text)),
        sendMonsterDmg: (data) => r.sendMonsterDmg(data),
        sendActionLog: (data) => r.sendActionLog(packActionLog(data)),
        sendPresenceSingle: (data, target) => {
            if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return;
            packSignedPresence({ ...data, hlc: sendHLC() }).then(p => { if (target) r.sendPresenceSingle(p, target); else r.plumSend(p); });
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
        sendCommitAction: ({ seq, type, target, nonce }) => r.sendCommit({ seq, commit: (hashStr(`${type}|${target}|${nonce}`) >>> 0).toString(16).padStart(8, '0') }),
        sendRevealAction: (data) => r.sendReveal(data),
    };

    Object.assign(gameActions, shardActions);
    return shardActions;
};
