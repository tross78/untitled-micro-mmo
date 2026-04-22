// Suppress Trystero's hardcoded-relay noise — can't override their defaults, but we can quiet them.
const _warn = console.warn.bind(console);
console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Trystero:')) return;
    _warn(...args);
};

import { joinRoom as joinNostr, selfId } from '@trystero-p2p/nostr';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs';
import {
    world, validateMove, hashStr, seededRNG,
    ENEMIES, ITEMS, DEFAULT_PLAYER_STATS,
    resolveAttack, rollLoot, xpToLevel, levelBonus,
    deriveWorldState, deriveNarrative, EVENT_TYPES,
} from './rules';
import { verifyMessage, generateKeyPair, importKey, exportKey } from './crypto';
import { MASTER_PUBLIC_KEY, APP_ID, ROOM_NAME, NOSTR_RELAYS, TORRENT_TRACKERS, ICE_SERVERS } from './constants';

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
        // Compact stable fingerprint from Ed25519 public key (8 hex chars vs 44)
        const exported = JSON.parse(localStorage.getItem('hearthwick_keys_v3'));
        localPlayer.ph = pidHash(exported.publicKey);
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

let worldState = { seed: '', day: 0, mood: '', season: '', seasonNumber: 1, threatLevel: 0, scarcity: [] };

const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Day: ${worldState.day}  Season: ${worldState.season ? worldState.season.toUpperCase() + ' (Year ' + worldState.seasonNumber + ')' : 'Unknown'}`, '#ffa500');
    log(`Town Mood: ${worldState.mood ? worldState.mood.toUpperCase() : 'UNKNOWN'}`, '#ffa500');
    log(`Threat Level: ${worldState.threatLevel}`, '#ffa500');
    if (worldState.scarcity.length > 0) log(`Scarce Goods: ${worldState.scarcity.join(', ')}`, '#f55');
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`Total Events: ${yevents.length}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};

const updateSimulation = () => {
    if (!yworld.has('world_seed')) return;
    const newSeed = yworld.get('world_seed');
    const newDay = yworld.get('day') || 1;

    if (newSeed !== worldState.seed || newDay !== worldState.day) {
        const wasDisconnected = worldState.day === 0;
        const isNewDay = newDay > worldState.day && !wasDisconnected;
        worldState.seed = newSeed;
        worldState.day = newDay;
        // Derive all world state locally — only seed+day come from Yjs
        const derived = deriveWorldState(newSeed, newDay);
        worldState.mood = derived.mood;
        worldState.season = derived.season;
        worldState.seasonNumber = derived.seasonNumber;
        worldState.threatLevel = derived.threatLevel;
        worldState.scarcity = derived.scarcity;

        if (wasDisconnected) {
            log(`\n[System] Connected — Day ${worldState.day}, ${worldState.mood.toUpperCase()}.`, '#aaa');
            printStatus();
            // Rebroadcast to any peers who joined before we had world state
            if (knownPeers.size > 0) gameActions.broadcastSync();
        } else if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            handleCommand('news');
            printStatus();
        }
        // Subsequent syncs from the same state (second transport arriving) are silent
    }
};

yworld.observe(() => updateSimulation());

// --- PVP ---
// pendingDuel: { challengerId (full), challengerName, expiresAt }
let pendingDuel = null;
// sentChallenges: targetId (full) → expiresAt — tracks challenges we sent, so we can verify accepts
const sentChallenges = new Map();
const DUEL_TIMEOUT_MS = 60000;

function resolvePvp(challengerId, targetId) {
    // Both peers call this with the same args (challenger first) → identical seed → identical outcome
    const seed = hashStr(challengerId + targetId + worldState.day);
    const rng = seededRNG(seed);
    const bonus = levelBonus(localPlayer.level);
    const myAtk = localPlayer.attack + bonus.attack;
    const myDef = localPlayer.defense + bonus.defense;
    let myDmgTotal = 0, theirDmgTotal = 0;
    for (let i = 0; i < 3; i++) {
        myDmgTotal   += resolveAttack(myAtk, 3,     rng);
        theirDmgTotal += resolveAttack(10,   myDef, rng);
    }
    return myDmgTotal > theirDmgTotal ? 'win' : myDmgTotal < theirDmgTotal ? 'loss' : 'draw';
}

