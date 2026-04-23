import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.json');

async function startArbiter() {
    const { joinRoom: joinNostr } = await import('@trystero-p2p/nostr');
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
    const { lookup } = await import('dns/promises');

    async function filterReachable(urls) {
        const results = await Promise.allSettled(
            urls.map(url => lookup(new URL(url).hostname))
        );
        return urls.filter((_, i) => {
            const r = results[i];
            return r.status === 'fulfilled' && r.value.address !== '0.0.0.0';
        });
    }

    const { NOSTR_RELAYS: ALL_NOSTR_RELAYS, TORRENT_TRACKERS: ALL_TORRENT_TRACKERS, ICE_SERVERS } = await import('../src/constants.js');

    const [reachableRelays, reachableTrackers] = await Promise.all([
        filterReachable(ALL_NOSTR_RELAYS),
        filterReachable(ALL_TORRENT_TRACKERS),
    ]);

    const baseConfig = {
        appId: APP_ID,
        rtcPolyfill: RTCPeerConnection,
        rtcConfig: { iceServers: ICE_SERVERS },
    };

    const room = joinNostr({ ...baseConfig, relayUrls: reachableRelays.length ? reachableRelays : ALL_NOSTR_RELAYS }, 'global');
    const torrentRoom = joinTorrent({ ...baseConfig, trackerUrls: reachableTrackers.length ? reachableTrackers : ALL_TORRENT_TRACKERS }, 'global');

    // --- ROLLUPS & FRAUD ---
    const lastRollups = new Map(); // shard -> {root, proposer, timestamp}
    const bans = new Set();

    const setupArbiterRoom = (r, name) => {
        const [sendState] = r.makeAction('world_state');
        const [, getRollup] = r.makeAction('rollup');
        const [, getFraud] = r.makeAction('fraud_proof');

        getRollup(async (data) => {
            const { rollup, signature, publicKey } = data;
            if (bans.has(publicKey)) return;
            if (!await verifyMessage(JSON.stringify(rollup), signature, publicKey)) {
                console.warn(`[Arbiter][${name}] Invalid rollup signature from ${publicKey.slice(0, 8)}`);
                return;
            }
            console.log(`[Arbiter][${name}] Rollup received for ${rollup.shard}: Root ${rollup.root.slice(0, 8)}`);
            lastRollups.set(rollup.shard, { ...rollup, proposer: publicKey });
        });

        getFraud(async (data) => {
            const { rollup: rollupData, witness } = data;
            const { rollup, signature, publicKey: proposerKey } = rollupData;
            
            // 1. Verify Proposer's signature on the rollup they submitted
            if (!await verifyMessage(JSON.stringify(rollup), signature, proposerKey)) return;

            // 2. Reconstruct leaf data from witness and verify each player's signature
            const leafData = [];
            const { hashStr: _hashStr } = await import('../src/rules.js');
            for (const { id, p, publicKey } of witness) {
                // Verify publicKey matches the ph (pidHash)
                const expectedPh = (_hashStr(publicKey) >>> 0).toString(16).padStart(8, '0');
                if (p.ph !== expectedPh) {
                    console.warn(`[Arbiter] Fraud Proof rejected: Public key mismatch for witness ${id}`);
                    continue;
                }

                const pData = { name: p.name, location: p.location, ph: p.ph, level: p.level, xp: p.xp, ts: p.ts };
                if (await verifyMessage(JSON.stringify(pData), p.signature, publicKey)) {
                    leafData.push(`${id}:${p.level}:${p.xp}:${p.location}`);
                }
            }
            leafData.sort();

            // 3. Compare roots
            const { createMerkleRoot: _createMerkleRoot } = await import('../src/crypto.js');
            const actualRoot = await _createMerkleRoot(leafData);

            if (actualRoot !== rollup.root) {
                console.log(`[FRAUD PROVEN] Proposer ${proposerKey.slice(0, 8)} submitted invalid root! Banning...`);
                bans.add(proposerKey);
                // Broadcast ban/reset event
                const banMsg = JSON.stringify({ event: 'ban', target: proposerKey });
                const banSig = await signMessage(banMsg, MASTER_SECRET_KEY);
                nostr.sendState({ state: { type: 'ban', target: proposerKey }, signature: banSig });
                torrent.sendState({ state: { type: 'ban', target: proposerKey }, signature: banSig });
            }
        });

        r.onPeerJoin(peerId => {
            console.log(`[Arbiter][${name}] Peer joined: ${peerId}`);
            broadcastState();
        });

        return { sendState };
    };

    const nostr = setupArbiterRoom(room, 'Nostr');
    const torrent = setupArbiterRoom(torrentRoom, 'Torrent');

    async function broadcastState() {
        const data = JSON.stringify(worldState);
        const signature = await signMessage(data, MASTER_SECRET_KEY);
        const packet = { state: worldState, signature };
        nostr.sendState(packet);
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

    setInterval(advanceDay, 86400000); // 24h real-time days

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

process.on('uncaughtException', (err) => {
    console.error('[Arbiter] Uncaught Exception:', err.message);
    process.exit(1);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Failed to start:', err);
});
