import { joinRoom, selfId } from '@trystero-p2p/torrent';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import {
    world, validateMove, hashStr, seededRNG, nextMood,
    ENEMIES, ITEMS, DEFAULT_PLAYER_STATS,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
} from './rules';
import { verifyMessage, generateKeyPair, importKey, exportKey } from './crypto';
import { MASTER_PUBLIC_KEY, APP_ID, ROOM_NAME, TORRENT_TRACKERS } from './constants';

const output = document.getElementById('output');
const input = document.getElementById('input');

const log = (msg, color = '#0f0') => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = color;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
};

// --- IDENTITY ---
let playerKeys = null;
let arbiterPublicKey = null;

const initIdentity = async () => {
    try {
        arbiterPublicKey = await importKey(MASTER_PUBLIC_KEY, 'public');
        const savedKeys = localStorage.getItem('hearthwick_keys_v3');
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
            localStorage.setItem('hearthwick_keys_v3', JSON.stringify(exported));
            playerKeys = keys;
            log(`[System] New identity generated.`);
        }
    } catch (e) {
        console.error('Identity Init Failed', e);
        localStorage.removeItem('hearthwick_keys_v3');
        throw e;
    }
};

// --- STATE ---
const ydoc = new Doc();
const yworld = ydoc.getMap('world');
const yplayers = ydoc.getMap('players');
const yevents = ydoc.getArray('event_log');

let worldState = { seed: '', day: 0, mood: '' };

const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Day: ${worldState.day}`, '#ffa500');
    log(`Town Mood: ${worldState.mood ? worldState.mood.toUpperCase() : 'UNKNOWN'}`, '#ffa500');
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`Total Events: ${yevents.length}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};

const updateSimulation = () => {
    if (!yworld.has('world_seed')) return;
    const newSeed = yworld.get('world_seed');
    const newDay = yworld.get('day') || 1;

    if (newSeed !== worldState.seed || newDay !== worldState.day) {
        const isNewDay = newDay > worldState.day && worldState.day !== 0;
        worldState.seed = newSeed;
        worldState.day = newDay;

        const dailySeed = hashStr(worldState.seed + worldState.day);
        const rng = seededRNG(dailySeed);
        const baseMood = yworld.get('town_mood') || 'weary';
        worldState.mood = nextMood(baseMood, rng);
        yworld.set('town_mood', worldState.mood);

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            handleCommand('news');
            printStatus();
        } else {
            log(`\n[System] World synced — Day ${worldState.day}, mood: ${worldState.mood.toUpperCase()}.`, '#aaa');
        }
    }
};

yworld.observe(() => updateSimulation());

const getPlayerName = (id) => yplayers.get(id) || `Peer-${id.slice(0, 4)}`;
let localPlayer = { name: `Peer-${selfId.slice(0, 4)}`, location: 'cellar', ...DEFAULT_PLAYER_STATS };

// --- PERSISTENCE ---
const STORAGE_KEY = 'hearthwick_state_v4';
const loadLocalState = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            Object.assign(localPlayer, data);
            log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) { console.error(e); }
    }
    yplayers.set(selfId, localPlayer.name);
};
const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
    yplayers.set(selfId, localPlayer.name);
};

// --- NETWORKING ---
let knownPeers = new Set();
let gameActions = {};

const initNetworking = () => {
    const torrentRoom = joinRoom({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS }, ROOM_NAME);

    const setupRoom = (r) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendMove, getMove] = r.makeAction('move');
        const [, getOfficialEvent] = r.makeAction('official_event');

        getSync((update) => { applyUpdate(ydoc, update, 'remote'); });

        getOfficialEvent(async (data) => {
            const { event, signature } = data;
            if (await verifyMessage(event, signature, arbiterPublicKey)) {
                log(`\n[OFFICIAL] ${event}`, '#0ff');
            }
        });

        r.onPeerJoin(peerId => {
            if (!knownPeers.has(peerId)) {
                knownPeers.add(peerId);
                setTimeout(() => log(`[System] ${getPlayerName(peerId)} joined.`, '#aaa'), 1000);
                sendSync(encodeStateAsUpdate(ydoc), peerId);
            }
        });
        r.onPeerLeave(peerId => { knownPeers.delete(peerId); });

        getMove((data, peerId) => {
            log(`[System] ${getPlayerName(peerId)} moved to ${data.to}.`, '#aaa');
        });

        return { sendSync, sendMove };
    };

    const transport = setupRoom(torrentRoom);

    ydoc.on('update', (update, origin) => {
        if (origin !== 'remote') transport.sendSync(update);
    });

    gameActions = { sendMove: transport.sendMove };
};

