import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.json');

async function startArbiter() {
    const { joinRoom: joinTorrent } = await import('@trystero-p2p/torrent');
    const { RTCPeerConnection } = await import('werift');
    const { signMessage, verifyMessage } = await import('../src/crypto.js');
    const { APP_ID, ROOM_NAME } = await import('../src/constants.js');
    const { deriveWorldState } = await import('../src/rules.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;
    if (!MASTER_SECRET_KEY) {
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1);
    }

    // --- STATE ---
    let worldState = {
        world_seed: 'h3arthw1ck-' + Math.random().toString(16).slice(2),
        day: 1,
        last_tick: Date.now()
    };

    if (existsSync(STATE_FILE)) {
        try {
            const bin = readFileSync(STATE_FILE, 'utf8');
            worldState = JSON.parse(bin);
            console.log('[Arbiter] Loaded persisted world state.');
        } catch (e) {
            console.warn('[Arbiter] Failed to load state file, starting fresh:', e.message);
        }
    }

    // Persist state to disk, debounced
    let persistTimer = null;
    const schedulePersist = () => {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            try {
                writeFileSync(STATE_FILE, JSON.stringify(worldState));
            } catch (e) {
                console.warn('[Arbiter] Failed to persist state:', e.message);
            }
        }, 2000);
    };

    // --- NETWORKING ---
    const { TORRENT_TRACKERS, ICE_SERVERS } = await import('../src/constants.js');

    const baseConfig = {
        appId: APP_ID,
        rtcPolyfill: RTCPeerConnection,
        rtcConfig: { iceServers: ICE_SERVERS },
    };

    const torrentRoom = joinTorrent({ ...baseConfig, trackerUrls: TORRENT_TRACKERS }, 'global');

    const ROLLUP_INTERVAL = 10000;
    const FRAUD_BAN_THRESHOLD = 3;

    // --- ROLLUPS & FRAUD ---
    const lastRollups = new Map(); // shard -> {root, proposer, timestamp}
    const lastRollupTime = new Map(); // publicKey -> timestamp (rate limiting)
    const fraudCounts = new Map(); // proposerKey -> Set of claimant publicKeys
    const bans = new Set(worldState.bans || []);

    const setupArbiterRoom = (r, name) => {
        const [sendState] = r.makeAction('world_state');
        const [, getRollup] = r.makeAction('rollup');
        const [, getFraud] = r.makeAction('fraud_proof');

        getRollup(async (data) => {
            const { rollup, signature, publicKey } = data;
            if (bans.has(publicKey)) return;

            // Rate-limit: one accepted rollup per proposer per interval
            const last = lastRollupTime.get(publicKey) || 0;
            if (Date.now() - last < ROLLUP_INTERVAL * 0.8) return;
            lastRollupTime.set(publicKey, Date.now());

            if (!await verifyMessage(JSON.stringify(rollup), signature, publicKey)) {
                console.warn(`[Arbiter][${name}] Invalid rollup signature from ${String(publicKey).slice(0, 8)}`);
                return;
            }
            console.log(`[Arbiter][${name}] Rollup received for ${rollup.shard}: Root ${rollup.root.slice(0, 8)}`);
            lastRollups.set(rollup.shard, { ...rollup, proposer: publicKey });
        });

        getFraud(async (data) => {
            const { rollup: rollupData, witness } = data;
            const { rollup, signature, publicKey: proposerKey } = rollupData;
            const { id, presence, signature: witnessSig, publicKey: witnessKey } = witness;

            // 1. Verify the Proposer's signature on the disputed rollup
            if (!await verifyMessage(JSON.stringify(rollup), signature, proposerKey)) return;

            // 2. Verify the witness's signed presence
            if (!await verifyMessage(JSON.stringify(presence), witnessSig, witnessKey)) return;

            // 3. Verify witnessKey matches the ph in the presence packet
            const { hashStr: _hashStr } = await import('../src/rules.js');
            const expectedPh = (_hashStr(witnessKey) >>> 0).toString(16).padStart(8, '0');
            if (presence.ph !== expectedPh) {
                console.warn(`[Arbiter] Fraud Proof rejected: key/ph mismatch for witness ${id}`);
                return;
            }

            // 4. Accumulate distinct fraud reports; ban after threshold
            if (!fraudCounts.has(proposerKey)) fraudCounts.set(proposerKey, new Set());
            fraudCounts.get(proposerKey).add(witnessKey);
            const count = fraudCounts.get(proposerKey).size;
            console.log(`[Arbiter][${name}] Fraud report ${count}/${FRAUD_BAN_THRESHOLD} against ${String(proposerKey).slice(0, 8)}`);

            if (count >= FRAUD_BAN_THRESHOLD) {
                console.log(`[FRAUD PROVEN] Banning proposer ${String(proposerKey).slice(0, 8)}`);
                bans.add(proposerKey);
                fraudCounts.delete(proposerKey);
                worldState.bans = Array.from(bans);
                schedulePersist();
                const banMsg = JSON.stringify({ event: 'ban', target: proposerKey });
                const banSig = await signMessage(banMsg, MASTER_SECRET_KEY);
                torrent.sendState({ state: { type: 'ban', target: proposerKey }, signature: banSig });
            }
        });

        r.onPeerJoin(peerId => {
            console.log(`[Arbiter][${name}] Peer joined: ${peerId}`);
            broadcastState();
        });

        return { sendState };
    };

    const torrent = setupArbiterRoom(torrentRoom, 'Torrent');

    async function broadcastState() {
        const data = JSON.stringify(worldState);
        const signature = await signMessage(data, MASTER_SECRET_KEY);
        const packet = { state: worldState, signature };
        torrent.sendState(packet);
        console.log(`[Arbiter] Broadcasted state for Day ${worldState.day}`);
    }

    console.log('[Arbiter] Started.');

    // --- RESET ---
    const doReset = async () => {
        worldState = {
            world_seed: 'h3arthw1ck-' + Math.random().toString(16).slice(2),
            day: 1,
            last_tick: Date.now()
        };
        schedulePersist();
        await broadcastState();
        console.log(`[Arbiter] World reset. New seed: ${worldState.world_seed}`);
    };

    process.on('message', (msg) => {
        const cmd = msg?.data ?? msg;
        if (cmd === 'reset') doReset();
    });
    process.on('SIGUSR2', doReset);

    // --- DAY TICK ---
    function advanceDay() {
        worldState.day++;
        worldState.last_tick = Date.now();
        schedulePersist();

        const derived = deriveWorldState(worldState.world_seed, worldState.day);
        console.log(`[Arbiter] Day ${worldState.day} — ${derived.season}, mood: ${derived.mood}, threat: ${derived.threatLevel}`);
        broadcastState();
    }

    // Drift-corrected day tick: target next tick based on last_tick, not interval start
    const scheduleTick = () => {
        const delay = Math.max(0, (worldState.last_tick + 86400000) - Date.now());
        setTimeout(() => { advanceDay(); scheduleTick(); }, delay);
    };
    scheduleTick();

    // Health endpoint for Pi debugging
    const healthServer = createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                day: worldState.day,
                seed: worldState.world_seed.slice(0, 12),
                bans: bans.size,
                uptime: Math.floor(process.uptime()),
            }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(3001, '127.0.0.1', () =>
        console.log('[Arbiter] Health: http://127.0.0.1:3001/health')
    );

    // Initial broadcast on startup
    setTimeout(() => broadcastState(), 5000);
}

const SURVIVABLE_MESSAGES = ['unsupported', 'DECODER', 'SSL', 'certificate', 'server response', 'socket hang up', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
const _consoleError = console.error.bind(console);
console.error = (...args) => {
    const msg = String(args[0] ?? '') + String(args[1]?.message ?? '');
    if (SURVIVABLE_MESSAGES.some(m => msg.includes(m))) return;
    _consoleError(...args);
};

const SURVIVABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
process.on('uncaughtException', (err) => {
    if (SURVIVABLE_CODES.has(err.code)) {
        console.warn('[Arbiter] Network error (non-fatal):', err.message);
        return;
    }
    console.error('[Arbiter] Uncaught Exception:', err.message);
    process.exit(1);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Failed to start:', err);
});
