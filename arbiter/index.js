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
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yevents = ydoc.getArray('event_log');

// Initialization of World
if (yworld.size === 0) {
    console.log('[Arbiter] Initializing new world seed...');
    yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
    yworld.set('day', 1);
    yworld.set('town_mood', 'weary');
}

// --- NETWORKING ---
const baseConfig = { appId: APP_ID, rtcPolyfill: { RTCPeerConnection } };
const room = joinNostr(baseConfig, ROOM_NAME);
const torrentRoom = joinTorrent({ ...baseConfig, trackerUrls: ['wss://tracker.openwebtorrent.com'] }, ROOM_NAME);

const setupArbiterActions = (r) => {
    const [sendSync, getSync] = r.makeAction('sync');
    const [sendOfficialEvent] = r.makeAction('official_event');
    ydoc.on('update', update => sendSync(update));
    getSync((update, peerId) => {
        Y.applyUpdate(ydoc, update, 'remote');
    });
    r.onPeerJoin(peerId => sendSync(Y.encodeStateAsUpdate(ydoc), peerId));
    return { sendOfficialEvent };
};

const actions = setupArbiterActions(room);
const torrentActions = setupArbiterActions(torrentRoom);

// --- DAILY NEWS LOOP ---
const NARRATIVE_EVENTS = [
    "A thick fog rolls into the town square.",
    "The tavern was unusually quiet last night.",
    "A rogue merchant was spotted near the ruins.",
    "The crops seem to be growing well this season.",
    "Faint music was heard coming from the cellar."
];

async function broadcastNews() {
    const day = yworld.get('day') || 1;
    const event = NARRATIVE_EVENTS[Math.floor(Math.random() * NARRATIVE_EVENTS.length)];
    const signature = await signMessage(event, secretKey);

    console.log(`[Arbiter] Day ${day} News: ${event}`);
    
    actions.sendOfficialEvent({ event, signature });
    torrentActions.sendOfficialEvent({ event, signature });
    
    // Save to permanent log with Day metadata
    yevents.push([{
        type: 'narrative',
        day: day,
        event: event,
        time: Date.now()
    }]);
}

// --- DEBUG: AUTO-ADVANCE DAY ---
// In production, this would be a midnight cron job.
// For now, let's increment the day every 30 minutes for testing.
setInterval(() => {
    const currentDay = yworld.get('day') || 1;
    yworld.set('day', currentDay + 1);
    console.log(`[Arbiter] A new day begins: Day ${currentDay + 1}`);
    broadcastNews();
}, 1800000);

setInterval(broadcastNews, 300000);
setTimeout(broadcastNews, 10000);