// --- MAIN ---
const start = async () => {
    try {
        await initIdentity();
        loadLocalState();
        initNetworking();

        log(`\nWelcome to Hearthwick.`);
        log(`Your Peer ID: ${selfId}`);
        log(`[System] Connecting to the world...`, '#aaa');

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
            log('Commands: /help, /who, /look, /move <dir>, /attack, /stats, /inventory, /use <item>, /rest, /rename <name>, /news, /status, /clear');
            break;

        case 'who': {
            const names = Array.from(knownPeers).map(id => getPlayerName(id));
            log(`Current Peers (${knownPeers.size + 1}): You (${localPlayer.name}), ${names.join(', ') || 'None'}`);
            break;
        }

        case 'look': {
            const loc = world[localPlayer.location];
            log(`\n${loc.name}`);
            log(loc.description);
            if (loc.enemy && localPlayer.currentEnemy) {
                log(`A wounded ${ENEMIES[loc.enemy].name} is here! (HP: ${localPlayer.currentEnemy.hp})`, '#f55');
            } else if (loc.enemy) {
                log(`A ${ENEMIES[loc.enemy].name} lurks here. Type /attack to engage.`, '#f55');
            }
            break;
        }

        case 'status':
            printStatus();
            break;

        case 'stats': {
            const bonus = levelBonus(localPlayer.level);
            log(`\n--- ${localPlayer.name.toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp}`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${localPlayer.maxHp + bonus.maxHp}`, '#ffa500');
            log(`Attack: ${localPlayer.attack + bonus.attack}  Defense: ${localPlayer.defense + bonus.defense}`, '#ffa500');
            log(`Gold: ${localPlayer.gold}`, '#ffa500');
            break;
        }

        case 'inventory': {
            if (localPlayer.inventory.length === 0) {
                log(`Your pack is empty.`);
            } else {
                log(`\nInventory:`, '#ffa500');
                localPlayer.inventory.forEach(id => log(`  - ${ITEMS[id]?.name || id}`, '#ffa500'));
            }
            break;
        }

        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { log(`There is nothing to fight here.`); break; }

            const enemyDef = ENEMIES[loc.enemy];
            if (!localPlayer.currentEnemy) {
                localPlayer.currentEnemy = { type: loc.enemy, hp: enemyDef.hp };
                log(`\nA ${enemyDef.name} snarls and lunges!`, '#f55');
            }

            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound);
            localPlayer.combatRound++;
            const rng = seededRNG(combatSeed);

            const bonus = levelBonus(localPlayer.level);
            const playerDmg = resolveAttack(localPlayer.attack + bonus.attack, enemyDef.defense, rng);
            const enemyDmg = resolveAttack(enemyDef.attack, localPlayer.defense + bonus.defense, rng);

            localPlayer.currentEnemy.hp -= playerDmg;
            localPlayer.hp -= enemyDmg;

            log(`You hit the ${enemyDef.name} for ${playerDmg}. (Enemy HP: ${Math.max(0, localPlayer.currentEnemy.hp)}/${enemyDef.hp})`, '#0f0');
            log(`The ${enemyDef.name} hits you for ${enemyDmg}. (Your HP: ${Math.max(0, localPlayer.hp)}/${localPlayer.maxHp + bonus.maxHp})`, '#f55');

            if (localPlayer.currentEnemy.hp <= 0) {
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                const newLevel = xpToLevel(localPlayer.xp);
                loot.forEach(itemId => {
                    if (ITEMS[itemId]?.type === 'gold') localPlayer.gold += ITEMS[itemId].amount;
                    else localPlayer.inventory.push(itemId);
                });
                log(`\nYou defeated the ${enemyDef.name}! (+${enemyDef.xp} XP)`, '#ff0');
                if (loot.length > 0) log(`Loot: ${loot.map(i => ITEMS[i]?.name || i).join(', ')}`, '#ff0');
                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    log(`LEVEL UP! You are now level ${localPlayer.level}!`, '#ff0');
                }
                localPlayer.currentEnemy = null;
                yevents.push([{ type: 'player_kill', peer: selfId, day: worldState.day, entity: enemyDef.name, time: Date.now() }]);
            }

            if (localPlayer.hp <= 0) {
                log(`\nYou have been slain by the ${enemyDef.name}!`, '#f00');
                localPlayer.hp = Math.floor((localPlayer.maxHp + levelBonus(localPlayer.level).maxHp) / 2);
                localPlayer.location = 'cellar';
                localPlayer.currentEnemy = null;
                yevents.push([{ type: 'player_death', peer: selfId, day: worldState.day, entity: enemyDef.name, time: Date.now() }]);
                log(`You wake in the cellar...`, '#aaa');
                handleCommand('look');
            }

            saveLocalState();
            break;
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { log(`You can't rest mid-combat!`); break; }
            const bonus = levelBonus(localPlayer.level);
            const cap = localPlayer.maxHp + bonus.maxHp;
            const healed = Math.min(10, cap - localPlayer.hp);
            localPlayer.hp += healed;
            log(`You rest and recover ${healed} HP. (HP: ${localPlayer.hp}/${cap})`, '#0f0');
            saveLocalState();
            break;
        }

        case 'use': {
            const itemId = args[1];
            const idx = localPlayer.inventory.indexOf(itemId);
            if (idx === -1) { log(`You don't have "${itemId}". Check /inventory.`); break; }
            const item = ITEMS[itemId];
            if (!item) { log(`Unknown item.`); break; }
            if (item.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                localPlayer.hp = Math.min(localPlayer.maxHp + bonus.maxHp, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                log(`You use the ${item.name} and recover ${item.heal} HP. (HP: ${localPlayer.hp}/${localPlayer.maxHp + bonus.maxHp})`, '#0f0');
                saveLocalState();
            } else {
                log(`You can't use that here.`);
            }
            break;
        }

        case 'news': {
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
                    if (e.type === 'narrative')    log(`  - [OFFICIAL] ${e.event}`, '#0ff');
                    else if (e.type === 'move')    log(`  - ${getPlayerName(e.peer)} moved from ${e.from} to ${e.to}`, '#aaa');
                    else if (e.type === 'player_kill')  log(`  - ${getPlayerName(e.peer)} slew a ${e.entity}`, '#0f0');
                    else if (e.type === 'player_death') log(`  - ${getPlayerName(e.peer)} was slain by a ${e.entity}`, '#f55');
                });
            });
            log(`--------------------------------\n`, '#0ff');
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ');
            if (newName) {
                localPlayer.name = newName;
                saveLocalState();
                log(`[System] You are now known as ${newName}`);
            }
            break;
        }

        case 'move': {
            const dir = args[1];
            const nextLoc = validateMove(localPlayer.location, dir);
            if (nextLoc) {
                if (localPlayer.currentEnemy) {
                    log(`You can't flee mid-combat! Defeat the enemy first.`);
                    break;
                }
                const prevLoc = localPlayer.location;
                localPlayer.location = nextLoc;
                saveLocalState();
                log(`You move ${dir}.`);
                handleCommand('look');
                gameActions.sendMove({ from: prevLoc, to: nextLoc });
                yevents.push([{
                    type: 'move', peer: selfId, day: worldState.day,
                    from: prevLoc, to: nextLoc, time: Date.now()
                }]);
            } else {
                log(`You can't go that way.`);
            }
            break;
        }

        case 'clear':
            output.innerHTML = '';
            log('Screen cleared.');
            break;

        default:
            log(`Unknown command: ${command}. Type /help.`);
    }
}

start();
