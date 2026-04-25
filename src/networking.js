import { joinRoom as joinTorrent, selfId } from '@trystero-p2p/torrent';
import { getShardName, hashStr, seededRNG, deriveWorldState } from './rules.js';
import { APP_ID, TORRENT_TRACKERS, STUN_SERVERS, TURN_SERVERS } from './constants.js';
import { 
    worldState, players, localPlayer, hasSyncedWithArbiter, setHasSyncedWithArbiter,
    TAB_CHANNEL, activeChannels, setPendingDuel, WORLD_STATE_KEY
} from './store.js';
import { INSTANCE_CAP } from './data.js';
import { verifyMessage, signMessage, exportKey, importKey } from './crypto.js';
import { IBLT } from './iblt.js';
import { 
    packMove, unpackMove, packEmote, unpackEmote, 
    packPresence, unpackPresence, packDuelCommit, unpackDuelCommit 
} from './packer.js';
import { arbiterPublicKey, playerKeys, myEntry } from './identity.js';
import { log, printStatus } from './ui.js';

export let gameActions = {};
export let rooms = { torrent: null };
export let globalRooms = { torrent: null };
export let knownPeers = new Set();
export let lastRollupReceivedAt = 0;
export let lastValidStatePacket = null;
export let currentInstance = 1;
export let currentRtcConfig = { iceServers: STUN_SERVERS };

const ROLLUP_INTERVAL = 10000;
const SKETCH_INTERVAL = 30000;
const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;

const buildLeafData = () => {
    const leaves = Array.from(players.entries())
        .filter(([id]) => id !== selfId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
    leaves.sort();
    return leaves;
};

export const updateSimulation = (state) => {
    if (state.type === 'ban') {
        log(`[Arbiter] Proposer banned: ${state.target.slice(0, 8)}`, '#f55');
        return;
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

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            localPlayer.forestFights = 15; // Reset daily fights
            printStatus();
        }
    }

    if (firstSync) {
        setHasSyncedWithArbiter(true);
        log(`\n[System] Connected — Day ${worldState.day}, ${worldState.mood.toUpperCase()}.`, '#0f0');
        printStatus();
    }
};

