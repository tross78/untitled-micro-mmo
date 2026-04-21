import { joinRoom, selfId } from '@trystero-p2p/torrent';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import { world, validateMove, hashStr, seededRNG, nextMood } from './rules';
import { verifyMessage, generateKeyPair, importKey, exportKey } from './crypto';
import { MASTER_PUBLIC_KEY, APP_ID, ROOM_NAME } from './constants';

const output = document.getElementById('output');
const input = document.getElementById('input');

const log = (msg) => {
    output.textContent += `\n${msg}`;
    output.scrollTop = output.scrollHeight;
};

// --- IDENTITY & CRYPTO ---
let playerKeys = null;
let arbiterPublicKey = null;

const initIdentity = async () => {
    arbiterPublicKey = await importKey(MASTER_PUBLIC_KEY, 'public');
    const savedKeys = localStorage.getItem('hearthwick_keys');
    if (savedKeys) {
        const { publicKey, privateKey } = JSON.parse(savedKeys);
        playerKeys = {
            publicKey: await importKey(publicKey, 'public'),
            privateKey: await importKey(privateKey, 'private')
        };
        log(`[System] Identity verified.`);
    } else {
        log(`[System] Generating new identity...`);
        const keys = await generateKeyPair();
        const exported = {
            publicKey: await exportKey(keys.publicKey),
            privateKey: await exportKey(keys.privateKey)
        };
        localStorage.setItem('hearthwick_keys', JSON.stringify(exported));
        playerKeys = keys;
        log(`[System] New identity created and saved.`);
    }
};

// --- YJS STATE INITIALIZATION ---
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yevents = ydoc.getArray('event_log');

// Deterministic Simulation State
let worldState = {
    seed: '',
    day: 1,
    mood: 'weary'
};

const updateSimulation = () => {
    if (!yworld.has('world_seed')) return;

    worldState.seed = yworld.get('world_seed');
    worldState.day = yworld.get('day') || 1;
    
    // Seed RNG for the day
    const dailySeed = hashStr(worldState.seed + worldState.day);
    const rng = seededRNG(dailySeed);
    
    // Compute Daily Mood Deterministically
    const baseMood = yworld.get('town_mood') || 'weary';
    worldState.mood = nextMood(baseMood, rng);

    console.log(`[Simulation] Day ${worldState.day} | Seed: ${worldState.seed.slice(0,8)} | Mood: ${worldState.mood}`);
};

yworld.observe(() => {
    updateSimulation();
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
        } catch (e) { console.error(e); }
    }
};

const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        location: localPlayer.location,
        name: localPlayer.name
    }));
};

// --- NETWORKING: TRYSTERO ---
const config = { appId: APP_ID };
const room = joinRoom(config, ROOM_NAME);

const [sendSync, getSync] = room.makeAction('sync');
const [sendMove, getMove] = room.makeAction('move');
const [sendOfficialEvent, getOfficialEvent] = room.makeAction('official_event');

ydoc.on('update', (update, origin) => {
    if (origin !== 'remote') sendSync(update);
});

getSync((update, peerId) => {
    applyUpdate(ydoc, update, 'remote');
});

getOfficialEvent(async (data, peerId) => {
    const { event, signature } = data;
    if (await verifyMessage(event, signature, arbiterPublicKey)) {
        log(`\n[OFFICIAL] ${event}`);
    } else {
        log(`\n[System] Warning: Blocked an unsigned world event from peer ${peerId}.`);
    }
});

room.onPeerJoin(peerId => {
    log(`[System] Peer ${peerId} has connected.`);
    sendSync(encodeStateAsUpdate(ydoc), peerId);
});

getMove((data, peerId) => {
    log(`[System] ${peerId} moved to ${data.location}`);
});

// --- MAIN INITIALIZATION ---
const start = async () => {
    await initIdentity();
    loadLocalState();

    log(`\nWelcome to Hearthwick.`);
    log(`Your Peer ID: ${selfId}`);
    
    // Status Bar Style info
    setTimeout(() => {
        log(`\n--- WORLD STATUS ---`);
        log(`Day: ${worldState.day}`);
        log(`Mood: ${worldState.mood.toUpperCase()}`);
        log(`Seed: ${worldState.seed || 'Waiting for DHT...'}`);
        log(`--------------------\n`);
        
        log(`${world[localPlayer.location].name}`);
        log(world[localPlayer.location].description);
    }, 2000);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.value.trim();
            if (val) {
                if (val.startsWith('/')) handleCommand(val.slice(1));
                else log(`[System] Unknown input. Type /help for commands.`);
                input.value = '';
            }
        }
    });
};

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
                yevents.push([{
                    type: 'move', peer: selfId,
                    from: localPlayer.location, to: nextLoc, time: Date.now()
                }]);
            } else log(`You can't go that way.`);
            break;
        case 'clear':
            output.textContent = 'Screen cleared.';
            break;
        default:
            log(`Unknown command: ${command}`);
    }
}

start();
