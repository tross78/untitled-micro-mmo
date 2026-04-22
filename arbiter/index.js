import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';

// Polyfills for Node.js 18
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}
if (!globalThis.WebSocket) {
    globalThis.WebSocket = WebSocket;
}

async function startArbiter() {
    const { joinRoom: joinNostr, selfId } = await import('@trystero-p2p/nostr');
    const { joinRoom: joinTorrent } = await import('@trystero-p2p/torrent');
    const { RTCPeerConnection } = await import('werift');
    const Y = await import('yjs');
    const { signMessage } = await import('../src/crypto.js');
    const { APP_ID, ROOM_NAME } = await import('../src/constants.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;
    if (!MASTER_SECRET_KEY) { 
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1); 
    }

    const secretKey = MASTER_SECRET_KEY; 

    // --- STATE ---
    const ydoc = new Y.Doc();
    const yworld = ydoc.getMap('world');
    const yplayers = ydoc.getMap('players');
    const yevents = ydoc.getArray('event_log');

    if (yworld.size === 0) {
        console.log('[Arbiter] Initializing new world seed...');
        yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
        yworld.set('day', 1);
        yworld.set('town_mood', 'weary');
    }

    // Register arbiter in yplayers so browser clients can identify it by name
    yplayers.set(selfId, 'Arbiter');

    // --- LOG TRIMMING ---
    const MAX_LOG_SIZE = 500;
    function trimEventLog() {
        if (yevents.length > MAX_LOG_SIZE) {
            yevents.delete(0, yevents.length - MAX_LOG_SIZE);
        }
    }
    // Trim on every push, not just from broadcastNews
    yevents.observe(() => trimEventLog());

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

    const { NOSTR_RELAYS: ALL_NOSTR_RELAYS, TORRENT_TRACKERS: ALL_TORRENT_TRACKERS } = await import('../src/constants.js');

    const [reachableRelays, reachableTrackers] = await Promise.all([
        filterReachable(ALL_NOSTR_RELAYS),
        filterReachable(ALL_TORRENT_TRACKERS),
    ]);

    console.log(`[Arbiter] Reachable Nostr relays: ${reachableRelays.length}/${ALL_NOSTR_RELAYS.length}`);
    console.log(`[Arbiter] Reachable trackers: ${reachableTrackers.length}/${ALL_TORRENT_TRACKERS.length}`);

    const baseConfig = {
        appId: APP_ID,
        rtcPolyfill: RTCPeerConnection
    };

    const nostrConfig = {
        ...baseConfig,
        relayUrls: reachableRelays.length ? reachableRelays : ALL_NOSTR_RELAYS,
    };

    const torrentConfig = {
        ...baseConfig,
        trackerUrls: reachableTrackers.length ? reachableTrackers : ALL_TORRENT_TRACKERS,
    };

    console.log(`[Arbiter] Attempting to join mesh as ${selfId}...`);

    const room = joinNostr(nostrConfig, ROOM_NAME);
    const torrentRoom = joinTorrent(torrentConfig, ROOM_NAME);

    const setupArbiterRoom = (r, name) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendOfficialEvent] = r.makeAction('official_event');

        getSync((update, peerId) => {
            Y.applyUpdate(ydoc, update, 'remote');
            console.log(`[Arbiter][${name}] Synced state from peer ${peerId}`);
        });

        r.onPeerJoin(peerId => {
            console.log(`[Arbiter][${name}] Peer joined: ${peerId}`);
            sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
        });

        return { sendSync, sendOfficialEvent };
    };

    const nostr = setupArbiterRoom(room, 'Nostr');
    const torrent = setupArbiterRoom(torrentRoom, 'Torrent');

    // Single listener — broadcasts each local Yjs update over both meshes
    ydoc.on('update', (update, origin) => {
        if (origin !== 'remote') {
            nostr.sendSync(update);
            torrent.sendSync(update);
        }
    });

    console.log(`[Arbiter] Started.`);

    // --- NEWS LOOP ---
    const NARRATIVE_EVENTS = [
        "A thick fog rolls into the town square.",
        "The tavern was unusually quiet last night.",
        "A rogue merchant was spotted near the ruins.",
        "The crops seem to be growing well this season.",
        "Faint music was heard coming from the cellar.",
        "A strange owl was seen watching the hallway."
    ];

    let lastBroadcastDay = 0;

    async function broadcastNews() {
        const day = yworld.get('day') || 1;
        if (day === lastBroadcastDay) return; // deduplicate if day tick and interval collide
        lastBroadcastDay = day;

        const worldSeed = yworld.get('world_seed') || 'default';
        const { hashStr, seededRNG } = await import('../src/rules.js');
        const rng = seededRNG(hashStr(worldSeed + day + 'news'));
        const event = NARRATIVE_EVENTS[rng(NARRATIVE_EVENTS.length)];
        const signature = await signMessage(event, secretKey);

        console.log(`[Arbiter] Day ${day} News: ${event}`);

        try {
            nostr.sendOfficialEvent({ event, signature });
            torrent.sendOfficialEvent({ event, signature });
        } catch (e) {
            console.warn('[Arbiter] Broadcast partially failed:', e.message);
        }

        yevents.push([{ type: 'narrative', day, event, time: Date.now() }]);
    }

    // Tick day every 60s for testing (change to 86400000 for production)
    setInterval(() => {
        const currentDay = yworld.get('day') || 1;
        yworld.set('day', currentDay + 1);
        console.log(`[Arbiter] A new day begins: Day ${currentDay + 1}`);
        broadcastNews();
    }, 60000);

    // Initial news on startup
    setTimeout(broadcastNews, 10000);
}

const SURVIVABLE_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);
const SURVIVABLE_MESSAGES = ['unsupported', 'DECODER', 'SSL', 'certificate'];

const isSurvivable = (err) =>
    SURVIVABLE_ERRORS.has(err.code) ||
    SURVIVABLE_MESSAGES.some(m => err.message?.includes(m));

process.on('uncaughtException', (err) => {
    console.error('[Arbiter] Uncaught Exception:', err.message);
    if (isSurvivable(err)) {
        console.log('[Arbiter] Networking error (relay/TLS), continuing...');
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[Arbiter] Unhandled Rejection:', err.message);
    if (!isSurvivable(err)) process.exit(1);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Failed to start:', err);
});
