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
        } else {
            const keys = await generateKeyPair();
            const exported = {
                publicKey: await exportKey(keys.publicKey),
                privateKey: await exportKey(keys.privateKey)
            };
            localStorage.setItem('hearthwick_keys_v2', JSON.stringify(exported));
            playerKeys = keys;
            log(`[System] New identity generated.`);
        }
    } catch (e) {
        localStorage.removeItem('hearthwick_keys_v2');
        throw e;
    }
};

// --- YJS STATE ---
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yplayers = ydoc.getMap('players');
const yevents = ydoc.getArray('event_log');

let worldState = { seed: '', day: 1, mood: 'weary' };

const updateSimulation = () => {
    if (!yworld.has('world_seed')) return;
    const newSeed = yworld.get('world_seed');
    const newDay = yworld.get('day') || 1;
    
    if (newSeed !== worldState.seed || newDay !== worldState.day) {
        const isNewDay = newDay !== worldState.day && worldState.seed !== '';
        worldState.seed = newSeed;
        worldState.day = newDay;
        const dailySeed = hashStr(worldState.seed + worldState.day);
        const rng = seededRNG(dailySeed);
        const baseMood = yworld.get('town_mood') || 'weary';
        worldState.mood = nextMood(baseMood, rng);

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            handleCommand('news');
        }
        printStatus();
    }
};

yworld.observe(() => updateSimulation());

// Helper to get a player's name from the mesh or fallback to ID
const getPlayerName = (id) => yplayers.get(id) || `Peer-${id.slice(0, 4)}`;

// Player local state
let localPlayer = { name: `Peer-${selfId.slice(0, 4)}`, location: 'cellar' };

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
    // Update global name map so others can see us
    yplayers.set(selfId, localPlayer.name);
};

const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        location: localPlayer.location,
        name: localPlayer.name
    }));
    yplayers.set(selfId, localPlayer.name);
};

// --- NETWORKING ---
let knownPeers = new Set();
let room;

const initNetworking = () => {
    const nostrRoom = joinNostr({ appId: APP_ID }, ROOM_NAME);
    const torrentRoom = joinTorrent({ appId: APP_ID, trackerUrls: ['wss://tracker.openwebtorrent.com'] }, ROOM_NAME);

    const setupActions = (r) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendMove, getMove] = r.makeAction('move');
        const [sendOfficialEvent, getOfficialEvent] = r.makeAction('official_event');

        ydoc.on('update', (update, origin) => { if (origin !== 'remote') sendSync(update); });
        getSync((update, peerId) => { applyUpdate(ydoc, update, 'remote'); });

        getOfficialEvent(async (data, peerId) => {
            const { event, signature } = data;
            if (await verifyMessage(event, signature, arbiterPublicKey)) {
                log(`\n[OFFICIAL] ${event}`, '#0ff');
            }
        });

        r.onPeerJoin(peerId => {
            if (!knownPeers.has(peerId)) {
                knownPeers.add(peerId);
                // Use timer to let yplayers sync before logging name
                setTimeout(() => {
                    log(`[System] ${getPlayerName(peerId)} joined.`, '#aaa');
                }, 1000);
                sendSync(encodeStateAsUpdate(ydoc), peerId);
            }
        });

        r.onPeerLeave(peerId => { knownPeers.delete(peerId); });

        getMove((data, peerId) => {
            log(`[System] ${getPlayerName(peerId)} moved to ${data.location}`, '#aaa');
        });

        return { sendMove, sendSync };
    };

    const actions = setupActions(nostrRoom);
    setupActions(torrentRoom);
    window.gameActions = actions;
    room = nostrRoom;
};

// --- UI DASHBOARD ---
const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Day: ${worldState.day}`, '#ffa500');
    log(`Town Mood: ${worldState.mood.toUpperCase()}`, '#ffa500');
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`Total Historical Events: ${yevents.length}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};

// --- MAIN ---
const start = async () => {
    try {
        await initIdentity();
        loadLocalState();
        initNetworking();

        log(`\nWelcome to Hearthwick.`);
        log(`Your Peer ID: ${selfId}`);
        printStatus();

        setTimeout(() => {
            log(`${world[localPlayer.location].name}`);
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
    } catch (err) { log(`[FATAL] Engine crash: ${err.message}`, '#f00'); }
};

function handleCommand(cmd) {
    const args = cmd.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case 'help':
            log('Commands: /help, /who, /look, /move <dir>, /rename <name>, /news, /status, /clear');
            break;
        case 'who':
            const names = Array.from(knownPeers).map(id => getPlayerName(id));
            log(`Current Peers (${knownPeers.size + 1}): You (${localPlayer.name}), ${names.join(', ') || 'None'}`);
            break;
        case 'look':
            const loc = world[localPlayer.location];
            log(`\n${loc.name}`);
            log(loc.description);
            break;
        case 'status':
            printStatus();
            break;
        case 'news':
            log(`\n--- THE HEARTHWICK CHRONICLE ---`, '#0ff');
            const allEvents = yevents.toArray();
            const history = {};
            allEvents.forEach(e => {
                const day = e.day || 0;
                if (!history[day]) history[day] = [];
                history[day].push(e);
            });
            const days = Object.keys(history).sort((a, b) => b - a).slice(0, 3);
            if (days.length === 0) log('The archives are empty.');
            days.forEach(d => {
                log(`Day ${d}:`, '#ffa500');
                history[d].slice(-5).forEach(e => {
                    if (e.type === 'narrative') log(`  - [OFFICIAL] ${e.event}`, '#0ff');
                    else if (e.type === 'move') log(`  - ${getPlayerName(e.peer)} moved to ${e.to}`, '#aaa');
                });
            });
            log(`--------------------------------\n`, '#0ff');
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
                    type: 'move', peer: selfId, day: worldState.day,
                    from: localPlayer.location, to: nextLoc, time: Date.now()
                }]);
            } else log(`You can't go that way.`);
            break;
        case 'clear':
            output.innerHTML = '';
            log('Screen cleared.');
            break;
        default:
            log(`Unknown command: ${command}`);
    }
}

start();
