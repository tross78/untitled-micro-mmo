import { joinRoom } from 'trystero';
import { RTCPeerConnection } from 'werift';
import * as Y from 'yjs';
import pkg from 'tweetnacl-util';
import { signMessage } from '../src/crypto.js';
import { APP_ID, ROOM_NAME } from '../src/constants.js';
import dotenv from 'dotenv';

const { decodeBase64 } = pkg;
dotenv.config();

const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;

if (!MASTER_SECRET_KEY) {
    console.error('ERROR: MASTER_SECRET_KEY not found in environment.');
    process.exit(1);
}

const secretKey = decodeBase64(MASTER_SECRET_KEY);

// --- YJS STATE ---
const ydoc = new Y.Doc();
const yworld = ydoc.getMap('world');

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

// --- BLASEBALL-STYLE EVENT LOOP ---
const NARRATIVE_EVENTS = [
    "A thick fog rolls into the cellar.",
    "The wooden door creaks, but no one is there.",
    "A rogue umpire appeared and vanished.",
    "The ground trembles slightly.",
    "A faint smell of peanuts wafts through the hallway."
];

function broadcastEvent() {
    const event = NARRATIVE_EVENTS[Math.floor(Math.random() * NARRATIVE_EVENTS.length)];
    const signature = signMessage(event, secretKey);

    console.log(`[Arbiter] Broadcasting official event: ${event}`);
    sendOfficialEvent({ event, signature });
    
    // Update the world state CRDT as well
    yworld.set('lastEvent', event);
}

// Broadcast an event every 60 seconds
setInterval(broadcastEvent, 60000);

// Initial event
setTimeout(broadcastEvent, 5000);
