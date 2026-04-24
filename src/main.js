// Suppress Trystero's hardcoded-relay noise — can't override their defaults, but we can quiet them.
const _warn = console.warn.bind(console);
console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Trystero:')) return;
    _warn(...args);
};

import { joinRoom as joinTorrent, selfId } from '@trystero-p2p/torrent';
import {
    world, validateMove, hashStr, seededRNG,
    ENEMIES, ITEMS, DEFAULT_PLAYER_STATS,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    deriveWorldState,
    getShardName, INSTANCE_CAP,
} from './rules';
import { verifyMessage, generateKeyPair, importKey, exportKey, signMessage, computeHash } from './crypto';
import { IBLT } from './iblt';
import { packMove, unpackMove, packEmote, unpackEmote, packPresence, unpackPresence, packDuelCommit, unpackDuelCommit } from './packer';
import { MASTER_PUBLIC_KEY, APP_ID, TORRENT_TRACKERS, ICE_SERVERS } from './constants';
import { getSuggestions } from './autocomplete';

const output = document.getElementById('output');
const input = document.getElementById('input');
const suggestionsEl = document.getElementById('suggestions');

const WORLD_STATE_KEY = 'hearthwick_worldstate_v1';
const TAB_CHANNEL = new BroadcastChannel('hearthwick_state');

const log = (msg, color = '#0f0') => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = color;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
};

// --- IDENTITY ---
let playerKeys = null;
let arbiterPublicKey = null;

const initIdentity = async () => {
    try {
        arbiterPublicKey = await importKey(MASTER_PUBLIC_KEY, 'public');
        const savedKeys = localStorage.getItem('hearthwick_keys_v3');
        if (savedKeys) {
            const { publicKey, privateKey } = JSON.parse(savedKeys);
            playerKeys = {
                publicKey: await importKey(publicKey, 'public'),
                privateKey: await importKey(privateKey, 'private')
            };
        } else {
            const keys = await generateKeyPair();
            const exported = {
                publicKey: await exportKey(keys.publicKey),
                privateKey: await exportKey(keys.privateKey)
            };
            localStorage.setItem('hearthwick_keys_v3', JSON.stringify(exported));
            playerKeys = keys;
            log(`[System] New identity generated.`);
        }
        const exported = JSON.parse(localStorage.getItem('hearthwick_keys_v3'));
        localPlayer.ph = pidHash(exported.publicKey);
    } catch (e) {
        console.error('Identity Init Failed', e);
        throw e;
    }
};

// --- STATE ---
let worldState = { seed: '', day: 0, mood: '', season: '', seasonNumber: 1, threatLevel: 0, scarcity: [], lastTick: 0 };
const players = new Map(); // id -> {name, location, ph, level, xp, ts}
let news = [];

// --- PVP STATE CHANNELS ---
let pendingDuel = null; // { challengerId, challengerName, expiresAt, day }
const activeChannels = new Map(); // targetId -> { opponentName, lastCommit, myHistory, theirHistory }
const DUEL_TIMEOUT_MS = 60000;

