import { joinRoom, selfId } from 'trystero';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import pkg from 'tweetnacl-util';
import { world, validateMove } from './rules';
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
const yplayers = ydoc.getMap('players');
const yworld = ydoc.getMap('world');

// Player state
let localPlayer = {
    name: `Peer-${selfId.slice(0, 4)}`,
    location: 'cellar'
};

// --- PERSISTENCE: LOCALSTORAGE ---
const STORAGE_KEY = 'micro_mmo_state';
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

log(`Welcome to the Micro-MMO.`);
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
    log(`[System] ${peerId} moved to ${data.location}`);
});

// Observe world changes (Ticker fallback/legacy)
yworld.observe(event => {
    if (yworld.has('lastEvent')) {
        // Only log if it's new. Official events are now handled via signed broadcast.
    }
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
            log(`Current Peers: ${Object.keys(room.getPeers()).join(', ') || 'None'}`);
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