yevents.observe((event) => {
    // Don't process PvP events until world state is initialized
    if (!worldState.day) return;

    event.changes.added.forEach(item => {
        item.content.getContent().forEach(e => {
            if (e.type === EVENT_TYPES.PVP_CHALLENGE && e.target === selfId) {
                // Don't overwrite an existing unexpired challenge
                if (pendingDuel && Date.now() < pendingDuel.expiresAt) {
                    log(`\n[DUEL] ${e.fromName} wants to duel but you already have a pending challenge.`, '#aaa');
                    return;
                }
                pendingDuel = { challengerId: e.from, challengerName: e.fromName, expiresAt: Date.now() + DUEL_TIMEOUT_MS };
                log(`\n[DUEL] ${e.fromName} challenges you to a duel! Type /accept or /decline. (expires in 60s)`, '#ff0');
                setTimeout(() => {
                    if (pendingDuel?.challengerId === e.from) {
                        pendingDuel = null;
                        log(`[DUEL] Challenge from ${e.fromName} expired.`, '#aaa');
                    }
                }, DUEL_TIMEOUT_MS);
            }

            if (e.type === EVENT_TYPES.PVP_ACCEPT && e.target === selfId) {
                // Only process if we actually sent this challenge
                const expires = sentChallenges.get(e.from);
                if (!expires || Date.now() > expires) return;
                sentChallenges.delete(e.from);

                const outcome = resolvePvp(selfId, e.from);
                const dmg = outcome === 'loss' ? Math.floor(localPlayer.hp * 0.3) : 0;
                if (outcome === 'win') {
                    log(`\n[DUEL] ${e.fromName} accepted! You WIN the duel! (+10 XP)`, '#ff0');
                    localPlayer.xp += 10;
                } else if (outcome === 'loss') {
                    log(`\n[DUEL] ${e.fromName} accepted! You LOSE and take ${dmg} damage.`, '#f55');
                    localPlayer.hp = Math.max(1, localPlayer.hp - dmg);
                } else {
                    log(`\n[DUEL] ${e.fromName} accepted! The duel ends in a DRAW.`, '#aaa');
                }
                // Store full IDs in result so getPlayerName lookups work
                yevents.push([{ type: EVENT_TYPES.PVP_RESULT, from: selfId, target: e.from, outcome, day: worldState.day }]);
                saveLocalState();
            }
        });
    });
});

const getPlayerEntry = (id) => yplayers.get(id);
// pidHash: stable 32-bit fingerprint — stored in yplayers instead of full 44-char base64 key
const pidHash = (playerId) => playerId ? (hashStr(playerId) >>> 0).toString(16).padStart(8, '0') : null;
const getTag = (ph) => ph ? ph.slice(0, 4) : '????';
const getPlayerName = (id) => {
    const entry = getPlayerEntry(id);
    if (!entry) return `Peer-${id.slice(0, 4)}`;
    const name = typeof entry === 'string' ? entry : (entry.name || `Peer-${id.slice(0, 4)}`);
    const tag = typeof entry === 'object' && entry.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};
const getPlayerBaseName = (id) => {
    const entry = getPlayerEntry(id);
    if (!entry) return `Peer-${id.slice(0, 4)}`;
    return typeof entry === 'string' ? entry : (entry.name || `Peer-${id.slice(0, 4)}`);
};
const getPlayerLocation = (id) => {
    const entry = getPlayerEntry(id);
    return entry && typeof entry === 'object' ? entry.location : null;
};
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
    // Remove stale entries from previous sessions (same playerId, different selfId)
    if (localPlayer.ph) {
        ydoc.transact(() => {
            yplayers.forEach((entry, id) => {
                if (id !== selfId && typeof entry === 'object' && entry.ph === localPlayer.ph) {
                    yplayers.delete(id);
                }
            });
        }, 'cleanup');
    }
    yplayers.set(selfId, { name: localPlayer.name, location: localPlayer.location, ph: localPlayer.ph });
};
const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
    yplayers.set(selfId, { name: localPlayer.name, location: localPlayer.location, ph: localPlayer.ph });
};

