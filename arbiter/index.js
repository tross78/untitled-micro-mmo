import crypto, { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

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

    const setupArbiterRoom = (r, name) => {
        const [sendState] = r.makeAction('world_state');
        const [, getRollup] = r.makeAction('rollup');
        const [, getFraud] = r.makeAction('fraud_proof');
        const [, getRequestState] = r.makeAction('request_state');

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
                    const { move, signature, publicKey: cheaterKey } = proof;
                    if (!await verifyMessage(JSON.stringify(move), signature, cheaterKey)) return;
                    const isValid = Object.values(world[move.from]?.exits || {}).includes(move.to);
                    if (!isValid && move.from !== move.to) {
                        console.log(`[Arbiter] MOVEMENT FRAUD: ${String(cheaterKey).slice(0, 8)}`);
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
            await fetch(`https://api.github.com/gists/${GH_GIST_ID}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${GH_GIST_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Hearthwick-Arbiter'
                },
                body: JSON.stringify({
                    files: { 'mmo_arbiter_discovery.json': { content: JSON.stringify({ peerId: selfId, ...packet }) } }
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

    const healthServer = createServer((req, res) => {
        const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
        if (req.url === '/health') {
            res.writeHead(200, cors);
            res.end(JSON.stringify({ day: worldState.day, bans: bans.size, uptime: Math.floor(process.uptime()) }));
        } else if (req.url === '/bans') {
            res.writeHead(200, cors);
            res.end(JSON.stringify(Array.from(bans)));
        } else if (req.url === '/state' && lastBroadcastPacket) {
            res.writeHead(200, cors);
            res.end(JSON.stringify(lastBroadcastPacket));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(3001, '127.0.0.1');

    setTimeout(() => broadcastState().catch(() => {}), 5000);
}

process.on('uncaughtException', (err) => {
    console.error('[Arbiter] Uncaught Exception:', err.message);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Fatal Start Error:', err.message);
    process.exit(1);
});
