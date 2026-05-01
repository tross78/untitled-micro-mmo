import crypto, { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
    PRESENCE_CACHE_TTL,
    sanitizePresenceEntry,
    addToPresenceCache,
    prunePresenceCache,
    listPeersForShard,
} from '../src/arbiter-presence-cache.js';

// Suppress tracker/STUN network noise that libraries emit directly to stderr.
// These are non-fatal connection errors (tracker unreachable, STUN timeout, etc.).
const NOISE_PATTERNS = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH',
    'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT',
    'socket hang up', 'Unexpected server response', 'SSL', 'certificate'];
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
    const msg = String(args[0] ?? '');
    if (NOISE_PATTERNS.some(p => msg.includes(p))) { console.warn('[Arbiter] Network noise (non-fatal):', msg.slice(0, 120)); return; }
    _origConsoleError(...args);
};

// Polyfills
if (typeof global.crypto === 'undefined') global.crypto = webcrypto;
if (typeof global.WebSocket === 'undefined') global.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.json');

async function startArbiter() {
    const { joinRoom: joinTorrent, selfId } = await import('@trystero-p2p/torrent');
    const { RTCPeerConnection } = await import('werift');
    const { signMessage, verifyMessage } = await import('../src/crypto.js');
    const { APP_ID, TORRENT_TRACKERS, ICE_SERVERS } = await import('../src/constants.js');
    const { deriveWorldState, world } = await import('../src/rules.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY?.trim();
    const GH_GIST_TOKEN = process.env.GH_GIST_TOKEN;
    const GH_GIST_ID = process.env.GH_GIST_ID;

    if (!MASTER_SECRET_KEY) {
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1);
    }

    const randomSeed = () =>
        'h3arthw1ck-' + crypto.randomBytes(8).toString('hex');

    // --- STATE ---
    let worldState = {
        world_seed: randomSeed(),
        day: 1,
        last_tick: Date.now(),
        bans: []
    };

    if (existsSync(STATE_FILE)) {
        try {
            worldState = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
            console.log('[Arbiter] Loaded persisted world state.');
        } catch (e) {
            console.warn('[Arbiter] Failed to load state file:', e.message);
        }
    }

    const schedulePersist = () => {
        try {
            writeFileSync(STATE_FILE, JSON.stringify(worldState));
        } catch (e) {
            console.warn('[Arbiter] Failed to persist state:', e.message);
        }
    };

    // --- NETWORKING ---
    const baseConfig = {
        appId: APP_ID,
        rtcPolyfill: RTCPeerConnection,
        rtcConfig: { iceServers: ICE_SERVERS },
    };

    // Use all trackers, sharded by the client logic already implemented
    const torrentRoom = joinTorrent({ ...baseConfig, trackerUrls: TORRENT_TRACKERS }, 'global');

    const ROLLUP_INTERVAL = 10000;
    const FRAUD_BAN_THRESHOLD = 3;

    const lastRollups = new Map();
    const lastRollupTime = new Map();
    const fraudCounts = new Map();
    const bans = new Set(worldState.bans || []);

    // Technique A & B: Rolling presence cache for cold-page bootstrap.
    // ph -> { name, location, level, ph, shard, ts }
    const presenceCache = new Map();

    const setupArbiterRoom = (r, name) => {
        const [sendState] = r.makeAction('world_state');
        const [, getRollup] = r.makeAction('rollup');
        const [, getFraud] = r.makeAction('fraud_proof');
        const [, getRequestState] = r.makeAction('request_state');
        const [, getRegisterPresence] = r.makeAction('register_presence');

        getRegisterPresence((entry) => {
            const sanitized = sanitizePresenceEntry(entry);
            if (!sanitized || bans.has(sanitized.ph)) return;
            addToPresenceCache(presenceCache, sanitized.ph, sanitized);
        });

        getRequestState(async (_, peerId) => {
            console.log(`[Arbiter][${name}] State requested by ${peerId}`);
            if (lastBroadcastPacket) {
                setTimeout(() => sendState(lastBroadcastPacket, [peerId]), 500);
            } else {
                const stateStr = JSON.stringify(worldState);
                const signature = await signMessage(stateStr, MASTER_SECRET_KEY);
                setTimeout(() => sendState({ state: stateStr, signature }, [peerId]), 500);
            }
        });

        getRollup(async (data) => {
            const { rollup, signature, publicKey } = data;
            if (bans.has(publicKey)) return;
            const last = lastRollupTime.get(publicKey) || 0;
            if (Date.now() - last < ROLLUP_INTERVAL * 0.8) return;
            lastRollupTime.set(publicKey, Date.now());

            if (await verifyMessage(JSON.stringify(rollup), signature, publicKey)) {
                console.log(`[Arbiter][${name}] Rollup: ${rollup.shard}`);
                lastRollups.set(rollup.shard, { ...rollup, proposer: publicKey });
            }
        });

        getFraud(async (data) => {
            try {
                const { type, proof, witness, rollup: rollupData } = data;
                const { signature: witnessSig, publicKey: witnessKey } = witness;

                if (type === 'illegal_move') {
                    // Stateless verification: re-check the world graph independently.
                    const { move, signature, publicKey: cheaterKey } = proof;
                    if (!await verifyMessage(JSON.stringify(move), signature, cheaterKey)) return;
                    const isValid = Object.values(world[move.from]?.exits || {}).includes(move.to);
                    if (!isValid && move.from !== move.to) {
                        console.log(`[Arbiter] MOVEMENT FRAUD: ${String(cheaterKey).slice(0, 8)}`);
                        banPeer(cheaterKey);
                    }
                    return;
                }

                if (type === 'xp_fraud') {
                    // Stateless XP verification: re-run rollLoot + enemy XP lookup.
                    const { publicKey: cheaterKey, feedEntry, worldSeed, actionEntropy } = proof;
                    if (!feedEntry || feedEntry.type !== 'kill') return;
                    const { seededRNG, rollLoot } = await import('../src/rules.js');
                    const { ENEMIES } = await import('../src/data.js');
                    const enemyDef = ENEMIES[feedEntry.target];
                    if (!enemyDef) return;
                    const rng = seededRNG(actionEntropy);
                    const expectedXp = enemyDef.xp;
                    if (feedEntry.xp !== expectedXp) {
                        console.log(`[Arbiter] XP FRAUD: ${String(cheaterKey).slice(0, 8)} claimed ${feedEntry.xp}, expected ${expectedXp}`);
                        banPeer(cheaterKey);
                    }
                    return;
                }

                if (!rollupData) return;
                const { rollup, signature, publicKey: proposerKey } = rollupData;
                const { presence, signature: witnessPresenceSig } = witness;

                if (!await verifyMessage(JSON.stringify(rollup), signature, proposerKey)) return;
                if (presence.disputedRoot !== rollup.root) return;
                if (!await verifyMessage(JSON.stringify(presence), witnessPresenceSig, witnessKey)) return;

                if (!fraudCounts.has(proposerKey)) fraudCounts.set(proposerKey, new Set());
                fraudCounts.get(proposerKey).add(witnessKey);

                if (fraudCounts.get(proposerKey).size >= FRAUD_BAN_THRESHOLD) {
                    console.log(`[Arbiter] Proposer Banned: ${String(proposerKey).slice(0, 8)}`);
                    banPeer(proposerKey);
                }
            } catch (e) { console.warn(`[Arbiter] Fraud handler error:`, e.message); }
        });

        const banPeer = async (pubKey) => {
            if (bans.has(pubKey)) return;
            bans.add(pubKey);
            worldState.bans = Array.from(bans);
            schedulePersist();
            const banState = { type: 'ban', target: pubKey };
            const banMsg = JSON.stringify(banState);
            const banSig = await signMessage(banMsg, MASTER_SECRET_KEY);
            torrent.sendState({ state: banMsg, signature: banSig });
        };

        r.onPeerJoin(peerId => {
            if (lastBroadcastPacket) setTimeout(() => sendState(lastBroadcastPacket, [peerId]), 500);
        });

        return { sendState };
    };

    const torrent = setupArbiterRoom(torrentRoom, 'Torrent');
    let lastBroadcastPacket = null;

    async function publishBeacon(packet) {
        if (!GH_GIST_TOKEN || !GH_GIST_ID) return;
        try {
            prunePresenceCache(presenceCache);
            const snapshot = Array.from(presenceCache.values())
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 50)
                .map(({ name, location, level, ph, ts }) => ({ name, location, level, ph, ts }));

            await fetch(`https://api.github.com/gists/${GH_GIST_ID}`, {
                method: 'PATCH',
                signal: AbortSignal.timeout(8000),
                headers: {
                    'Authorization': `token ${GH_GIST_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Hearthwick-Arbiter'
                },
                body: JSON.stringify({
                    files: { 'mmo_arbiter_discovery.json': { content: JSON.stringify({ peerId: selfId, ...packet, snapshot, snapshotTs: Date.now() }) } }
                })
            });
        } catch (e) { console.warn('[Arbiter] Gist failed:', e.message); }
    }

    const getBansHash = () => {
        const str = Array.from(bans).sort().join(',');
        return crypto.createHash('sha256').update(str).digest('hex').slice(0, 8);
    };

    async function broadcastState() {
        const bansHash = getBansHash();
        const stateToSend = { ...worldState, bans: bansHash, bansCount: bans.size };
        const stateStr = JSON.stringify(stateToSend);
        const signature = await signMessage(stateStr, MASTER_SECRET_KEY);
        const packet = { state: stateStr, signature };
        lastBroadcastPacket = packet;
        torrent.sendState(packet);
        publishBeacon(packet).catch(() => {});
        console.log(`[Arbiter] Broadcast (Bans: ${bans.size}, Hash: ${bansHash})`);
    }

    console.log('[Arbiter] Started.');

    function advanceDay() {
        worldState.last_tick += 86400000;
        worldState.day++;
        schedulePersist();
        broadcastState().catch(() => {});
    }

    const scheduleTick = () => {
        while (worldState.last_tick + 86400000 <= Date.now()) {
            worldState.last_tick += 86400000;
            worldState.day++;
        }
        schedulePersist();
        const delay = (worldState.last_tick + 86400000) - Date.now();
        setTimeout(() => { advanceDay(); scheduleTick(); }, delay);
    };
    scheduleTick();

    // Periodic cleanup to prevent unbounded map growth
    setInterval(() => {
        const cutoff = Date.now() - ROLLUP_INTERVAL * 10;
        for (const [key, ts] of lastRollupTime) {
            if (ts < cutoff) {
                lastRollupTime.delete(key);
                fraudCounts.delete(key);
            }
        }
    }, 3600000);

    // Reset handler: SIGUSR2 or IPC message
    const doReset = async () => {
        worldState.world_seed = randomSeed();
        worldState.day = 1;
        worldState.last_tick = Date.now();
        worldState.bans = [];
        fraudCounts.clear();
        lastRollupTime.clear();
        bans.clear();
        schedulePersist();
        await broadcastState();
        console.log(`[Arbiter] World reset. New seed: ${worldState.world_seed}`);
    };
    process.on('SIGUSR2', doReset);
    process.on('message', (msg) => { if ((msg?.data ?? msg) === 'reset') doReset(); });

    const healthServer = createServer((req, res) => {
        const cors = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };
        if (req.method === 'OPTIONS') {
            res.writeHead(204, cors);
            res.end();
            return;
        }

        if (req.url === '/health') {
            res.writeHead(200, cors);
            res.end(JSON.stringify({ day: worldState.day, bans: bans.size, uptime: Math.floor(process.uptime()) }));
        } else if (req.url === '/bans') {
            res.writeHead(200, cors);
            res.end(JSON.stringify(Array.from(bans)));
        } else if (req.url === '/state' && lastBroadcastPacket) {
            res.writeHead(200, cors);
            res.end(JSON.stringify(lastBroadcastPacket));
        } else if (req.url.startsWith('/peers')) {
            const url = new URL(req.url, 'http://localhost');
            const shard = (url.searchParams.get('shard') || '').trim();
            prunePresenceCache(presenceCache);
            if (!shard) {
                res.writeHead(400, cors);
                res.end(JSON.stringify({ error: 'missing shard' }));
                return;
            }
            const entries = listPeersForShard(presenceCache, shard);
            res.writeHead(200, { ...cors, 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(entries));
        } else if (req.url === '/register' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { 
                if (body.length + chunk.length > 1024) {
                    req.socket.destroy();
                    return;
                }
                body += chunk; 
            });
            req.on('end', () => {
                if (req.socket.destroyed) return;
                try {
                    const entry = sanitizePresenceEntry(JSON.parse(body));
                    if (!entry || bans.has(entry.ph)) {
                        res.writeHead(400, cors);
                        res.end(JSON.stringify({ error: 'invalid presence' }));
                        return;
                    }
                    addToPresenceCache(presenceCache, entry.ph, entry);
                    res.writeHead(200, cors);
                    res.end('{}');
                } catch { res.writeHead(400); res.end(); }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(3001, '127.0.0.1');

    setTimeout(() => broadcastState().catch(() => {}), 5000);

    // Technique A: Periodic Gist update to keep the player snapshot fresh.
    setInterval(() => {
        if (lastBroadcastPacket) {
            publishBeacon(lastBroadcastPacket).catch(() => {});
        }
    }, 60000);
}

const SURVIVABLE_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
    'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'
]);
const SURVIVABLE_MSGS = ['unsupported', 'DECODER', 'SSL', 'certificate', 'server response',
    'socket hang up', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH',
    'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'Unexpected server response'];

function isSurvivable(err) {
    if (SURVIVABLE_CODES.has(err?.code)) return true;
    const msg = String(err?.message || err || '');
    return SURVIVABLE_MSGS.some(m => msg.includes(m));
}

process.on('uncaughtException', (err) => {
    if (isSurvivable(err)) {
        console.warn('[Arbiter] Network error (non-fatal):', err.message);
        return;
    }
    console.error('[Arbiter] Uncaught Exception:', err.message, err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    if (isSurvivable(reason)) {
        console.warn('[Arbiter] Network rejection (non-fatal):', reason?.message || reason);
        return;
    }
    console.error('[Arbiter] Unhandled Rejection:', reason?.message ?? reason);
    process.exit(1);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Fatal Start Error:', err.message);
    process.exit(1);
});