export const initNetworking = async (rtcConfig) => {
    currentRtcConfig = rtcConfig || { iceServers: STUN_SERVERS };

    const connectGlobal = async (config) => {
        if (globalRooms.torrent) globalRooms.torrent.leave();
        
        globalRooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS, rtcConfig: config }, 'global');

        const [sendRollup] = globalRooms.torrent.makeAction('rollup');
        const [sendFraud] = globalRooms.torrent.makeAction('fraud_proof');
        const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
        const [sendWorldState, getState] = globalRooms.torrent.makeAction('world_state');

        gameActions.submitRollup = (rollup) => sendRollup(rollup);
        gameActions.submitFraudProof = (proof) => sendFraud(proof);

        getState(async (data, peerId) => {
            console.log(`[Sync] Received state from ${peerId}`);
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            try {
                const valid = await verifyMessage(stateStr, signature, arbiterPublicKey);
                if (valid) {
                    console.log(`[Sync] Signature valid! Updating simulation.`);
                    lastValidStatePacket = data;
                    TAB_CHANNEL.postMessage({ type: 'state', packet: data });
                    const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
                    updateSimulation(stateObj);
                    if (isProposer()) gameActions.relayState(data);
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
    };

    await connectGlobal(currentRtcConfig);

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

    setInterval(() => {
        const iblt = new IBLT();
        players.forEach((_, id) => iblt.insert(id));
        iblt.insert(selfId);
        if (gameActions.sendSketch) gameActions.sendSketch(iblt.serialize());
    }, SKETCH_INTERVAL);
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

    const shard = getShardName(location, instanceId);
    console.log(`[P2P] Joining Shard Room: ${shard}`);
    const config = rtcConfig || currentRtcConfig;
    rooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS, rtcConfig: config }, shard);

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
        const [sendPresenceSingle, getPresenceSingle] = r.makeAction('presence_single');
        const [sendPresenceBatch, getPresenceBatch] = r.makeAction('presence_batch');
        const [sendRelay, getRelay] = r.makeAction('world_state_relay');
        const [sendRollupLocal, getRollupLocal] = r.makeAction('rollup_local');
        const [sendDuelChallenge, getDuelChallenge] = r.makeAction('duel_challenge');
        const [sendDuelAccept, getDuelAccept] = r.makeAction('duel_accept');
        const [sendDuelCommit, getDuelCommit] = r.makeAction('duel_commit');
        const [sendSketch, getSketch] = r.makeAction('presence_sketch');
        const [sendRequest, getRequest] = r.makeAction('request_presence');

        myEntry().then(entry => {
            if (entry) sendPresenceSingle(packPresence(entry));
        });

        getDuelChallenge((data, peerId) => {
            if (data.target !== selfId) return;
            log(`\n[DUEL] ${data.fromName} challenges you to a duel! Type /accept or /decline.`, '#ff0');
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
            const { commit, signature } = unpackDuelCommit(buf);
            const playerEntry = players.get(peerId);
            if (!playerEntry?.publicKey) return;
            const opponentPubKey = await importKey(playerEntry.publicKey, 'public');
            if (!await verifyMessage(JSON.stringify(commit), signature, opponentPubKey)) return;
            chan.theirHistory.push(commit);
            if (chan.myHistory.length < chan.theirHistory.length) {
                window.dispatchEvent(new CustomEvent('resolve-duel-round', { detail: { targetId: peerId } }));
            }
        });

        getSketch(async (remoteTable, peerId) => {
            const localIblt = new IBLT();
            players.forEach((_, id) => localIblt.insert(id));
            localIblt.insert(selfId);
            const remoteIblt = IBLT.fromSerialized(remoteTable);
            const diff = IBLT.subtract(localIblt, remoteIblt);
            const { added, removed, success } = diff.decode();
            if (!success) return;
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
            const unpacked = unpackPresence(buf);
            const entry = players.get(peerId) || {};
            players.set(peerId, { ...entry, ...unpacked, ts: Date.now() });
        });

        getPresenceBatch(async (data) => {
            for (const [id, { presence, publicKey }] of Object.entries(data)) {
                if (id === selfId || !publicKey) continue;
                try {
                    const unpacked = unpackPresence(presence);
                    const expectedPh = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
                    if (unpacked.ph !== expectedPh) continue;
                    const { signature, ...sigData } = unpacked;
                    const pubKey = await importKey(publicKey, 'public');
                    if (!await verifyMessage(JSON.stringify(sigData), signature, pubKey)) continue;
                    const entry = players.get(id) || {};
                    players.set(id, { ...entry, ...unpacked, ts: Date.now(), publicKey });
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

        getMove((buf, peerId) => {
            const data = unpackMove(buf);
            window.dispatchEvent(new CustomEvent('player-move', { detail: { peerId, data } }));
        });

        getEmote((buf, peerId) => {
            const data = unpackEmote(buf);
            window.dispatchEvent(new CustomEvent('player-emote', { detail: { peerId, data } }));
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
            const entry = players.get(peerId) || {};
            const isNew = !entry.publicKey;
            players.set(peerId, { ...entry, publicKey, ts: Date.now() });
            if (isNew) log(`[Social] Peer ${peerId.slice(0,4)} entered the world.`, '#aaa');
        });

        r.onPeerLeave(peerId => {
            window.dispatchEvent(new CustomEvent('player-leave', { detail: { peerId } }));
            knownPeers.delete(peerId);
            players.delete(peerId);
        });

        return { 
            sendMove, sendEmote, sendPresenceSingle, sendPresenceBatch, 
            sendRelay, sendRollupLocal, sendSketch, sendRequest, 
            sendDuelChallenge, sendDuelAccept, sendDuelCommit 
        };
    };

    const r = setupShard(rooms.torrent);

    gameActions = {
        ...gameActions,
        sendMove: (data) => r.sendMove(packMove(data.from, data.to)),
        sendEmote: (data) => r.sendEmote(packEmote(data.text)),
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
        sendSketch: (data) => r.sendSketch(data),
        sendRequest: (data, target) => r.sendRequest(data, target),
    };
};
