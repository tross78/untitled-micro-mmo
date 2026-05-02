import crypto, { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
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
    await import('werift');
    const { signMessage, verifyMessage } = await import('../src/crypto.js');
    const { APP_ID, TORRENT_TRACKERS, ICE_SERVERS } = await import('../src/constants.js');
    const { world } = await import('../src/rules.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY?.trim();
    const GH_GIST_TOKEN = process.env.GH_GIST_TOKEN;
    const GH_GIST_ID = process.env.GH_GIST_ID;

    if (!MASTER_SECRET_KEY) {
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1);
    }

    const { privateKey: arbiterPrivateKey } = await (async () => {
        // Deterministically derive Ed25519 from secret
        const encoder = new TextEncoder();
        const seed = await crypto.subtle.digest('SHA-256', encoder.encode(MASTER_SECRET_KEY));
        const b64Seed = Buffer.from(seed).toString('base64');
        return { privateKey: b64Seed }; 
    })();

    const room = joinTorrent({ appId: APP_ID, trackers: TORRENT_TRACKERS, iceServers: ICE_SERVERS }, 'hearthwick-arbiter-v1');
    const [sendState] = room.makeAction('world_state');
    const [,, getRollup] = room.makeAction('rollup_submit');
    const [,, getFraud] = room.makeAction('fraud_report');

    const lastRollups = new Map(); // shard -> { root, ts, proposer }
    const lastRollupTime = new Map(); // publicKey -> ts
    const fraudCounts = new Map(); // publicKey -> count
    const bans = new Set();

    const ROLLUP_INTERVAL = 10000;

    const banPeer = (publicKey) => {
        bans.add(publicKey);
        console.warn(`[Arbiter] BANNED: ${publicKey}`);
    };

    console.log(`[Arbiter] Online. ID: ${selfId}`);

    room.onPeerJoin(peerId => {
        console.log(`[Arbiter] Peer joined: ${peerId}`);
        // Send current state to new peer
        if (lastValidStatePacket) sendState(lastValidStatePacket, [peerId]);
    });

    getRollup(async (rollup, _peerId) => {
        const { signature, publicKey, name } = rollup;
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
                const { seededRNG } = await import('../src/rules.js');
                const { ENEMIES } = await import('../src/data.js');
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

            if (!await verifyMessage(JSON.stringify(rollup), signature, proposerKey)) return;
            if (presence.disputedRoot !== rollup.root) return;
            if (!await verifyMessage(JSON.stringify(presence), witnessPresenceSig, witnessKey)) return;

            // If we get here, the witness proved the proposer submitted a root that doesn't match presence
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
            console.log(`[Arbiter] Loaded state from disk.`);
        } catch (_err) { console.error(`[Arbiter] Load error:`, _err); }
    }

    const publishBeacon = async () => {
        const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
        const state = {
            seed: MASTER_SECRET_KEY.slice(0, 8), // Public seed derived from master
            day,
            rollups: Object.fromEntries(lastRollups)
        };
        const stateStr = JSON.stringify(state);
        const signature = await signMessage(stateStr, arbiterPrivateKey);
        const packet = { state, signature };
        lastValidStatePacket = packet;

        // Save to local disk
        writeFileSync(STATE_FILE, JSON.stringify(packet));

        // Sync to Gist for discovery
        if (GH_GIST_TOKEN && GH_GIST_ID) {
            const files = {
                'mmo_arbiter_discovery_v4.json': {
                    content: JSON.stringify({
                        ...packet,
                        ts: Date.now(),
                        endpoint: process.env.PUBLIC_URL || null
                    })
                }
            };
            fetch(`https://api.github.com/gists/${GH_GIST_ID}`, {
                method: 'PATCH',
                headers: { 'Authorization': `token ${GH_GIST_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files })
            }).then(r => {
                if (r.ok) console.log(`[Arbiter] Beacon updated (Gist).`);
                else console.error(`[Arbiter] Gist update failed: ${r.status}`);
            }).catch(err => console.error(`[Arbiter] Gist error:`, err));
        }

        // Broadcast to all connected peers
        sendState(packet);
    };

    // Publish every 60s
    setTimeout(publishBeacon, 5000);
    setInterval(publishBeacon, 60000);

    // Prune caches every hour
    setInterval(() => {
        lastRollupTime.clear();
        fraudCounts.clear();
        prunePresenceCache();
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

        if (url.pathname === '/state') {
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(lastValidStatePacket));
        } else if (url.pathname === '/peers') {
            const shard = url.searchParams.get('shard');
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(listPeersForShard(shard)));
        } else if (url.pathname === '/register' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const entry = JSON.parse(body);
                    if (entry.ph && entry.location) {
                        addToPresenceCache(entry.ph, entry);
                    }
                    res.writeHead(200, cors);
                    res.end('{}');
                } catch (_e) { res.writeHead(400); res.end(); }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`[Arbiter] HTTP Discovery server on port ${PORT}`);
    });
}

startArbiter().catch(err => {
    console.error('[FATAL] Arbiter crash:', err);
    process.exit(1);
});
