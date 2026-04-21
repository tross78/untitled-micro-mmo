import { joinRoom, selfId } from '@trystero-p2p/torrent';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import pkg from 'tweetnacl-util';
import { world, validateMove, hashStr, seededRNG } from './rules';
import { verifyMessage } from './crypto';
import { MASTER_PUBLIC_KEY, APP_ID, ROOM_NAME } from './constants';

const { decodeBase64 } = pkg;
const output = document.getElementById('output');
const input = document.getElementById('input');

const log = (msg) => {
    output.textContent += `\n${msg}`;
    output.scrollTop = output.scrollHeight;
};

// --- ARBITER VERIFICATION ---
const arbiterPublicKey = decodeBase64(MASTER_PUBLIC_KEY);

// --- YJS STATE INITIALIZATION ---
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yevents = ydoc.getArray('event_log');

// Initialization of World Seed (Only once at creation)
if (yworld.size === 0) {
    // This will only be run by the first person to create the doc (usually the Arbiter)
    yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
    yworld.set('day', 1);
}

// Deterministic Simulation Setup
let rng = seededRNG(0);
let worldSeed = '';

yworld.observe(() => {
    if (yworld.has('world_seed')) {
        worldSeed = yworld.get('world_seed');
        const day = yworld.get('day') || 1;
        const dailySeed = hashStr(worldSeed + day);
        rng = seededRNG(dailySeed);
        console.log(`[Deterministic] Seeded for day ${day} with daily seed ${dailySeed}`);
    }
});

// Player local state
let localPlayer = {
    name: `Peer-${selfId.slice(0, 4)}`,
    location: 'cellar'
};

// --- PERSISTENCE: LOCALSTORAGE ---
const STORAGE_KEY = 'hearthwick_state';
const loadLocalState = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            localPlayer.location = data.location || 'cellar';
            localPlayer.name = data.name || localPlayer.name;
            log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) {
            console.error('Failed to load local state', e);
        }
    }
};
const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        location: localPlayer.location,
        name: localPlayer.name
    }));
};

loadLocalState();

// --- NETWORKING: TRYSTERO ---
const config = { appId: APP_ID };
const room = joinRoom(config, ROOM_NAME);

const [sendSync, getSync] = room.makeAction('sync');
const [sendMove, getMove] = room.makeAction('move');
const [sendOfficialEvent, getOfficialEvent] = room.makeAction('official_event');

// Sync Yjs state via Trystero
ydoc.on('update', (update, origin) => {
    if (origin !== 'remote') {
        sendSync(update);
    }
});

getSync((update, peerId) => {
    applyUpdate(ydoc, update, 'remote');
});

// Verify Official Events (from Arbiter)
getOfficialEvent((data, peerId) => {
    const { event, signature } = data;
    if (verifyMessage(event, signature, arbiterPublicKey)) {
        log(`\n[OFFICIAL] ${event}`);
    } else {
        log(`\n[System] Warning: Blocked an unsigned world event from peer ${peerId}.`);
    }
});

log(`Welcome to Hearthwick.`);
log(`Your Peer ID: ${selfId}`);
log(`\n${world[localPlayer.location].name}`);
log(world[localPlayer.location].description);

room.onPeerJoin(peerId => {
    log(`[System] Peer ${peerId} has connected.`);
    sendSync(encodeStateAsUpdate(ydoc), peerId);
});

room.onPeerLeave(peerId => {
    log(`[System] Peer ${peerId} has disconnected.`);
});

getMove((data, peerId) => {
    // Deterministic validation will go here in Iteration 5
    log(`[System] ${peerId} moved to ${data.location}`);
});

// --- INPUT HANDLING ---
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) {
            if (val.startsWith('/')) {
                handleCommand(val.slice(1));
            } else {
                log(`[System] Unknown input. Type /help for commands.`);
            }
            input.value = '';
        }
    }
});

function handleCommand(cmd) {
    const args = cmd.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case 'help':
            log('Commands: /help, /who, /look, /move <dir>, /rename <name>, /clear');
            break;
        case 'who':
            const peers = Object.keys(room.getPeers());
            log(`Current Peers (${peers.length + 1}): You, ${peers.join(', ') || 'None'}`);
            break;
        case 'look':
            const loc = world[localPlayer.location];
            log(`\n${loc.name}`);
            log(loc.description);
            break;
        case 'rename':
            const newName = args.slice(1).join(' ');
            if (newName) {
                localPlayer.name = newName;
                saveLocalState();
                log(`[System] You are now known as ${newName}`);
            }
            break;
        case 'move':
            const dir = args[1];
            const nextLoc = validateMove(localPlayer.location, dir);
            if (nextLoc) {
                localPlayer.location = nextLoc;
                saveLocalState();
                sendMove({ location: localPlayer.location });
                log(`You move ${dir}.`);
                handleCommand('look');
                
                // Log event locally (Deterministic validation later)
                yevents.push([{
                    type: 'move',
                    peer: selfId,
                    from: localPlayer.location,
                    to: nextLoc,
                    time: Date.now()
                }]);
            } else {
                log(`You can't go that way.`);
            }
            break;
        case 'clear':
            output.textContent = 'Screen cleared.';
            break;
        default:
            log(`Unknown command: ${command}`);
    }
}