const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Day: ${worldState.day}  Season: ${worldState.season ? worldState.season.toUpperCase() + ' (Year ' + worldState.seasonNumber + ')' : 'Unknown'}`, '#ffa500');
    log(`Town Mood: ${worldState.mood ? worldState.mood.toUpperCase() : 'UNKNOWN'}`, '#ffa500');
    log(`Threat Level: ${worldState.threatLevel}`, '#ffa500');
    if (worldState.scarcity.length > 0) log(`Scarce Goods: ${worldState.scarcity.join(', ')}`, '#f55');

    if (worldState.lastTick) {
        const nextTick = worldState.lastTick + 86400000;
        const diff = nextTick - Date.now();
        if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            log(`Next day in ${h}h ${m}m`, '#ffa500');
        }
    }
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};

const updateSimulation = (state) => {
    if (state.type === 'ban') {
        log(`[Arbiter] Proposer banned: ${state.target.slice(0, 8)}`, '#f55');
        return;
    }

    const newSeed = state.world_seed;
    const newDay = state.day || 1;
    const newTick = state.last_tick || 0;

    if (newSeed !== worldState.seed || newDay !== worldState.day || newTick !== worldState.lastTick) {
        const wasDisconnected = worldState.day === 0;
        const isNewDay = newDay > worldState.day && !wasDisconnected;
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

        if (wasDisconnected) {
            log(`\n[System] Connected — Day ${worldState.day}, ${worldState.mood.toUpperCase()}.`, '#aaa');
            printStatus();
        } else if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            printStatus();
        }
    }
};

// --- PLAYER UTILS ---
const pidHash = (playerId) => playerId ? (hashStr(playerId) >>> 0).toString(16).padStart(8, '0') : null;
const getTag = (ph) => ph ? ph.slice(0, 4) : '????';
const getPlayerName = (id) => {
    const entry = players.get(id);
    if (!entry) return `Peer-${id.slice(0, 4)}`;
    const name = entry.name || `Peer-${id.slice(0, 4)}`;
    const tag = entry.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};
const getPlayerLocation = (id) => players.get(id)?.location;
const getPlayerEntry = (id) => players.get(id);

let localPlayer = { name: `Peer-${selfId.slice(0, 4)}`, location: 'cellar', ...DEFAULT_PLAYER_STATS };

// --- PERSISTENCE ---
const STORAGE_KEY = 'hearthwick_state_v5';
const HEARTBEAT_MS = 30000;
const PRESENCE_TTL = 90000;

const myEntry = async () => {
    const data = { 
        name: localPlayer.name, 
        location: localPlayer.location, 
        ph: localPlayer.ph, 
        level: localPlayer.level, 
        xp: localPlayer.xp,
        ts: Date.now() 
    };
    const signature = await signMessage(JSON.stringify(data), playerKeys.privateKey);
    return { ...data, signature };
};

const loadLocalState = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            Object.assign(localPlayer, data);
            log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) { console.error(e); }
    }
    const cachedWorld = localStorage.getItem(WORLD_STATE_KEY);
    if (cachedWorld) {
        try {
            const { seed, day, lastTick } = JSON.parse(cachedWorld);
            worldState.seed = seed;
            worldState.day = day;
            worldState.lastTick = lastTick;
            const derived = deriveWorldState(seed, day);
            worldState.mood = derived.mood;
            worldState.season = derived.season;
            worldState.seasonNumber = derived.seasonNumber;
            worldState.threatLevel = derived.threatLevel;
            worldState.scarcity = derived.scarcity;
        } catch (e) { console.error(e); }
    }
};
const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
};

const pruneStale = () => {
    const cutoff = Date.now() - PRESENCE_TTL;
    players.forEach((entry, id) => {
        if (id !== selfId && entry.ts < cutoff) players.delete(id);
    });
};

// --- NETWORKING ---
const ROLLUP_INTERVAL = 10000;
const SKETCH_INTERVAL = 30000;
const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;
let currentInstance = 1;
let rooms = { torrent: null };
let globalRooms = { torrent: null };
let knownPeers = new Set();
let gameActions = {};
let lastRollupReceivedAt = 0;
let lastValidStatePacket = null;

const initNetworking = () => {
    const rtcConfig = { iceServers: ICE_SERVERS };

    // Global room is ONLY for Arbiter state
    globalRooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS, rtcConfig }, 'global');

    const [sendRollup] = globalRooms.torrent.makeAction('rollup');
    const [sendFraud] = globalRooms.torrent.makeAction('fraud_proof');
    const [requestState, getIncomingRequest] = globalRooms.torrent.makeAction('request_state');
    const [sendWorldState, getState] = globalRooms.torrent.makeAction('world_state');

    getState(async (data) => {
        const { state, signature } = data;
        const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
        const valid = await verifyMessage(stateStr, signature, arbiterPublicKey).catch(e => { log(`[Debug] verifyMessage error: ${e.message}`, '#f55'); return false; });
        if (valid) {
            lastValidStatePacket = data;
            TAB_CHANNEL.postMessage({ type: 'state', packet: data });
            const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
            updateSimulation(stateObj);
            if (isProposer()) gameActions.relayState(data);
        } else {
            log(`[Debug] Arbiter state received but signature invalid — check MASTER_PUBLIC_KEY`, '#f55');
        }
    });

    // Any peer with valid state responds to request_state — not just the proposer or arbiter
    getIncomingRequest((_, peerId) => {
        if (lastValidStatePacket) sendWorldState(lastValidStatePacket, [peerId]);
    });

    globalRooms.torrent.onPeerJoin(peerId => {
        log(`[System] Peer discovery in progress...`, '#555');
        requestState(true, [peerId]);
        if (lastValidStatePacket) sendWorldState(lastValidStatePacket, [peerId]);
    });

    // Exponential backoff retry: 1s, 2s, 4s, 8s, then cap at 10s
    const RETRY_DELAYS = [1000, 2000, 4000, 8000];
    let retryIndex = 0;
    const scheduleRetry = () => {
        if (worldState.day !== 0) return;
        const delay = RETRY_DELAYS[retryIndex] ?? 10000;
        retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS.length);
        setTimeout(() => {
            if (worldState.day === 0) {
                requestState(true);
                scheduleRetry();
            }
        }, delay);
    };
    scheduleRetry();

    gameActions.submitRollup = (rollup) => sendRollup(rollup);
    gameActions.submitFraudProof = (proof) => sendFraud(proof);

    joinInstance(localPlayer.location, currentInstance);

    // Periodic Rollups & Sketching — createMerkleRoot lazy-imported so non-proposers pay no cost
    setInterval(async () => {
        if (!isProposer()) return;
        const leafData = Array.from(players.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
        leafData.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
        leafData.sort();

        const { createMerkleRoot } = await import('./crypto');
        const root = await createMerkleRoot(leafData);
        if (!root) return;

        const proposerEpoch = Math.floor(Date.now() / ROLLUP_INTERVAL);
        const rollup = {
            shard: getShardName(APP_ID, localPlayer.location, currentInstance),
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
        gameActions.sendSketch(iblt.serialize());
    }, SKETCH_INTERVAL);
};

const isProposer = () => {
    const all = Array.from(players.keys()).concat(selfId).sort();
    const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
    if (all[slot] === selfId) return true;
    // Fallback: if the elected peer missed their window, next in sorted order steps up
    if (Date.now() - lastRollupReceivedAt > PROPOSER_GRACE_MS) {
        return all[(slot + 1) % all.length] === selfId;
    }
    return false;
};

const joinInstance = (location, instanceId) => {
    if (rooms.torrent) rooms.torrent.leave();

    const shard = getShardName(APP_ID, location, instanceId);
    const rtcConfig = { iceServers: ICE_SERVERS };
    rooms.torrent = joinTorrent({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS, rtcConfig }, shard);

    const checkFull = () => {
        const peerCount = Object.keys(rooms.torrent.getPeers()).length;
        if (peerCount >= INSTANCE_CAP && instanceId < 10) {
            log(`[System] Instance ${instanceId} is full, moving to ${instanceId + 1}...`, '#aaa');
            currentInstance = instanceId + 1;
            joinInstance(location, currentInstance);
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

        // Immediate presence broadcast when joining shard
        myEntry().then(entry => {
            const packed = packPresence(entry);
            sendPresenceSingle(packed);
        });

        getDuelChallenge((data, peerId) => {
            if (data.target !== selfId) return;
            log(`\n[DUEL] ${data.fromName} challenges you to a duel! Type /accept or /decline.`, '#ff0');
            pendingDuel = { challengerId: peerId, challengerName: data.fromName, expiresAt: Date.now() + DUEL_TIMEOUT_MS, day: worldState.day };
        });

        getDuelAccept(async (data, peerId) => {
            if (data.target !== selfId) return;
            log(`\n[DUEL] ${data.fromName} accepted your challenge! Initiating combat...`, '#0f0');
            startStateChannel(peerId, data.fromName, worldState.day);
        });

        getDuelCommit(async (buf, peerId) => {
            const chan = activeChannels.get(peerId);
            if (!chan) return;
            const { commit, signature } = unpackDuelCommit(buf);
            const playerEntry = getPlayerEntry(peerId);
            if (!playerEntry?.publicKey) {
                log(`[System] No public key on record for opponent. Channel corrupted.`, '#f55');
                activeChannels.delete(peerId);
                return;
            }
            const opponentPubKey = await importKey(playerEntry.publicKey, 'public');
            if (!await verifyMessage(JSON.stringify(commit), signature, opponentPubKey)) {
                log(`[System] Invalid signature from opponent. Channel corrupted.`, '#f55');
                activeChannels.delete(peerId);
                return;
            }
            chan.theirHistory.push(commit);
            if (chan.myHistory.length < chan.theirHistory.length) await resolveRound(peerId);
        });

        getSketch(async (remoteTable, peerId) => {
            const localIblt = new IBLT();
            players.forEach((_, id) => localIblt.insert(id));
            localIblt.insert(selfId);
            const remoteIblt = IBLT.fromSerialized(remoteTable);
            const diff = IBLT.subtract(localIblt, remoteIblt);
            const { added, removed, success } = diff.decode();
            // JSON can't handle BigInt, convert to string for the wire
            if (success && removed.length > 0) sendRequest(removed.map(id => id.toString()), peerId);
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

        getPresenceSingle((buf, peerId) => {
            players.set(peerId, { ...unpackPresence(buf), ts: Date.now() });
        });

        getPresenceBatch((data) => {
            Object.entries(data).forEach(([id, { presence, publicKey }]) => {
                if (id !== selfId) {
                    players.set(id, { ...unpackPresence(presence), ts: Date.now(), publicKey });
                }
            });
        });

        getRollupLocal(async (data) => {
            lastRollupReceivedAt = Date.now();
            const { rollup, signature, publicKey } = data;
            const proposerPubKey = await importKey(publicKey, 'public');
            if (!await verifyMessage(JSON.stringify(rollup), signature, proposerPubKey)) return;
            const leafData = Array.from(players.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
            leafData.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
            leafData.sort();
            const { createMerkleRoot } = await import('./crypto');
            const ourRoot = await createMerkleRoot(leafData);
            if (ourRoot !== rollup.root) {
                log(`[System] Fraud detected in instance! Submitting proof to Arbiter...`, '#f55');
                // O(1) witness: just submit our own signed presence as proof
                const myPresenceData = {
                    name: localPlayer.name, location: localPlayer.location, ph: localPlayer.ph,
                    level: localPlayer.level, xp: localPlayer.xp, ts: Date.now()
                };
                const witnessSig = await signMessage(JSON.stringify(myPresenceData), playerKeys.privateKey);
                const proof = {
                    rollup: data,
                    witness: {
                        id: selfId,
                        presence: myPresenceData,
                        signature: witnessSig,
                        publicKey: await exportKey(playerKeys.publicKey),
                    }
                };
                gameActions.submitFraudProof(proof);
            }
        });

        getRelay(async (data) => {
            const { state, signature } = data;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            if (await verifyMessage(stateStr, signature, arbiterPublicKey)) {
                const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
                updateSimulation(stateObj);
            }
        });

        getMove((buf, peerId) => {
            const data = unpackMove(buf);
            const name = getPlayerName(peerId);
            if (data.to === localPlayer.location) {
                const fromDir = Object.entries(world[data.to]?.exits || {}).find(([, dest]) => dest === data.from)?.[0];
                log(`[System] ${name} arrives${fromDir ? ' from the ' + fromDir : ''}.`, '#aaa');
                handleCommand('look');
            } else if (data.from === localPlayer.location) {
                const toDir = Object.entries(world[data.from]?.exits || {}).find(([, dest]) => dest === data.to)?.[0];
                log(`[System] ${name} leaves${toDir ? ' to the ' + toDir : ''}.`, '#aaa');
            }
        });

        getEmote((buf, peerId) => {
            const data = unpackEmote(buf);
            log(`[System] ${getPlayerName(peerId)} ${data.text}`, '#aaa');
        });

        r.onPeerJoin(async peerId => {
            knownPeers.add(peerId);
            gameActions.sendPresenceSingle(await myEntry(), peerId);
        });
        r.onPeerLeave(peerId => {
            knownPeers.delete(peerId);
            players.delete(peerId);
        });

        return { sendMove, sendEmote, sendPresenceSingle, sendPresenceBatch, sendRelay, sendRollupLocal, sendSketch, sendRequest, sendDuelChallenge, sendDuelAccept, sendDuelCommit };
    };

    const r = setupShard(rooms.torrent);

    gameActions = {
        ...gameActions,
        sendMove: (data) => { r.sendMove(packMove(data.from, data.to)); },
        sendEmote: (data) => { r.sendEmote(packEmote(data.text)); },
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

// --- CROSS-TAB BOOTSTRAP ---
// Any tab that already has valid arbiter state responds immediately to newly opened tabs,
// cutting bootstrap to zero round-trips when another tab is open.
TAB_CHANNEL.onmessage = ({ data }) => {
    if (data.type === 'request_state' && lastValidStatePacket) {
        TAB_CHANNEL.postMessage({ type: 'state', packet: lastValidStatePacket });
    }
    if (data.type === 'state' && worldState.day === 0) {
        verifyMessage(
            typeof data.packet.state === 'string' ? data.packet.state : JSON.stringify(data.packet.state),
            data.packet.signature,
            arbiterPublicKey
        ).then(valid => {
            if (!valid) return;
            lastValidStatePacket = data.packet;
            const stateObj = typeof data.packet.state === 'string' ? JSON.parse(data.packet.state) : data.packet.state;
            updateSimulation(stateObj);
        }).catch(() => {});
    }
};

// --- MAIN ---
const start = async () => {
    try {
        await initIdentity();
        loadLocalState();

        // Ask other open tabs for state before touching the network
        TAB_CHANNEL.postMessage({ type: 'request_state' });

        initNetworking();

        setInterval(async () => { gameActions.sendPresenceSingle(await myEntry()); }, HEARTBEAT_MS);
        setInterval(pruneStale, HEARTBEAT_MS);

        log(`\nWelcome to Hearthwick.`);
        log(`Your Peer ID: ${selfId}`);
        log(`[System] Connecting to the world...`, '#aaa');

        setTimeout(() => {
            log(`${world[localPlayer.location].name}`);
            log(world[localPlayer.location].description);
        }, 1000);

        // --- AUTOCOMPLETE ---
        const getAutoCompleteContext = () => ({
            inventory: localPlayer.inventory,
            location: localPlayer.location,
            world,
            players,
            ITEMS,
        });

        let currentSuggestions = [];
        let activeSuggestionIdx = -1;

        const renderSuggestions = (suggestions) => {
            currentSuggestions = suggestions;
            activeSuggestionIdx = -1;
            suggestionsEl.innerHTML = '';
            suggestions.forEach((s, i) => {
                const chip = document.createElement('button');
                chip.className = 'chip' + (s.immediate ? ' immediate' : '');
                chip.textContent = s.display;
                chip.addEventListener('click', () => selectSuggestion(i));
                suggestionsEl.appendChild(chip);
            });
        };

        const selectSuggestion = (idx) => {
            const s = currentSuggestions[idx];
            if (!s) return;
            if (s.immediate) {
                log(`> ${s.fill}`, '#555');
                handleCommand(s.fill);
                input.value = '';
                renderSuggestions([]);
            } else {
                input.value = s.fill;
                input.focus();
                renderSuggestions(getSuggestions(s.fill, getAutoCompleteContext()));
            }
        };

        const submitCommand = (raw) => {
            const val = raw.trim();
            if (!val) return;
            handleCommand(val.startsWith('/') ? val.slice(1) : val);
        };

        // --- INPUT EVENTS ---
        const inputHistory = [];
        let historyIdx = -1;

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (historyIdx < inputHistory.length - 1) {
                    historyIdx++;
                    input.value = inputHistory[historyIdx];
                    renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIdx > 0) { historyIdx--; input.value = inputHistory[historyIdx]; }
                else { historyIdx = -1; input.value = ''; }
                renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (currentSuggestions.length === 0) return;
                activeSuggestionIdx = (activeSuggestionIdx + 1) % currentSuggestions.length;
                // Highlight active chip
                suggestionsEl.querySelectorAll('.chip').forEach((el, i) =>
                    el.classList.toggle('active', i === activeSuggestionIdx)
                );
                // Fill input with the active suggestion (don't submit yet)
                input.value = currentSuggestions[activeSuggestionIdx].fill;
            } else if (e.key === 'Enter') {
                const val = input.value.trim();
                if (!val) return;
                // If a chip is Tab-selected and it's immediate, submit it
                if (activeSuggestionIdx >= 0 && currentSuggestions[activeSuggestionIdx]?.immediate) {
                    selectSuggestion(activeSuggestionIdx);
                } else {
                    if (val !== inputHistory[0]) { inputHistory.unshift(val); if (inputHistory.length > 50) inputHistory.pop(); }
                    historyIdx = -1;
                    submitCommand(val);
                    input.value = '';
                    renderSuggestions([]);
                }
            }
        });

        input.addEventListener('input', () => {
            historyIdx = -1;
            renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
        });

        // --- QUICK-ACTION BAR ---
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                log(`> ${cmd}`, '#555');
                handleCommand(cmd);
            });
        });

        // --- MOBILE KEYBOARD / VIEWPORT HANDLING ---
        // visualViewport fires reliably when the on-screen keyboard opens on iOS.
        // Without this, the input bar can hide behind the keyboard.
        if (window.visualViewport) {
            const onViewportChange = () => {
                // 100dvh handles this on modern browsers, but this is a belt-and-suspenders
                // fallback for older iOS where dvh isn't supported.
                document.body.style.height = window.visualViewport.height + 'px';
                output.scrollTop = output.scrollHeight;
            };
            window.visualViewport.addEventListener('resize', onViewportChange);
            window.visualViewport.addEventListener('scroll', onViewportChange);
        }

    } catch (err) { log(`[FATAL] Engine crash: ${err.message}`, '#f00'); }
};

async function startStateChannel(targetId, targetName, day) {
    activeChannels.set(targetId, {
        opponentName: targetName,
        day,
        round: 0,
        myHistory: [],
        theirHistory: []
    });
    await resolveRound(targetId);
}

async function resolveRound(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    chan.round++;
    const seed = hashStr(selfId + targetId + chan.day + chan.round);
    const rng = seededRNG(seed);
    
    const myBonus = levelBonus(localPlayer.level);
    const myAtk = localPlayer.attack + myBonus.attack;
    
    const opponent = getPlayerEntry(targetId);
    const opBonus = levelBonus(opponent?.level || 1);
    const opDef = (opponent?.defense ?? DEFAULT_PLAYER_STATS.defense) + opBonus.defense;

    const dmg = resolveAttack(myAtk, opDef, rng);

    const commit = { round: chan.round, dmg, day: chan.day };
    const signature = await signMessage(JSON.stringify(commit), playerKeys.privateKey);
    chan.myHistory.push(commit);
    
    gameActions.sendDuelCommit({ commit, signature }, targetId);

    if (chan.round >= 3) {
        let totalMyDmg = chan.myHistory.reduce((a, b) => a + b.dmg, 0);
        let totalTheirDmg = chan.theirHistory.reduce((a, b) => a + b.dmg, 0);
        
        log(`\n--- DUEL RESULT vs ${chan.opponentName} ---`, '#ff0');
        log(`You dealt: ${totalMyDmg} | Opponent dealt: ${totalTheirDmg}`, '#aaa');
        
        if (totalMyDmg > totalTheirDmg) {
            log(`You WIN! (+10 XP)`, '#0f0');
            localPlayer.xp += 10;
        } else if (totalMyDmg < totalTheirDmg) {
            log(`You LOSE.`, '#f55');
        } else {
            log(`It's a DRAW.`, '#aaa');
        }
        activeChannels.delete(targetId);
        saveLocalState();
    }
}