// --- NETWORKING ---
let knownPeers = new Set();    // currently connected
let announcedPeers = new Set(); // ever announced — survives relay reconnects
const peerLastSeen = new Map(); // peerId → timestamp of last leave
let gameActions = {};

const initNetworking = () => {
    const rtcConfig = { iceServers: ICE_SERVERS };
    const nostrRoom = joinNostr({ appId: APP_ID, relayUrls: NOSTR_RELAYS, rtcConfig }, ROOM_NAME);
    const torrentRoom = joinTorrent({ appId: APP_ID, trackerUrls: TORRENT_TRACKERS, rtcConfig }, ROOM_NAME);

    const setupRoom = (r) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendSV,   getSV  ] = r.makeAction('sv');
        const [sendMove, getMove] = r.makeAction('move');
        const [, getOfficialEvent] = r.makeAction('official_event');

        // Peer sends us its state vector → reply with only the delta it's missing
        getSV((sv, peerId) => {
            const diff = encodeStateAsUpdate(ydoc, new Uint8Array(sv));
            if (diff.length > 2) sendSync(diff, peerId);
        });

        getSync((update) => { applyUpdate(ydoc, update, 'remote'); });

        getOfficialEvent(async (data) => {
            const { event, signature } = data;
            if (!await verifyMessage(event, signature, arbiterPublicKey)) return;
            if (event === 'reset') {
                log(`\n[SYSTEM] The Arbiter has reset the world. Reloading in 3s...`, '#f00');
                setTimeout(() => {
                    localStorage.removeItem(STORAGE_KEY);
                    location.reload();
                }, 3000);
                return;
            }
            log(`\n[OFFICIAL] ${event}`, '#0ff');
        });

        r.onPeerJoin(peerId => {
            knownPeers.add(peerId);
            const RECONNECT_WINDOW_MS = 30000;
            const isQuickReconnect = (Date.now() - (peerLastSeen.get(peerId) || 0)) < RECONNECT_WINDOW_MS;
            peerLastSeen.delete(peerId);
            if (!announcedPeers.has(peerId)) {
                announcedPeers.add(peerId);
                // Send our state vector — peer replies with only what we're missing
                sendSV(Array.from(encodeStateVector(ydoc)), peerId);
                setTimeout(() => {
                    const name = getPlayerName(peerId);
                    if (name !== 'Arbiter') log(`[System] ${name} joined.`, '#aaa');
                }, 1500);
            } else if (!isQuickReconnect) {
                sendSV(Array.from(encodeStateVector(ydoc)), peerId);
            }
        });
        r.onPeerLeave(peerId => {
            knownPeers.delete(peerId);
            peerLastSeen.set(peerId, Date.now());
        });

        getMove((data, peerId) => {
            log(`[System] ${getPlayerName(peerId)} moved to ${data.to}.`, '#aaa');
        });

        return { sendSync, sendMove };
    };

    const nostr = setupRoom(nostrRoom);
    const torrent = setupRoom(torrentRoom);

    // Gossip relay: forward remote updates so partial-mesh peers converge.
    // Hop limit = 2: kills exponential amplification while bridging 1 missing link.
    // Local writes (origin falsy) always broadcast unrestricted.
    const seen = new Set();
    ydoc.on('update', (update, origin) => {
        // Deduplicate by first 8 bytes (Yjs clock prefix) to avoid echo storms
        const key = update.slice(0, 8).join(',');
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > 500) seen.clear(); // bounded memory

        const hops = (origin === 'remote') ? 1 : 0;
        if (hops < 2) {
            nostr.sendSync(update);
            torrent.sendSync(update);
        }
    });

    gameActions = {
        sendMove: (data, peerId) => {
            nostr.sendMove(data, peerId);
            torrent.sendMove(data, peerId);
        },
        broadcastSync: () => {
            const update = encodeStateAsUpdate(ydoc);
            nostr.sendSync(update);
            torrent.sendSync(update);
        },
    };
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
            log('Commands: /help, /who, /look, /move <dir>, /attack, /duel <name>, /accept, /decline, /stats, /inventory, /use <item>, /rest, /rename <name>, /news, /status, /clear');
            break;

        case 'who': {
            const allPeers = Array.from(yplayers.keys()).filter(id => id !== selfId);
            const peerList = allPeers.map(id => {
                const name = getPlayerName(id);
                const loc = getPlayerLocation(id);
                const connected = knownPeers.has(id) ? '' : ' ~';
                return loc ? `${name} (${loc})${connected}` : `${name}${connected}`;
            });
            const myTag = getTag(localPlayer.ph);
            const myDisplay = localPlayer.ph ? `${localPlayer.name}#${myTag}` : localPlayer.name;
            log(`In world (${allPeers.length + 1}): You — ${myDisplay} (${localPlayer.location}), ${peerList.join(', ') || 'None'}`);
            log(`~ = known but not directly connected`, '#555');
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
                yevents.push([{ type: EVENT_TYPES.KILL, peer: selfId.slice(0, 8), day: worldState.day, entity: loc.enemy }]);
            }

            if (localPlayer.hp <= 0) {
                log(`\nYou have been slain by the ${enemyDef.name}!`, '#f00');
                localPlayer.hp = Math.floor((localPlayer.maxHp + levelBonus(localPlayer.level).maxHp) / 2);
                localPlayer.location = 'cellar';
                localPlayer.currentEnemy = null;
                yevents.push([{ type: EVENT_TYPES.DEATH, peer: selfId.slice(0, 8), day: worldState.day, entity: loc.enemy }]);
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
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) { log(`Usage: /use <item name>`); break; }
            // Match by item ID or display name (case-insensitive)
            const idx = localPlayer.inventory.findIndex(id =>
                id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query
            );
            if (idx === -1) { log(`You don't have "${query}". Check /inventory.`); break; }
            const itemId = localPlayer.inventory[idx];
            const item = ITEMS[itemId];
            if (!item) { log(`Unknown item.`); break; }
            if (item.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                localPlayer.hp = Math.min(localPlayer.maxHp + bonus.maxHp, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                log(`You use the ${item.name} and recover ${item.heal} HP. (HP: ${localPlayer.hp}/${localPlayer.maxHp + bonus.maxHp})`, '#0f0');
                saveLocalState();
            } else if (item.type === 'weapon') {
                log(`You already have the ${item.name} equipped — it gives you +${item.bonus} attack.`);
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
                    // Compact schema
                    if (e.type === 'n')      log(`  - [OFFICIAL] ${deriveNarrative(worldState.seed, e.day)}`, '#0ff');
                    else if (e.type === 'm') log(`  - ${getPlayerName(e.peer)} moved from ${e.from} to ${e.to}`, '#aaa');
                    else if (e.type === 'k') log(`  - ${getPlayerName(e.peer)} slew a ${ENEMIES[e.entity]?.name || e.entity}`, '#0f0');
                    else if (e.type === 'd') log(`  - ${getPlayerName(e.peer)} was slain by a ${ENEMIES[e.entity]?.name || e.entity}`, '#f55');
                    else if (e.type === 'pc') log(`  - ${e.fromName} challenged ${getPlayerName(e.target)} to a duel`, '#ff0');
                    else if (e.type === 'pr') {
                        const w = getPlayerName(e.from); const l = getPlayerName(e.target);
                        if (e.outcome === 'win') log(`  - ${w} defeated ${l} in a duel`, '#ff0');
                        else if (e.outcome === 'loss') log(`  - ${l} defeated ${w} in a duel`, '#ff0');
                        else log(`  - ${w} and ${l} dueled to a draw`, '#aaa');
                    }
                    // Legacy schema fallback (until 500 events flush through)
                    else if (e.type === 'narrative')    log(`  - [OFFICIAL] ${e.event}`, '#0ff');
                    else if (e.type === 'move')         log(`  - ${getPlayerName(e.peer)} moved from ${e.from} to ${e.to}`, '#aaa');
                    else if (e.type === 'player_kill')  log(`  - ${getPlayerName(e.peer)} slew a ${e.entity}`, '#0f0');
                    else if (e.type === 'player_death') log(`  - ${getPlayerName(e.peer)} was slain by a ${e.entity}`, '#f55');
                });
            });
            log(`--------------------------------\n`, '#0ff');
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { log(`Usage: /rename <name>`); break; }
            const myTag = getTag(localPlayer.ph);
            const taken = Array.from(yplayers.entries()).some(([id, entry]) => {
                if (id === selfId) return false;
                const name = typeof entry === 'string' ? entry : entry?.name;
                const tag = typeof entry === 'object' && entry.ph ? getTag(entry.ph) : null;
                // Same base name AND same tag = same person (shouldn't happen). Same base name + different tag = allowed.
                return name?.toLowerCase() === newName.toLowerCase() && tag === myTag;
            });
            if (taken) {
                log(`[System] "${newName}" is already taken. Choose another name.`, '#f55');
            } else {
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
                yevents.push([{ type: EVENT_TYPES.MOVE, peer: selfId.slice(0, 8), day: worldState.day, from: prevLoc, to: nextLoc }]);
            } else {
                log(`You can't go that way.`);
            }
            break;
        }

        case 'duel': {
            const targetName = args.slice(1).join(' ').toLowerCase();
            if (!targetName) { log(`Usage: /duel <player name>`); break; }
            if (localPlayer.currentEnemy) { log(`Finish your current fight first.`); break; }

            const targetId = Array.from(yplayers.keys()).find(id => {
                if (id === selfId) return false;
                const entry = yplayers.get(id);
                const name = typeof entry === 'string' ? entry : entry?.name;
                const tag = typeof entry === 'object' && entry.ph ? getTag(entry.ph) : null;
                const tagged = tag ? `${name}#${tag}`.toLowerCase() : name?.toLowerCase();
                const loc = typeof entry === 'object' ? entry?.location : null;
                const matches = name?.toLowerCase() === targetName || tagged === targetName;
                return matches && name?.toLowerCase() !== 'arbiter' && loc === localPlayer.location;
            });

            if (!targetId) { log(`No player named "${args.slice(1).join(' ')}" is in your location.`); break; }
            const tName = getPlayerName(targetId);
            sentChallenges.set(targetId, Date.now() + DUEL_TIMEOUT_MS);
            setTimeout(() => sentChallenges.delete(targetId), DUEL_TIMEOUT_MS);
            yevents.push([{ type: EVENT_TYPES.PVP_CHALLENGE, from: selfId, fromName: localPlayer.name, target: targetId, day: worldState.day }]);
            log(`[DUEL] You challenge ${tName} to a duel!`, '#ff0');
            break;
        }

        case 'accept': {
            if (!pendingDuel || Date.now() > pendingDuel.expiresAt) { log(`No pending duel challenge.`); pendingDuel = null; break; }
            const { challengerId, challengerName } = pendingDuel;
            pendingDuel = null;
            yevents.push([{ type: EVENT_TYPES.PVP_ACCEPT, from: selfId, fromName: localPlayer.name, target: challengerId, day: worldState.day }]);

            // Defender resolves with same args as challenger (challengerId first) then flips perspective
            const outcome = resolvePvp(challengerId, selfId);
            const myOutcome = outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw';
            const dmg = myOutcome === 'loss' ? Math.floor(localPlayer.hp * 0.3) : 0;
            if (myOutcome === 'win') {
                log(`[DUEL] You WIN the duel against ${challengerName}! (+10 XP)`, '#ff0');
                localPlayer.xp += 10;
            } else if (myOutcome === 'loss') {
                log(`[DUEL] You LOSE the duel to ${challengerName} and take ${dmg} damage.`, '#f55');
                localPlayer.hp = Math.max(1, localPlayer.hp - dmg);
            } else {
                log(`[DUEL] The duel with ${challengerName} ends in a DRAW.`, '#aaa');
            }
            saveLocalState();
            break;
        }

        case 'decline': {
            if (!pendingDuel) { log(`No pending duel challenge.`); break; }
            log(`[DUEL] You decline ${pendingDuel.challengerName}'s challenge.`, '#aaa');
            pendingDuel = null;
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
