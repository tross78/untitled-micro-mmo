import { joinRoom as joinNostr, selfId } from '@trystero-p2p/nostr';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import { world, validateMove, hashStr, seededRNG, nextMood } from './rules';
import { verifyMessage, generateKeyPair, importKey, exportKey } from './crypto';
import { MASTER_PUBLIC_KEY, APP_ID, ROOM_NAME } from './constants';

const output = document.getElementById('output');
const input = document.getElementById('input');

const log = (msg, color = '#0f0') => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = color;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
};

// --- IDENTITY & CRYPTO ---
let playerKeys = null;
let arbiterPublicKey = null;

const initIdentity = async () => {
    try {
        arbiterPublicKey = await importKey(MASTER_PUBLIC_KEY, 'public');
        const savedKeys = localStorage.getItem('hearthwick_keys_v2');
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
            localStorage.setItem('hearthwick_keys_v2', JSON.stringify(exported));
            playerKeys = keys;
            log(`[System] New identity created and saved.`);
        }
    } catch (e) {
        log(`[CRITICAL ERROR] Cryptography initialization failed.`, '#f00');
        localStorage.removeItem('hearthwick_keys_v2');
        throw e;
    }
};

// --- YJS STATE INITIALIZATION ---
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yevents = ydoc.getArray('event_log');

let worldState = { seed: '', day: 1, mood: 'weary' };

const updateSimulation = () => {
    if (!yworld.has('world_seed')) return;

    const newSeed = yworld.get('world_seed');
    const newDay = yworld.get('day') || 1;
    
    if (newSeed !== worldState.seed || newDay !== worldState.day) {
        worldState.seed = newSeed;
        worldState.day = newDay;
        
        const dailySeed = hashStr(worldState.seed + worldState.day);
        const rng = seededRNG(dailySeed);
        const baseMood = yworld.get('town_mood') || 'weary';
        worldState.mood = nextMood(baseMood, rng);

        log(`\n--- WORLD STATUS UPDATED ---`, '#ffa500');
        log(`Day: ${worldState.day}`, '#ffa500');
        log(`Town Mood: ${worldState.mood.toUpperCase()}`, '#ffa500');
        log(`World Seed: ${worldState.seed.slice(0, 12)}...`, '#ffa500');
        log(`----------------------------\n`, '#ffa500');
    }
};

yworld.observe(() => updateSimulation());

// Player local state
let localPlayer = {
    name: `Peer-${selfId.slice(0, 4)}`,
    location: 'cellar'
};

// --- PERSISTENCE ---
const STORAGE_KEY = 'hearthwick_state_v2';
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

// --- NETWORKING: MULTI-STRATEGY ---
let room;
const initNetworking = () => {
    const config = { 
        appId: APP_ID,
        trackerUrls: [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.files.fm:7072/announce'
        ]
    };

    room = joinNostr(config, ROOM_NAME);
    const torrentRoom = joinTorrent(config, ROOM_NAME);

    const setupActions = (r) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendMove, getMove] = r.makeAction('move');
        const [sendOfficialEvent, getOfficialEvent] = r.makeAction('official_event');

        ydoc.on('update', (update, origin) => {
            if (origin !== 'remote') sendSync(update);
        });

        getSync((update, peerId) => {
            applyUpdate(ydoc, update, 'remote');
        });

        getOfficialEvent(async (data, peerId) => {
            const { event, signature } = data;
            if (await verifyMessage(event, signature, arbiterPublicKey)) {
                log(`\n[OFFICIAL] ${event}`, '#0ff');
            }
        });

        r.onPeerJoin(peerId => {
            log(`[System] Peer ${peerId} joined the mesh.`, '#aaa');
            sendSync(encodeStateAsUpdate(ydoc), peerId);
        });

        getMove((data, peerId) => {
            log(`[System] ${peerId} moved to ${data.location}`, '#aaa');
        });

        return { sendMove, sendSync };
    };

    const actions = setupActions(room);
    setupActions(torrentRoom);

    window.gameActions = actions;
};

// --- MAIN INITIALIZATION ---
const start = async () => {
    try {
        await initIdentity();
        loadLocalState();
        initNetworking();

        log(`\nWelcome to Hearthwick.`);
        log(`Your Peer ID: ${selfId}`);
        log(`Waiting for World Seed from the Arbiter...`, '#aaa');
        
        setTimeout(() => {
            log(`\n${world[localPlayer.location].name}`);
            log(world[localPlayer.location].description);
        }, 1000);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim();
                if (val) {
                    if (val.startsWith('/')) handleCommand(val.slice(1));
                    else log(`[System] Unknown input. Type /help for commands.`, '#aaa');
                    input.value = '';
                }
            }
        });
    } catch (err) {
        log(`[FATAL] Engine crash: ${err.message}`, '#f00');
    }
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
                log(`You move ${dir}.`);
                handleCommand('look');
                yevents.push([{
                    type: 'move', peer: selfId,
                    from: localPlayer.location, to: nextLoc, time: Date.now()
                }]);
            } else log(`You can't go that way.`);
            break;
        case 'clear':
            output.innerHTML = 'Screen cleared.';
            break;
        default:
            log(`Unknown command: ${command}`);
    }
}

start();
