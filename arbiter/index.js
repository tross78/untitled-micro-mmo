import { joinRoom as joinNostr } from '@trystero-p2p/nostr';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { RTCPeerConnection } from 'werift';
import * as Y from 'yjs';
import { signMessage } from '../src/crypto.js';
import { APP_ID, ROOM_NAME } from '../src/constants.js';
import dotenv from 'dotenv';

dotenv.config();

const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;

if (!MASTER_SECRET_KEY) {
    console.error('ERROR: MASTER_SECRET_KEY not found in environment.');
    process.exit(1);
}

const secretKey = MASTER_SECRET_KEY; 

// --- YJS STATE ---
const ydoc = new Y.Doc();
const yworld = ydoc.getMap('world');
const yevents = ydoc.getArray('event_log');

// Initialization of World (If the Arbiter is the first one in)
if (yworld.size === 0) {
    console.log('[Arbiter] Initializing new world seed...');
    yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
    yworld.set('day', 1);
    yworld.set('town_mood', 'weary');
}

// --- NETWORKING ---
const config = {
    appId: APP_ID,
    rtcPolyfill: { RTCPeerConnection },
    trackerUrls: [
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.files.fm:7072/announce'
    ]
};

// Join both networks for maximum visibility
const room = joinNostr(config, ROOM_NAME);
const torrentRoom = joinTorrent(config, ROOM_NAME);

const setupArbiterActions = (r) => {
    const [sendSync, getSync] = r.makeAction('sync');
    const [sendOfficialEvent] = r.makeAction('official_event');

    ydoc.on('update', update => {
        sendSync(update);
    });

    getSync((update, peerId) => {
        Y.applyUpdate(ydoc, update, 'remote');
        console.log(`[Arbiter] Synced state from peer ${peerId}`);
    });

    r.onPeerJoin(peerId => {
        console.log(`[Arbiter] Peer joined: ${peerId}`);
        sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
    });

    return { sendOfficialEvent };
};

const actions = setupArbiterActions(room);
const torrentActions = setupArbiterActions(torrentRoom);

console.log(`[Arbiter] Started as peer ${room.selfId}`);

// --- DAILY NEWS LOOP ---
const NARRATIVE_EVENTS = [
    "A thick fog rolls into the town square.",
    "The tavern was unusually quiet last night.",
    "A rogue merchant was spotted near the ruins.",
    "The crops seem to be growing well this season.",
    "Faint music was heard coming from the cellar."
];

async function broadcastNews() {
    const event = NARRATIVE_EVENTS[Math.floor(Math.random() * NARRATIVE_EVENTS.length)];
    const signature = await signMessage(event, secretKey);

    console.log(`[Arbiter] Broadcasting official news: ${event}`);
    
    // Broadcast on both meshes
    actions.sendOfficialEvent({ event, signature });
    torrentActions.sendOfficialEvent({ event, signature });
    
    yevents.push([{
        type: 'narrative',
        event: event,
        time: Date.now()
    }]);
}

setInterval(broadcastNews, 300000);
setTimeout(broadcastNews, 10000);
