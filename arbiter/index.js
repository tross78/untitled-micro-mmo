import crypto, { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { RTCPeerConnection } from 'werift';
import {
    createPresenceDirectory,
} from '../src/network/arbiter-presence-directory.js';
import {
    buildPersistedArbiterPacket,
    getBansVersion,
    restoreBansFromPacket,
} from '../src/network/arbiter-state.js';
import { NETWORK_ACTIONS } from '../src/network/contracts.js';
import { createSerializedPublisher } from '../src/network/arbiter-beacon-scheduler.js';

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
if (typeof global.RTCPeerConnection === 'undefined') global.RTCPeerConnection = RTCPeerConnection;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.json');
const REGISTER_BODY_LIMIT = 16 * 1024;

// Non-fatal network/tracker error patterns — these come from tracker WebSocket
// connections that reject, time out, or return unexpected HTTP status codes (e.g. 403).
const NONFATAL_PATTERNS = [
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT',
    'WebSocket', 'socket hang up', 'Unexpected server response',
    'SSL', 'certificate', 'handshake',
];
const isNonfatalNetworkError = (msg) => NONFATAL_PATTERNS.some(p => msg.includes(p));

process.on('uncaughtException', (err) => {
    const msg = err.message || String(err);
    if (isNonfatalNetworkError(msg)) {
        console.warn('[Arbiter] Network error (non-fatal):', msg.slice(0, 160));
    } else {
        console.error('[FATAL] Uncaught exception:', err);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, _promise) => {
    const msg = reason?.message || String(reason);
    if (isNonfatalNetworkError(msg)) {
        console.warn('[Arbiter] Network rejection (non-fatal):', msg.slice(0, 160));
    } else {
        console.error('[FATAL] Unhandled rejection:', reason);
        process.exit(1);
    }
});

if (process.env.ARBITER_TRACE_WARNINGS === '1') {
    process.on('warning', (warning) => {
        if (warning?.name !== 'MaxListenersExceededWarning') return;
        console.warn(`[Arbiter] ${warning.name}: ${warning.message}`);
        if (warning.stack) console.warn(warning.stack);
    });
}

async function startArbiter() {
    const { joinRoom: joinTorrent, selfId } = await import('@trystero-p2p/torrent');
    const { signMessage, verifyMessage, stableStringify } = await import('../src/security/crypto.js');
    const { ICE_SERVERS } = await import('../src/infra/constants.js');
    const { buildTorrentConfig } = await import('../src/network/config.js');
    const { world, ENEMIES } = await import('../src/content/data.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY?.trim();
    const GH_GIST_TOKEN = process.env.GH_GIST_TOKEN;
    const GH_GIST_ID = process.env.GH_GIST_ID;

    if (!MASTER_SECRET_KEY) {
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1);
    }

    const { privateKey: arbiterPrivateKey, derivedPublicKeyB64 } = await (async () => {
        // Deterministically derive Ed25519 keypair from secret
        const encoder = new TextEncoder();
        const seed = await crypto.subtle.digest('SHA-256', encoder.encode(MASTER_SECRET_KEY));
        const seedBuf = Buffer.from(seed);
        const b64Seed = seedBuf.toString('base64');
        // Derive and log the public key so operators can verify MASTER_PUBLIC_KEY in constants.js
        const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
        const keyObj = crypto.createPrivateKey({ key: Buffer.concat([pkcs8Header, seedBuf]), format: 'der', type: 'pkcs8' });
        const spki = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
        const pubKeyB64 = Buffer.from(spki).subarray(spki.length - 32).toString('base64');
        console.log(`[Arbiter] Derived public key: ${pubKeyB64}`);
        console.log(`[Arbiter] MASTER_PUBLIC_KEY in constants.js should equal the above.`);
        return { privateKey: b64Seed, derivedPublicKeyB64: pubKeyB64 };
    })();

    // Arbiter joins the `global` room — the same room the browser uses for
    // arbiter-mediated actions (world-state beacons, rollups, fraud reports,
    // presence registration). A separate `hearthwick-arbiter-v1` room used to
    // exist but the browser never joined it, so rollups/fraud silently dropped.
    let globalRoom;
    try {
        globalRoom = joinTorrent(buildTorrentConfig({ iceServers: ICE_SERVERS }), 'global');
    } catch (err) {
        console.error('[Arbiter] Torrent join failed:', err.message);
        process.exit(1);
    }

    // Trystero tuple is [send, receive, progress] — destructure receive (index 1),
    // not progress (index 2). The previous `[,, getRollup]` form bound the progress
    // callback, so rollups/fraud were never received even if the room had matched.
    const [sendState] = globalRoom.makeAction(NETWORK_ACTIONS.WORLD_STATE);
    const [, getRollup] = globalRoom.makeAction(NETWORK_ACTIONS.ROLLUP_SUBMIT);
    const [, getFraud] = globalRoom.makeAction(NETWORK_ACTIONS.FRAUD_REPORT);
    const [, getRegisterPresence] = globalRoom.makeAction('register_presence');
    const [sendPeerHints] = globalRoom.makeAction('arbiter_peer_hints');
    const [, getSeekingShard] = globalRoom.makeAction('seeking_shard');

    const lastRollups = new Map(); // shard -> { root, ts, proposer }
    const lastRollupTime = new Map(); // publicKey -> ts
    const bans = new Set();
    const presenceDirectory = createPresenceDirectory();

    getRegisterPresence((payload, peerId) => {
        if (!payload || typeof payload !== 'object') return;
        const registered = presenceDirectory.register(payload);
        if (registered && registered.id) {
            console.log(`[Arbiter] Peer discovered via network: ${registered.id} (${registered.name}) on ${registered.shard}`);
            const shardPeers = presenceDirectory.list(registered.shard);
            const others = shardPeers.filter(p => p.id && p.id !== registered.id);

            // Push existing shard peers back to the new/refreshed peer.
            if (others.length > 0 && peerId) {
                sendPeerHints(others.slice(0, 8).map(p => ({ id: p.id, ph: p.ph })), [peerId]);
                console.log(`[Arbiter] Sent ${Math.min(others.length, 8)} peer hint(s) to ${peerId.slice(0, 8)}`);
            }

            // Push the new/refreshed peer back to all existing shard peers.
            // This is the key fix for refresh: when A refreshes and gets a new peer ID,
            // existing peers (B) won't discover A unless we tell them here.
            const existingPeerTrysteroIds = others.map(p => p.id).filter(Boolean);
            if (existingPeerTrysteroIds.length > 0) {
                sendPeerHints([{ id: registered.id, ph: registered.ph }], existingPeerTrysteroIds);
                console.log(`[Arbiter] Notified ${existingPeerTrysteroIds.length} existing peer(s) about ${registered.id.slice(0, 8)}`);
            }
        }
    });

    // When a browser calls joinInstance it sends seeking_shard. The arbiter is
    // always in the global room, so it responds immediately with peer hints for
    // that shard — this is especially important after a page refresh when the
    // refreshed browser may not share the global room with its old peers yet.
    getSeekingShard((data, peerId) => {
        if (!peerId) return;
        const shard = typeof data === 'string' ? data : data?.shard;
        if (!shard || typeof shard !== 'string') return;
        const hints = presenceDirectory.list(shard)
            .filter(p => p.id && p.id !== peerId)
            .slice(0, 8)
            .map(p => ({ id: p.id, ph: p.ph }));
        if (hints.length > 0) {
            sendPeerHints(hints, [peerId]);
            console.log(`[Arbiter] seeking_shard ${shard}: sent ${hints.length} hint(s) to ${peerId.slice(0, 8)}`);
        }
    });

    let trackedPublishBeacon = async () => {};

    const ROLLUP_INTERVAL = 10000;

    const banPeer = (publicKey) => {
        if (bans.has(publicKey)) return;
        bans.add(publicKey);
        console.warn(`[Arbiter] BANNED: ${publicKey}`);
        trackedPublishBeacon().catch(err => console.error('[Arbiter] Beacon refresh failed after ban:', err));
    };

    console.log(`[Arbiter] Online. ID: ${selfId}`);

    globalRoom.onPeerJoin(peerId => {
        console.log(`[Arbiter] Peer joined: ${peerId}`);
        if (lastValidStatePacket) sendState(lastValidStatePacket, [peerId]);
    });

    globalRoom.onPeerLeave(peerId => {
        console.log(`[Arbiter] Peer left: ${peerId}`);
        presenceDirectory.removeById(peerId);
    });

    getRollup(async (packet, _peerId) => {
        const { rollup, signature, publicKey } = packet;
        if (!rollup || !signature || !publicKey) return;
        if (bans.has(publicKey)) return;

        const last = lastRollupTime.get(publicKey) || 0;
        if (Date.now() - last < ROLLUP_INTERVAL * 0.8) return;
        lastRollupTime.set(publicKey, Date.now());

        if (await verifyMessage(stableStringify(rollup), signature, publicKey)) {
            console.log(`[Arbiter] Rollup: ${rollup.shard}`);
            lastRollups.set(rollup.shard, { ...rollup, proposer: publicKey });
        }
    });

    getFraud(async (data) => {
        try {
            const { type, proof, witness, rollup: rollupData } = data;
            const { publicKey: witnessKey } = witness;

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
                const { publicKey: cheaterKey, feedEntry, actionEntropy } = proof;

                if (!feedEntry || feedEntry.type !== 'kill') return;
                const { seededRNG } = await import('../src/rules/index.js');
                const enemyDef = ENEMIES[feedEntry.target];
                if (!enemyDef) return;
                seededRNG(actionEntropy);
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

            // 1. Verify proposer actually signed this rollup
            if (!await verifyMessage(stableStringify(rollup), signature, proposerKey)) return;

            // 2. Cross-check against our own record of what the proposer submitted
            //    A witness cannot frame a proposer by supplying an arbitrary disputedRoot —
            //    we only act if our own lastRollups record for this shard has a different root
            const ourRecord = lastRollups.get(rollup.shard);
            if (!ourRecord || ourRecord.proposer !== proposerKey) return;
            if (ourRecord.root === rollup.root) return; // roots match — no fraud

            // 3. Verify witness signed their presence payload
            if (!await verifyMessage(JSON.stringify(presence), witnessPresenceSig, witnessKey)) return;

            // 4. Confirm the witness's presence names the same disputed root
            if (presence.disputedRoot !== rollup.root) return;

            console.log(`[Arbiter] STATE FRAUD PROVED against ${proposerKey}`);
            banPeer(proposerKey);
        } catch (err) {
            console.error(`[Arbiter] Fraud processing error:`, err);
        }
    });

    let lastValidStatePacket = null;
    if (existsSync(STATE_FILE)) {
        try {
            lastValidStatePacket = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
            restoreBansFromPacket(lastValidStatePacket).forEach(publicKey => bans.add(publicKey));
            console.log(`[Arbiter] Loaded state from disk.`);
        } catch (_err) { console.error(`[Arbiter] Load error:`, _err); }
    }

    const publishBeacon = async () => {
        const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
        const state = {
            world_seed: MASTER_SECRET_KEY.slice(0, 8), // field name must match client expectation
            day,
            last_tick: Date.now(),
            rollups: Object.fromEntries(lastRollups),
            bans: getBansVersion(bans),
        };
        const stateStr = stableStringify(state);
        const signature = await signMessage(stateStr, arbiterPrivateKey);
        const packet = buildPersistedArbiterPacket(state, signature, bans);
        lastValidStatePacket = packet;

        // Save to local disk
        writeFileSync(STATE_FILE, JSON.stringify(packet));

        if (GH_GIST_TOKEN && GH_GIST_ID) {
            const gistPayload = { ...packet, ts: Date.now() };
            const files = {
                'mmo_arbiter_discovery_v4.json': {
                    content: JSON.stringify(gistPayload)
                }
            };
            try {
                const response = await fetch(`https://api.github.com/gists/${GH_GIST_ID}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `token ${GH_GIST_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files }),
                    signal: AbortSignal.timeout(15000),
                });
                if (response.ok) console.log(`[Arbiter] Beacon updated (Gist).`);
                else console.error(`[Arbiter] Gist update failed: ${response.status}`);
            } catch (err) {
                console.error(`[Arbiter] Gist error:`, err);
            }
        }

        // Broadcast to all connected peers
        sendState(packet);
    };

    const beaconPublisher = createSerializedPublisher(publishBeacon);
    trackedPublishBeacon = beaconPublisher.publish;

    // Dead-man's switch — warn if no beacon published in 30 minutes
    setInterval(() => {
        const lastBeaconAt = beaconPublisher.getLastPublishedAt();
        if (lastBeaconAt > 0 && Date.now() - lastBeaconAt > 30 * 60 * 1000) {
            console.error(`[Arbiter] WATCHDOG: No beacon published in >30 minutes. Check for errors.`);
        }
    }, 5 * 60 * 1000);

    // Publish every 60s
    setTimeout(() => trackedPublishBeacon().catch(err => console.error('[Arbiter] Beacon publish failed:', err)), 5000);
    setInterval(() => trackedPublishBeacon().catch(err => console.error('[Arbiter] Beacon publish failed:', err)), 60000);

    // Prune caches every hour
    setInterval(() => {
        lastRollupTime.clear();
        presenceDirectory.prune();
    }, 3600000);

    // HTTP Server for fallback discovery and presence cache
    const server = createServer(async (req, res) => {
        const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === '/public-key') {
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ publicKey: derivedPublicKeyB64 }));
        } else if (url.pathname === '/bans') {
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify([...bans]));
        } else if (url.pathname === '/health') {
            const uptime = process.uptime();
            const lastBeaconAt = beaconPublisher.getLastPublishedAt();
            const lastBeaconAge = lastBeaconAt ? Math.floor((Date.now() - lastBeaconAt) / 1000) : null;
            const healthy = lastBeaconAge !== null && lastBeaconAge < 1800;
            res.writeHead(healthy ? 200 : 503, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: healthy,
                uptime,
                lastBeaconAgeSecs: lastBeaconAge,
                beaconPublishInFlight: beaconPublisher.isInFlight(),
                peers: presenceDirectory.size(),
                gistConfigured: Boolean(GH_GIST_TOKEN && GH_GIST_ID),
            }));
        } else if (url.pathname === '/state') {
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(lastValidStatePacket));
        } else if (url.pathname === '/peers') {
            const shard = url.searchParams.get('shard');
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(presenceDirectory.list(shard)));
        } else if (url.pathname === '/register' && req.method === 'POST') {
            let body = '';
            let oversized = false;
            req.on('data', chunk => {
                if (oversized) return;
                body += chunk;
                if (body.length > REGISTER_BODY_LIMIT) {
                    oversized = true;
                    req.socket.destroy();
                }
            });
            req.on('end', () => {
                if (oversized) return;
                try {
                    const parsed = JSON.parse(body);
                    const registered = presenceDirectory.register(parsed);
                    if (!registered) {
                        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false }));
                        return;
                    }
                    // Return current shard peers so the client can seed HyParView immediately.
                    const peers = presenceDirectory.list(registered.shard)
                        .filter(p => p.ph !== registered.ph)
                        .slice(0, 8)
                        .filter(p => p.id)
                        .map(p => ({ id: p.id, ph: p.ph }));
                    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, peers }));
                } catch (_e) { res.writeHead(400); res.end(); }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    const PORT = process.env.PORT || 3000;
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[Arbiter] Port ${PORT} already in use. Wait 30s then try again, or use PORT=<other> to override.`);
            setTimeout(() => server.listen(PORT), 30000);
        } else {
            throw err;
        }
    });
    server.listen(PORT, () => {
        console.log(`[Arbiter] HTTP Discovery server on port ${PORT}`);
    });
}

startArbiter().catch(err => {
    console.error('[FATAL] Arbiter crash:', err);
    process.exit(1);
});
