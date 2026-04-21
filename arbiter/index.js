import { joinRoom } from '@trystero-p2p/torrent';
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

// Node.js specific: MASTER_SECRET_KEY is passed directly to the universal crypto module
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
    rtcPolyfill: { RTCPeerConnection }
};

const room = joinRoom(config, ROOM_NAME);
const [sendSync, getSync] = room.makeAction('sync');
const [sendOfficialEvent, getOfficialEvent] = room.makeAction('official_event');

console.log(`[Arbiter] Started as peer ${room.selfId}`);

// Sync Yjs state
ydoc.on('update', update => {
    sendSync(update);
});

getSync((update, peerId) => {
    Y.applyUpdate(ydoc, update, 'remote');
    console.log(`[Arbiter] Synced state from peer ${peerId}`);
});

room.onPeerJoin(peerId => {
    console.log(`[Arbiter] Peer joined: ${peerId}`);
    sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
});

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
    
    // Use the universal crypto module to sign
    const signature = await signMessage(event, secretKey);

    console.log(`[Arbiter] Broadcasting official news: ${event}`);
    sendOfficialEvent({ event, signature });
    
    // Log it in the event source
    yevents.push([{
        type: 'narrative',
        event: event,
        time: Date.now()
    }]);
}

// Broadcast an event every 5 minutes (Slowed down for realism)
setInterval(broadcastNews, 300000);

// Initial event
setTimeout(broadcastNews, 10000);
