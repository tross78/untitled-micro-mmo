import crypto, { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
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
    restoreLastRollupsFromPacket,
} from '../src/network/arbiter-state.js';
import { NETWORK_ACTIONS } from '../src/network/contracts.js';
import { createSerializedPublisher } from '../src/network/arbiter-beacon-scheduler.js';
import { createOptionalGistPublisher } from '../src/network/arbiter-gist-publisher.js';
import {
    installArbiterConsoleNoiseFilter,
    isNonfatalNetworkLog,
    summarizeLogArgs,
} from '../src/network/arbiter-log-filter.js';
import { buildArbiterRoomConfig } from '../src/network/arbiter-runtime-config.js';

// Opt-in via env var: the filter rewrites any console.error containing patterns
// like "SSL" or "certificate" as a warning, which can hide genuine config issues.
// Operators that want the noise suppressed set ARBITER_FILTER_NETWORK_NOISE=1.
if (process.env.ARBITER_FILTER_NETWORK_NOISE === '1') {
    installArbiterConsoleNoiseFilter(console);
}

// Polyfills
if (typeof global.crypto === 'undefined') global.crypto = webcrypto;
if (typeof global.WebSocket === 'undefined') global.WebSocket = WebSocket;
if (typeof global.RTCPeerConnection === 'undefined') global.RTCPeerConnection = RTCPeerConnection;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.json');
const REGISTER_BODY_LIMIT = 16 * 1024;

