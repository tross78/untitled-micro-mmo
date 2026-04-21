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

    dotenv.config();
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;
    if (!MASTER_SECRET_KEY) { 
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1); 
    }

    const secretKey = MASTER_SECRET_KEY; 

    // --- STATE ---
    const ydoc = new Y.Doc();
    const yworld = ydoc.getMap('world');
    const yevents = ydoc.getArray('event_log');

    if (yworld.size === 0) {
        console.log('[Arbiter] Initializing new world seed...');
        yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
        yworld.set('day', 1);
        yworld.set('town_mood', 'weary');
    }

    // --- LOG TRIMMING ---
    const MAX_LOG_SIZE = 500;
    function trimEventLog() {
        if (yevents.length > MAX_LOG_SIZE) {
            yevents.delete(0, yevents.length - MAX_LOG_SIZE);
        }
    }

    // --- NETWORKING ---
    const baseConfig = { 
        appId: APP_ID, 
        rtcPolyfill: RTCPeerConnection 
    };

    // Explicitly provide stable relays to avoid 0.0.0.0 fallbacks
    const nostrConfig = {
        ...baseConfig,
        relayUrls: [
            'wss://relay.damus.io',
            'wss://nos.lol',
            'wss://relay.snort.social'
        ]
    };

    const torrentConfig = {
        ...baseConfig,
        trackerUrls: ['wss://tracker.openwebtorrent.com']
    };

    console.log(`[Arbiter] Attempting to join mesh as ${selfId}...`);

    const room = joinNostr(nostrConfig, ROOM_NAME);
    const torrentRoom = joinTorrent(torrentConfig, ROOM_NAME);

    const setupArbiterActions = (r, name) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendOfficialEvent] = r.makeAction('official_event');
        
        ydoc.on('update', update => sendSync(update));
        
        getSync((update, peerId) => {
            Y.applyUpdate(ydoc, update, 'remote');
            console.log(`[Arbiter][${name}] Synced state from peer ${peerId}`);
        });

        r.onPeerJoin(peerId => {
            console.log(`[Arbiter][${name}] Peer joined: ${peerId}`);
            sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
        });

        return { sendOfficialEvent };
    };

    const actions = setupArbiterActions(room, 'Nostr');
    const torrentActions = setupArbiterActions(torrentRoom, 'Torrent');

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

    async function broadcastNews() {
        const day = yworld.get('day') || 1;
        const event = NARRATIVE_EVENTS[Math.floor(Math.random() * NARRATIVE_EVENTS.length)];
        const signature = await signMessage(event, secretKey);

        console.log(`[Arbiter] Day ${day} News: ${event}`);
        
        // Broadcast on both meshes
        try {
            actions.sendOfficialEvent({ event, signature });
            torrentActions.sendOfficialEvent({ event, signature });
        } catch (e) {
            console.warn('[Arbiter] Broadcast partially failed:', e.message);
        }
        
        yevents.push([{
            type: 'narrative', day: day,
            event: event, time: Date.now()
        }]);

        trimEventLog();
    }

    // Tick day every 60s for testing
    setInterval(() => {
        const currentDay = yworld.get('day') || 1;
        yworld.set('day', currentDay + 1);
        console.log(`[Arbiter] A new day begins: Day ${currentDay + 1}`);
        broadcastNews();
    }, 60000);

    setInterval(broadcastNews, 300000);
    setTimeout(broadcastNews, 10000);
}

// Global error handler to prevent Node from crashing on P2P socket issues
process.on('uncaughtException', (err) => {
    console.error('[Arbiter] Uncaught Exception:', err.message);
    if (err.code === 'ECONNREFUSED') {
        console.log('[Arbiter] Networking error (Relay down), continuing...');
    } else {
        // For other errors, it's safer to exit and let PM2 restart us
        process.exit(1);
    }
});

startArbiter().catch(err => {
    console.error('[Arbiter] Failed to start:', err);
});