function handleCommand(cmd) {
    const args = cmd.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case 'help':
            log('--- Movement: /look, /move <dir>, /map', '#ffa500');
            log('--- Combat:   /attack, /rest, /stats, /inventory, /use <item>', '#ffa500');
            log('--- Social:   /who, /wave, /bow, /cheer, /duel <name>, /accept, /decline', '#ffa500');
            log('--- World:    /status, /rename <name>, /clear', '#ffa500');
            break;

        case 'duel': {
            const targetName = args.slice(1).join(' ').toLowerCase();
            if (!targetName) { log(`Usage: /duel <name>`); break; }
            const targetId = Array.from(players.keys()).find(id => getPlayerName(id).toLowerCase().includes(targetName));
            if (!targetId) { log(`Player not found.`); break; }
            log(`[DUEL] Challenging ${getPlayerName(targetId)}...`, '#ff0');
            gameActions.sendDuelChallenge({ target: targetId, fromName: localPlayer.name });
            break;
        }

        case 'accept': {
            if (!pendingDuel || Date.now() > pendingDuel.expiresAt) { log(`No pending challenge.`); break; }
            log(`[DUEL] Accepting challenge from ${pendingDuel.challengerName}...`, '#0f0');
            gameActions.sendDuelAccept({ target: pendingDuel.challengerId, fromName: localPlayer.name });
            startStateChannel(pendingDuel.challengerId, pendingDuel.challengerName, pendingDuel.day);
            pendingDuel = null;
            break;
        }

        case 'decline': {
            log(`[DUEL] Challenge declined.`);
            pendingDuel = null;
            break;
        }

        case 'who': {
            const allPeers = Array.from(players.keys());
            const peerList = allPeers.map(id => {
                const name = getPlayerName(id);
                const loc = getPlayerLocation(id);
                return loc ? `${name} (${loc})` : name;
            });
            const myTag = getTag(localPlayer.ph);
            const peersStr = peerList.length > 0 ? `, ${peerList.join(', ')}` : '';
            log(`In world (${allPeers.length + 1}): You — ${localPlayer.name}#${myTag} (${localPlayer.location})${peersStr}`);
            break;
        }

        case 'look': {
            const loc = world[localPlayer.location];
            log(`\n${loc.name}`);
            log(loc.description);
            if (loc.enemy && localPlayer.currentEnemy) {
                log(`A wounded ${ENEMIES[loc.enemy].name} is here! (HP: ${localPlayer.currentEnemy.hp})`, '#f55');
            } else if (loc.enemy) {
                log(`A ${ENEMIES[loc.enemy].name} lurks here. Type /attack to engage.`, '#f55');
            }
            const here = Array.from(players.keys()).filter(id => players.get(id).location === localPlayer.location);
            if (here.length > 0) log(`Also here: ${here.map(getPlayerName).join(', ')}`, '#aaa');
            const exits = Object.keys(loc.exits).join(', ');
            log(`Exits: ${exits}`, '#555');
            break;
        }

        case 'status':
            printStatus();
            break;

        case 'score': {
            const list = Array.from(players.values());
            list.push({ name: localPlayer.name, level: localPlayer.level, xp: localPlayer.xp, ph: localPlayer.ph });
            list.sort((a, b) => b.level - a.level || b.xp - a.xp);
            log(`\n--- TOP ADVENTURERS ---`, '#ffa500');
            list.slice(0, 10).forEach((p, i) => {
                log(`${i + 1}. ${p.name}#${getTag(p.ph)} - Level ${p.level} (${p.xp} XP)`, '#ffa500');
            });
            log(`-----------------------\n`, '#ffa500');
            break;
        }

        case 'stats': {
            const bonus = levelBonus(localPlayer.level);
            const maxHp = localPlayer.maxHp + bonus.maxHp;
            const hpPct = localPlayer.hp / maxHp;
            const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
            const xpForLevel = (l) => (l - 1) ** 2 * 10;
            const xpNeeded = xpForLevel(localPlayer.level + 1) - localPlayer.xp;
            log(`\n--- ${localPlayer.name.toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp} (${xpNeeded} to next level)`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${maxHp}`, hpColor);
            log(`Attack: ${localPlayer.attack + bonus.attack}  Defense: ${localPlayer.defense + bonus.defense}`, '#ffa500');
            log(`Gold: ${localPlayer.gold}`, '#ffa500');
            break;
        }

        case 'inventory': {
            if (localPlayer.inventory.length === 0) log(`Your pack is empty.`);
            else {
                log(`\nInventory:`, '#ffa500');
                localPlayer.inventory.forEach(id => log(`  - ${ITEMS[id]?.name || id}`, '#ffa500'));
            }
            break;
        }

        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { log(`There is nothing to fight here.`); break; }
            const enemyDef = ENEMIES[loc.enemy];
            if (!localPlayer.currentEnemy) {
                localPlayer.currentEnemy = { type: loc.enemy, hp: enemyDef.hp };
                log(`\nA ${enemyDef.name} snarls and lunges!`, '#f55');
            }
            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound);
            localPlayer.combatRound++;
            const rng = seededRNG(combatSeed);
            const bonus = levelBonus(localPlayer.level);
            const playerDmg = resolveAttack(localPlayer.attack + bonus.attack, enemyDef.defense, rng);
            const enemyDmg = resolveAttack(enemyDef.attack, localPlayer.defense + bonus.defense, rng);
            localPlayer.currentEnemy.hp -= playerDmg;
            localPlayer.hp -= enemyDmg;
            log(`You hit the ${enemyDef.name} for ${playerDmg}. (Enemy HP: ${Math.max(0, localPlayer.currentEnemy.hp)}/${enemyDef.hp})`, '#0f0');
            log(`The ${enemyDef.name} hits you for ${enemyDmg}. (Your HP: ${Math.max(0, localPlayer.hp)}/${localPlayer.maxHp + bonus.maxHp})`, '#f55');

            if (localPlayer.currentEnemy.hp <= 0) {
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                const newLevel = xpToLevel(localPlayer.xp);
                loot.forEach(itemId => {
                    if (ITEMS[itemId]?.type === 'gold') localPlayer.gold += ITEMS[itemId].amount;
                    else localPlayer.inventory.push(itemId);
                });
                log(`\nYou defeated the ${enemyDef.name}! (+${enemyDef.xp} XP)`, '#ff0');
                if (loot.length > 0) log(`Loot: ${loot.map(i => ITEMS[i]?.name || i).join(', ')}`, '#ff0');
                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    log(`LEVEL UP! You are now level ${localPlayer.level}!`, '#ff0');
                }
                localPlayer.currentEnemy = null;
            }
            if (localPlayer.hp <= 0) {
                log(`\nYou have been slain!`, '#f00');
                localPlayer.hp = Math.floor((localPlayer.maxHp + levelBonus(localPlayer.level).maxHp) / 2);
                localPlayer.location = 'cellar';
                localPlayer.currentEnemy = null;
                log(`You wake in the cellar...`, '#aaa');
                handleCommand('look');
            }
            saveLocalState();
            break;
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { log(`You can't rest mid-combat!`); break; }
            const bonus = levelBonus(localPlayer.level);
            const cap = localPlayer.maxHp + bonus.maxHp;
            const healed = Math.min(10, cap - localPlayer.hp);
            localPlayer.hp += healed;
            log(`You rest and recover ${healed} HP. (HP: ${localPlayer.hp}/${cap})`, '#0f0');
            saveLocalState();
            break;
        }

        case 'use': {
            const query = args.slice(1).join(' ').toLowerCase();
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { log(`You don't have "${query}".`); break; }
            const item = ITEMS[localPlayer.inventory[idx]];
            if (item?.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                localPlayer.hp = Math.min(localPlayer.maxHp + bonus.maxHp, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                log(`You use the ${item.name} and recover ${item.heal} HP.`, '#0f0');
                saveLocalState();
            } else log(`You can't use that.`);
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { log(`Usage: /rename <name>`); break; }
            localPlayer.name = newName;
            saveLocalState();
            log(`[System] You are now known as ${newName}`);
            break;
        }

        case 'move': {
            const dir = args[1];
            const nextLoc = validateMove(localPlayer.location, dir);
            if (nextLoc) {
                if (localPlayer.currentEnemy) { log(`You can't flee!`); break; }
                const prevLoc = localPlayer.location;
                localPlayer.location = nextLoc;
                saveLocalState();
                log(`You move ${dir}.`);
                handleCommand('look');
                gameActions.sendMove({ from: prevLoc, to: nextLoc });
                joinInstance(nextLoc, currentInstance);
            } else log(`You can't go that way.`);
            break;
        }

        case 'map': {
            const loc = localPlayer.location;
            const m = (id) => (loc === id ? '[YOU]' : ' [ ] ');
            log(`\n--- WORLD MAP ---`, '#aaa');
            log(`      ${m('tavern')}--${m('market')}`, '#aaa');
            log(`         |`, '#aaa');
            log(`      ${m('hallway')}--${m('forest_edge')}--${m('ruins')}`, '#aaa');
            log(`         |          |`, '#aaa');
            log(`      ${m('cellar')}     ${m('cave')}`, '#aaa');
            log(`-----------------\n`, '#aaa');
            break;
        }

        case 'clear':
            output.innerHTML = '';
            break;

        case 'wave':
        case 'bow':
        case 'cheer': {
            const emoteText = command === 'wave' ? 'waves hello.' : command === 'bow' ? 'bows respectfully.' : 'cheers loudly!';
            gameActions.sendEmote({ room: localPlayer.location, text: emoteText });
            log(`[Social] You ${emoteText}`);
            break;
        }

        default:
            log(`Unknown command: ${command}. Type /help.`);
    }
}

start();