// Non-fatal network/tracker error patterns — these come from tracker WebSocket
// connections that reject, time out, or return unexpected HTTP status codes (e.g. 403).
process.on('uncaughtException', (err) => {
    if (isNonfatalNetworkLog([err])) {
        console.warn('[Arbiter] Network error (non-fatal):', summarizeLogArgs([err], 160));
    } else {
        console.error('[FATAL] Uncaught exception:', err);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, _promise) => {
    if (isNonfatalNetworkLog([reason])) {
        console.warn('[Arbiter] Network rejection (non-fatal):', summarizeLogArgs([reason], 160));
    } else {
        console.error('[FATAL] Unhandled rejection:', reason);
        process.exit(1);
    }
});

// Suppress noisy MaxListenersExceededWarning emitted by werift/mDNS internals
// (their mdnsInstance is capped at 50 listeners; a burst of incoming peer
// candidates briefly pushes us past it before lookup() cleanup runs). Without a
// handler attached, Node logs the full stack to stderr on every burst.
// Set ARBITER_TRACE_WARNINGS=1 to see them for debugging.
process.on('warning', (warning) => {
    const trace = process.env.ARBITER_TRACE_WARNINGS === '1';
    if (warning?.name === 'MaxListenersExceededWarning') {
        if (trace) {
            console.warn(`[Arbiter] ${warning.name}: ${warning.message}`);
            if (warning.stack) console.warn(warning.stack);
        }
        return;
    }
    // Pass other warnings through so genuinely-novel issues stay visible.
    console.warn(`[Arbiter] ${warning.name}: ${warning.message}`);
    if (trace && warning.stack) console.warn(warning.stack);
});

async function startArbiter() {
    const { joinRoom: joinTorrent, selfId } = await import('@trystero-p2p/torrent');
    const { signMessage, verifyMessage, stableStringify } = await import('../src/security/crypto.js');
    const { ICE_SERVERS } = await import('../src/infra/constants.js');
    const { buildTorrentConfig } = await import('../src/network/config.js');
    const { world, ENEMIES } = await import('../src/content/data.js');
    const { presenceSignaturePayload } = await import('../src/network/packer.js');
    const { hashStr } = await import('../src/rules/index.js');
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
        globalRoom = joinTorrent(buildArbiterRoomConfig(buildTorrentConfig({ iceServers: ICE_SERVERS })), 'global');
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

    // Reject register_presence payloads that don't carry a publicKey-bound signature
    // and a ph that matches hashStr(publicKey). Without this check, a peer can flood
    // the presence directory with phantom entries pointing at arbitrary Trystero ids.
    const verifyRegistrationPayload = async (payload) => {
        if (!payload || typeof payload !== 'object') return false;
        const { publicKey, signature, ph } = payload;
        if (!publicKey || !signature || !ph) return false;
        const expectedPh = (hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
        if (ph !== expectedPh) return false;
        try {
            return await verifyMessage(JSON.stringify(presenceSignaturePayload(payload)), signature, publicKey);
        } catch { return false; }
    };

    getRegisterPresence(async (payload, peerId) => {
        if (!payload || typeof payload !== 'object') return;
        if (!await verifyRegistrationPayload(payload)) return;
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

    // Cap lastRollupTime explicitly so a key-rotation attack can't fill memory
    // for an hour at a time. LRU eviction by insertion order is enough — the
    // intent is just rate-limiting per publicKey, not historical accounting.
    const LAST_ROLLUP_TIME_CAP = 1000;
    const recordRollupTime = (publicKey, ts) => {
        if (lastRollupTime.size >= LAST_ROLLUP_TIME_CAP && !lastRollupTime.has(publicKey)) {
            lastRollupTime.delete(lastRollupTime.keys().next().value);
        }
        lastRollupTime.set(publicKey, ts);
    };

    getRollup(async (packet, _peerId) => {
        const { rollup, signature, publicKey } = packet;
        if (!rollup || !signature || !publicKey) return;
        if (bans.has(publicKey)) return;

        const last = lastRollupTime.get(publicKey) || 0;
        if (Date.now() - last < ROLLUP_INTERVAL * 0.8) return;
        recordRollupTime(publicKey, Date.now());

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
            const restoredRollups = restoreLastRollupsFromPacket(lastValidStatePacket);
            for (const [shard, rollup] of restoredRollups) lastRollups.set(shard, rollup);
            console.log(`[Arbiter] Loaded state from disk (${restoredRollups.size} rollup records).`);
        } catch (_err) { console.error(`[Arbiter] Load error:`, _err); }
    }

    const gistPublisher = createOptionalGistPublisher({
        gistId: GH_GIST_ID,
        token: GH_GIST_TOKEN,
    });

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
        const packet = buildPersistedArbiterPacket(state, signature, bans, lastRollups);
        lastValidStatePacket = packet;

        // Save to local disk asynchronously so a slow SD card on Pi Zero cannot
        // block the event loop (Trystero signaling, WebRTC negotiation, HTTP)
        // for hundreds of milliseconds while we wait for fsync.
        await writeFileAsync(STATE_FILE, JSON.stringify(packet)).catch(err =>
            console.error('[Arbiter] State persist failed:', err && err.message ? err.message : err)
        );

        await gistPublisher.publish(packet);

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

    // Prune presence every 5 minutes (TTL is 120s; hourly pruning left stale hints for up to 1h).
    // lastRollupTime is now LRU-capped per insertion (see recordRollupTime above) so no
    // periodic clear is needed — that previously freed memory while also dropping rate
    // limits for legitimate peers in the middle of a session.
    setInterval(() => presenceDirectory.prune(), 5 * 60 * 1000);

    // --- Per-IP token bucket rate limiter ----------------------------------
    // Pi-Zero W has a single 700MHz core. Without this, a single peer can hold a
    // tight fetch loop on /peers or /register and saturate the event loop.
    const HTTP_BUCKET_CAP = 20;          // burst
    const HTTP_REFILL_PER_SEC = 5;       // sustained
    const HTTP_BUCKET_TTL_MS = 60_000;   // garbage-collect idle buckets
    const HTTP_BUCKET_MAX_ENTRIES = 4096; // hard cap so the map itself can't blow up
    const _httpBuckets = new Map();
    const takeHttpToken = (ip) => {
        const now = Date.now();
        let bucket = _httpBuckets.get(ip);
        if (!bucket) {
            if (_httpBuckets.size >= HTTP_BUCKET_MAX_ENTRIES) {
                // Drop the oldest seen ip; cheap protection against unbounded sources.
                _httpBuckets.delete(_httpBuckets.keys().next().value);
            }
            bucket = { tokens: HTTP_BUCKET_CAP, last: now };
            _httpBuckets.set(ip, bucket);
        }
        const elapsed = (now - bucket.last) / 1000;
        bucket.tokens = Math.min(HTTP_BUCKET_CAP, bucket.tokens + elapsed * HTTP_REFILL_PER_SEC);
        bucket.last = now;
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
    };
    setInterval(() => {
        const cutoff = Date.now() - HTTP_BUCKET_TTL_MS;
        for (const [ip, bucket] of _httpBuckets) {
            if (bucket.last < cutoff) _httpBuckets.delete(ip);
        }
    }, HTTP_BUCKET_TTL_MS).unref?.();

    const clientIp = (req) => {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
        return req.socket?.remoteAddress || 'unknown';
    };

    // HTTP Server for fallback discovery and presence cache
    const server = createServer(async (req, res) => {
        const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

        const url = new URL(req.url, `http://${req.headers.host}`);

        // Apply rate limit to every endpoint except /health (operators may scrape it).
        if (url.pathname !== '/health' && !takeHttpToken(clientIp(req))) {
            res.writeHead(429, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'rate_limited' }));
            return;
        }

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
                gistConfigured: gistPublisher.isConfigured(),
                gistStatus: gistPublisher.getStatus(),
            }));
        } else if (url.pathname === '/state') {
            // Brief shared cache so a burst of tab reloads collapses into one origin hit.
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' });
            res.end(JSON.stringify(lastValidStatePacket));
        } else if (url.pathname === '/peers') {
            const shard = url.searchParams.get('shard');
            // Sign the peers list so MITM cannot inject phantom entries into shards.
            // The client verifies signature against MASTER_PUBLIC_KEY in seedFromSnapshot.
            const peers = presenceDirectory.list(shard);
            const payload = { peers, shard: shard || null, ts: Date.now() };
            const peersSignature = await signMessage(stableStringify(payload), arbiterPrivateKey);
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store' });
            res.end(JSON.stringify({ ...payload, signature: peersSignature }));
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
            req.on('end', async () => {
                if (oversized) return;
                try {
                    const parsed = JSON.parse(body);
                    if (!await verifyRegistrationPayload(parsed)) {
                        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'invalid_signature' }));
                        return;
                    }
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
