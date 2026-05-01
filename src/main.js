import { selfId } from './transport.js';
import { 
    worldState, players, localPlayer, hasSyncedWithArbiter,
    TAB_CHANNEL, loadLocalState, pruneStale, pendingDuel, pendingTrade, setPendingTrade, shardEnemies
} from './store.js';
import { saveLocalState, flushSync } from './persistence.js';
import { log, renderActionButtons, startTicker } from './ui.js';
import {
    renderWorld, setVisualRefreshCallback, setLogicalRefreshCallback,
    showDialogue, advanceDialogue, isDialogueOpen,
    showToast, showRoomBanner, showItemFanfare, showLevelUp, triggerHitFlash,
    showFloatingText, setTicker
} from './renderer.js';
import { 
    playHit, playCrit, playLevelUp, playPickup, playPortal as playExit, playDeath
} from './audio.js';
import { 
    initIdentity, arbiterPublicKey, myEntry 
} from './identity.js';
import {
    initNetworking, gameActions, lastValidStatePacket, updateSimulation, joinInstance, currentInstance, currentRtcConfig, preJoinShard
} from './networking.js';
import { globalRooms, rooms } from './networking.js';
import {
    handleCommand, getPlayerName, startStateChannel, resolveRound, grantItem
} from './commands.js';
import { verifyMessage, importKey } from './crypto.js';
import { bus } from './eventbus.js';
import { inputManager, ACTION } from './input.js';
import { getSuggestions } from './autocomplete.js';
import { initAds, showBanner } from './ads.js';
import { 
    world, ITEMS, GAME_NAME, NPCS, QUESTS, ENEMIES
} from './data.js';
import {
    GH_GIST_ID, GH_GIST_USERNAME, ARBITER_URL
} from './constants.js';
import { getNPCLocation } from './rules.js';
import { getArbiterUrl, getRuntimeParam, isE2EMode, resolveBootstrapArbiterUrl } from './runtime.js';

const input = document.getElementById('input');
const suggestionsEl = document.getElementById('suggestions');
const output = document.getElementById('output');
const E2E_MODE = isE2EMode();
const HEARTBEAT_MS = 30000;

/**
 * Global UI refresh trigger. Call this whenever state changes.
 */
// Move the player one tile in (stepX, stepY). If the step exits the zone boundary,
// auto-transition to the adjacent room via the matching exit entry point.
let isMoving = false;
const stepPlayer = async (stepX, stepY) => {
    if (isMoving) return;

    // Combat Guard: check shard state to see if enemy is still alive
    if (localPlayer.currentEnemy) {
        const shared = shardEnemies.get(localPlayer.location);
        if (shared && shared.hp > 0) return; // Block move
        localPlayer.currentEnemy = null; // Clear if dead
    }

    isMoving = true;
    
    try {
        const loc = world[localPlayer.location];
        const nextX = localPlayer.x + stepX;
        const nextY = localPlayer.y + stepY;

        // Predictive pre-join: start WebRTC negotiation for adjacent rooms
        const px = localPlayer.x, py = localPlayer.y;
        for (const tile of (loc.exitTiles || [])) {
            if (Math.abs(tile.x - px) + Math.abs(tile.y - py) <= 2) preJoinShard(tile.dest);
        }
        const exits = loc.exits || {};
        if (px <= 1 && exits.west) preJoinShard(exits.west);
        if (px >= loc.width - 2 && exits.east) preJoinShard(exits.east);
        if (py <= 1 && exits.north) preJoinShard(exits.north);
        if (py >= loc.height - 2 && exits.south) preJoinShard(exits.south);

        const outOfBounds = nextX < 0 || nextX >= loc.width || nextY < 0 || nextY >= loc.height;

        if (!outOfBounds) {
            localPlayer.x = nextX;
            localPlayer.y = nextY;
            saveLocalState(localPlayer);
            if (gameActions.sendMove) gameActions.sendMove({ from: localPlayer.location, to: localPlayer.location, x: nextX, y: nextY });

            // Exit tile check (interior doorways)
            const exit = ( loc.exitTiles || []).find(p => p.x === nextX && p.y === nextY);
            if (exit) {
                const prevLoc = localPlayer.location;
                localPlayer.location = exit.dest;
                localPlayer.x = exit.destX ?? 5;
                localPlayer.y = exit.destY ?? 5;
                saveLocalState(localPlayer);
                
                // Join new shard BEFORE broadcasting to ensure shardActions are updated
                await joinInstance(exit.dest, currentInstance, currentRtcConfig);
                
                const entry = await myEntry();
                if (entry && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: exit.dest, x: localPlayer.x, y: localPlayer.y });
                
                bus.emit('player:move', { from: prevLoc, to: exit.dest });
                triggerLogicalRefresh();
                return;
            }
            triggerLogicalRefresh();
            return;
        }

        // Out of bounds — find the exit direction and transition
        const dirMap = [
            { sx: 0, sy: -1, dir: 'north' }, { sx: 0, sy: 1, dir: 'south' },
            { sx: -1, sy: 0, dir: 'west' },  { sx: 1, sy: 0, dir: 'east' },
            { sx: 0, sy: -1, dir: 'up' },    { sx: 0, sy: 1, dir: 'down' },
        ];
        const match = dirMap.find(d => d.sx === stepX && d.sy === stepY);
        const destId = match && loc.exits?.[match.dir];
        if (!destId || !world[destId]) return; // no exit, treat as wall

        // Use the exit that leads to destId for the entry position
        const entryExit = ( loc.exitTiles || []).find(p => p.dest === destId);
        const prevLoc = localPlayer.location;
        localPlayer.location = destId;
        localPlayer.x = entryExit?.destX ?? Math.floor(world[destId].width / 2);
        localPlayer.y = entryExit?.destY ?? Math.floor(world[destId].height / 2);
        saveLocalState(localPlayer);
        
        // Join new shard BEFORE broadcasting
        await joinInstance(destId, currentInstance, currentRtcConfig);
        
        const entry = await myEntry();
        if (entry && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
        if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: destId, x: localPlayer.x, y: localPlayer.y });
        
        bus.emit('player:move', { from: prevLoc, to: destId });
        triggerLogicalRefresh();
    } finally {
        const MOVE_COOLDOWN = 150; // ms per tile
        setTimeout(() => { isMoving = false; }, MOVE_COOLDOWN);
    }
};

let _vRefreshTimer = null;
const triggerVisualRefresh = () => {
    if (_vRefreshTimer) return;
    _vRefreshTimer = requestAnimationFrame(() => {
        _vRefreshTimer = null;
        const ctx = {
            localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, pendingDuel, pendingTrade, players, shardEnemies
        };
        renderWorld(ctx, (tx, ty, entity) => {
            const loc = world[localPlayer.location];
            if (tx < 0 || tx >= loc.width || ty < 0 || ty >= loc.height) return;
            if (entity?.type === 'npc') { handleCommand(`talk ${entity.id}`).then(triggerLogicalRefresh); return; }
            if (entity?.type === 'enemy') { handleCommand('attack').then(triggerLogicalRefresh); return; }
            const dx = tx - localPlayer.x;
            const dy = ty - localPlayer.y;
            if (dx === 0 && dy === 0) return;
            const stepX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
            const stepY = stepX === 0 && dy !== 0 ? (dy > 0 ? 1 : -1) : 0;
            stepPlayer(stepX, stepY);
        });
    });
};

let _lRefreshTimer = null;
const triggerLogicalRefresh = () => {
    if (_lRefreshTimer) return;
    _lRefreshTimer = setTimeout(() => {
        _lRefreshTimer = null;
        const ctx = {
            localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, pendingDuel, pendingTrade, players, shardEnemies
        };
        renderActionButtons(ctx, (cmdOrAction) => {
            const ACTION_VALUES = new Set(Object.values(ACTION));
            if (ACTION_VALUES.has(cmdOrAction)) {
                bus.emit('input:action', { action: cmdOrAction, type: 'down' });
            } else {
                handleCommand(cmdOrAction).then(triggerLogicalRefresh);
            }
        });
        triggerVisualRefresh();
    }, 50);
};

const buildTestSnapshot = () => ({
    selfId,
    localPlayer: {
        name: localPlayer.name,
        location: localPlayer.location,
        x: localPlayer.x,
        y: localPlayer.y,
        hp: localPlayer.hp,
        xp: localPlayer.xp,
        level: localPlayer.level,
        gold: localPlayer.gold,
        ph: localPlayer.ph,
    },
    worldState: {
        seed: worldState.seed,
        day: worldState.day,
        mood: worldState.mood,
    },
    peers: Array.from(players.entries()).map(([id, entry]) => ({
        id,
        name: entry.name,
        location: entry.location,
        x: entry.x,
        y: entry.y,
        ph: entry.ph,
        ghost: !!entry.ghost,
        hasPublicKey: !!entry.publicKey,
    })),
    network: {
        globalPeers: globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0,
        shardPeers: rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0,
        synced: hasSyncedWithArbiter,
    },
    dialogueOpen: isDialogueOpen(),
    outputText: output?.textContent || '',
});

const installE2ETestApi = () => {
    if (!E2E_MODE || typeof window === 'undefined') return;
    window.__HEARTHWICK_TEST__ = {
        getSnapshot: () => buildTestSnapshot(),
        issueCommand: async (cmd) => {
            await handleCommand(cmd);
            triggerLogicalRefresh();
            return buildTestSnapshot();
        },
        step: async (dx, dy) => {
            await stepPlayer(dx, dy);
            triggerLogicalRefresh();
            return buildTestSnapshot();
        },
        wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    };
};

// --- IDENTITY & P2P BOOTSTRAP ---
const start = async () => {
    try {
        // Run state loading then identity key initialization sequentially.
        // initIdentity must run second to ensure its derivation of 'ph' wins.
        await loadLocalState(log);
        await initIdentity(log);
        await resolveBootstrapArbiterUrl();
        if (E2E_MODE && getRuntimeParam('debugnet') === '1') {
            localStorage.setItem(`${GAME_NAME}_debug`, 'true');
        }
        initAds();
        showBanner();
        inputManager.init();

        setVisualRefreshCallback(triggerVisualRefresh);
        setLogicalRefreshCallback(triggerLogicalRefresh);

        bus.on('combat:hit', ({ _attacker, crit }) => {
            if (crit) playCrit(); else playHit();
            triggerHitFlash();
        });
        bus.on('combat:dodge', ({ target }) => {
            if (target === 'You') {
                showFloatingText(localPlayer.x, localPlayer.y, 'DODGE', '#0fa');
            } else {
                const loc = world[localPlayer.location];
                const ex = loc.enemyX ?? Math.floor(loc.width / 2);
                const ey = loc.enemyY ?? Math.floor(loc.height / 2);
                showFloatingText(ex, ey, 'MISS', '#fff');
            }
        });
        bus.on('combat:death', ({ entity }) => {
            if (entity === 'You') playDeath();
            else playPickup();
        });
        bus.on('player:levelup', ({ level }) => {
            playLevelUp();
            showLevelUp(level);
        });
        bus.on('item:pickup', ({ item }) => {
            playPickup();
            if (item?.name) showItemFanfare(item.name);
        });
        bus.on('player:move', ({ to, from }) => {
            if (to !== from) {
                playExit();
                const roomName = world[to]?.name;
                if (roomName) showRoomBanner(roomName);
            }
        });
        bus.on('npc:speak', ({ npcName, text }) => {
            showDialogue(npcName, text);
        });

        bus.on('log', ({ msg }) => {
            // Strip HTML tags for toast display
            const cleanMsg = msg.replace(/<[^>]*>?/gm, '');
            showToast(cleanMsg);
        });

        bus.on('input:action', ({ action, type }) => {
            if (type !== 'down') return;

            // Movement: tile-by-tile via stepPlayer, not room-jump commands
            const STEP = {
                [ACTION.MOVE_N]: [0, -1], [ACTION.MOVE_S]: [0, 1],
                [ACTION.MOVE_E]: [1, 0],  [ACTION.MOVE_W]: [-1, 0],
            };
            if (STEP[action]) { stepPlayer(...STEP[action]); return; }

            let cmd = null;
            switch (action) {
                case ACTION.ATTACK: cmd = 'attack'; break;
                case ACTION.INTERACT: cmd = 'interact'; break;
                case ACTION.INVENTORY: cmd = 'inventory'; break;
                case ACTION.CANCEL: cmd = 'back'; break;
                case ACTION.CONFIRM: cmd = 'confirm'; break;
                case ACTION.MENU: cmd = 'status'; break;
            }
            if (cmd) {
                if (cmd === 'back') {
                    bus.emit('ui:back', {});
                    triggerLogicalRefresh();
                } else {
                    handleCommand(cmd).then(triggerLogicalRefresh);
                }
            }
        });

        // Ask other open tabs for state before touching the network
        TAB_CHANNEL.postMessage({ type: 'request_state' });

        // P2P State Rescue
        setTimeout(() => {
            if (localPlayer.xp === 0 && gameActions.sendStateRequest) {
                log(`[System] Local state empty. Requesting rescue from peers...`, '#aaa');
                gameActions.sendStateRequest(localPlayer.ph);
            }
        }, 5000);

        const processBeacon = async (packet, source) => {
            if (!packet || hasSyncedWithArbiter) return;
            const { state, signature, snapshot } = packet;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            const valid = await verifyMessage(stateStr, signature, arbiterPublicKey).catch(() => false);
            if (valid) {
                log(`[System] Fast-Path connected via ${source}!`, '#0f0');
                TAB_CHANNEL.postMessage({ type: 'state', packet });
                const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
                updateSimulation(stateObj);
                if (snapshot) {
                    const { seedFromSnapshot } = await import('./networking.js');
                    // Only seed ghosts for the current room — avoids polluting the
                    // players map and sketch with stale entries from other shards.
                    const localLoc = localPlayer?.location;
                    const filtered = localLoc
                        ? snapshot.filter(e => e.location === localLoc)
                        : snapshot;
                    seedFromSnapshot(filtered);
                }
                triggerLogicalRefresh();
            } else {
                console.warn(`[System] Beacon from ${source} failed verification.`);
            }
        };

        // Gist Discovery
        if (!E2E_MODE && GH_GIST_ID && GH_GIST_USERNAME && !hasSyncedWithArbiter) {
            const directUrl = `https://gist.githubusercontent.com/${GH_GIST_USERNAME}/${GH_GIST_ID}/raw/mmo_arbiter_discovery.json?t=${Date.now()}`;
            fetch(directUrl, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : Promise.reject('Direct fail'))
                .then(packet => processBeacon(packet, 'GitHub Gist (Direct)'))
                .catch(() => {
                    fetch(`https://api.github.com/gists/${GH_GIST_ID}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(gist => {
                            const file = gist?.files?.['mmo_arbiter_discovery.json'];
                            if (file?.raw_url) return fetch(file.raw_url + '?t=' + Date.now()).then(r => r.json());
                            return null;
                        })
                        .then(packet => processBeacon(packet, 'GitHub Gist (API)'))
                        .catch(() => {});
                });
        }

        // HTTP bootstrap
        const runtimeArbiterUrl = getArbiterUrl(ARBITER_URL);
        if (!E2E_MODE && runtimeArbiterUrl && !hasSyncedWithArbiter) {
            fetch(`${runtimeArbiterUrl}/state`, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : null)
                .then(async packet => {
                    if (!packet || hasSyncedWithArbiter) return;
                    processBeacon(packet, 'HTTP');
                })
                .catch(() => {});
        }

        // Identity keys are ready (Promise.all above completed), so the first onPeerJoin
        // handshake fires signed immediately — no polling delay for playerKeys.
        await initNetworking();
        startTicker(worldState, setTicker);
        if (E2E_MODE) {
            const forcedName = getRuntimeParam('name');
            if (forcedName) {
                localPlayer.name = forcedName;
                saveLocalState(localPlayer, true);
            }
        }

        // Heartbeat for presence
        setInterval(async () => {
            if (typeof gameActions.sendPresenceSingle === 'function') {
                const entry = await myEntry();
                if (entry) gameActions.sendPresenceSingle(entry);
            }
        }, HEARTBEAT_MS);
        
        const PRESENCE_TTL = 600000;
        setInterval(() => {
            pruneStale(PRESENCE_TTL);
            triggerLogicalRefresh();
        }, HEARTBEAT_MS);

        log(`\nWelcome to ${GAME_NAME.charAt(0).toUpperCase() + GAME_NAME.slice(1)}.`);
        log(`Your Peer ID: ${selfId}`);
        log(`[System] Connecting to the world...`, '#aaa');

        setTimeout(() => {
            log(`${world[localPlayer.location].name}`);
            log(world[localPlayer.location].description);
            triggerLogicalRefresh();
        }, 1000);

        setupNetworkEvents();
        setupUIEvents();
        installE2ETestApi();
        triggerLogicalRefresh();

    } catch (err) { log(`[FATAL] Engine crash: ${err.message}`, '#f00'); }
};

// --- CROSS-TAB SYNC ---
TAB_CHANNEL.onmessage = ({ data }) => {
    if (data.type === 'request_state' && lastValidStatePacket) {
        TAB_CHANNEL.postMessage({ type: 'state', packet: lastValidStatePacket });
    }
    if (data.type === 'state' && !hasSyncedWithArbiter) {
        verifyMessage(
            typeof data.packet.state === 'string' ? data.packet.state : JSON.stringify(data.packet.state),
            data.packet.signature,
            arbiterPublicKey
        ).then(valid => {
            if (!valid) return;
            const stateObj = typeof data.packet.state === 'string' ? JSON.parse(data.packet.state) : data.packet.state;
            updateSimulation(stateObj);
            triggerLogicalRefresh();
        }).catch(() => {});
    }
};

// --- NETWORK EVENT LISTENERS ---
function setupNetworkEvents() {
    bus.on('duel:start', ({ targetId, targetName, day }) => {
        startStateChannel(targetId, targetName, day).then(triggerLogicalRefresh);
    });

    bus.on('duel:commit-received', ({ targetId }) => {
        resolveRound(targetId).then(triggerLogicalRefresh);
    });

    let tradeTimeout = null;
    const startTradeTimeout = () => {
        clearTimeout(tradeTimeout);
        tradeTimeout = setTimeout(() => {
            if (pendingTrade) {
                log(`[Trade] Session timed out.`, '#555');
                setPendingTrade(null);
                triggerLogicalRefresh();
            }
        }, 30000);
    };

    bus.on('trade:offer-received', ({ partnerId, partnerName, offer }) => {
        if (!pendingTrade || pendingTrade.partnerId !== partnerId) {
            setPendingTrade({
                partnerId,
                partnerName,
                partnerOffer: offer,
                myOffer: { gold: 0, items: [] },
                ts: Date.now(),
                signatures: { me: null, partner: null }
            });
        } else {
            pendingTrade.partnerOffer = offer;
        }
        startTradeTimeout();
        triggerLogicalRefresh();
    });

    bus.on('trade:accept-received', ({ partnerId, offer }) => {
        if (pendingTrade && pendingTrade.partnerId === partnerId) {
            pendingTrade.partnerOffer = offer;
            startTradeTimeout();
            triggerLogicalRefresh();
        }
    });

    bus.on('duel:incoming', ({ challengerName }) => {
        showToast(`${challengerName} challenged you to a duel.`);
        triggerLogicalRefresh();
    });

    const finalizeTrade = () => {
        if (!pendingTrade) return;
        const pt = pendingTrade;
        log(`\n[Trade] TRADE FINALIZED! 🤝`, '#0f0');
        
        // 1. Give my stuff
        localPlayer.gold -= pt.myOffer.gold;
        pt.myOffer.items.forEach(id => {
            const idx = localPlayer.inventory.indexOf(id);
            if (idx !== -1) localPlayer.inventory.splice(idx, 1);
        });

        // 2. Get their stuff
        localPlayer.gold += pt.partnerOffer.gold;
        pt.partnerOffer.items.forEach(id => grantItem(id));

        // 3. Broadcast to shard for shadow updates
        const delta = {
            [selfId]: { gives_gold: pt.myOffer.gold, gives_items: pt.myOffer.items, gets_gold: pt.partnerOffer.gold, gets_items: pt.partnerOffer.items },
            [pt.partnerId]: { gives_gold: pt.partnerOffer.gold, gives_items: pt.partnerOffer.items, gets_gold: pt.myOffer.gold, gets_items: pt.myOffer.items }
        };
        gameActions.sendTradeFinal({ peerA: selfId, peerB: pt.partnerId, delta });

        setPendingTrade(null);
        saveLocalState(localPlayer, true);
        triggerLogicalRefresh();
    };

    bus.on('trade:commit-received', async ({ partnerId, commit }) => {
        if (pendingTrade && pendingTrade.partnerId === partnerId) {
            const entry = players.get(partnerId);
            if (!entry?.publicKey) return;

            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                const sigData = JSON.stringify({ gold: commit.gold, items: commit.items, ts: commit.ts });
                if (await verifyMessage(sigData, commit.signature, pubKey)) {
                    pendingTrade.signatures.partner = commit.signature;
                    pendingTrade.partnerOffer = { gold: commit.gold, items: commit.items };
                    
                    // Auto-finalize if both signed
                    if (pendingTrade.signatures.me) finalizeTrade();
                    else startTradeTimeout();
                }
            } catch (err) { console.error('[Trade] Verification fail:', err); }
            triggerLogicalRefresh();
        }
    });

    bus.on('trade:initiated', startTradeTimeout);

    bus.on('monster:damaged', () => {
        triggerLogicalRefresh();
    });

        bus.on('quest:progress', ({ name, current, total }) => {
            showToast(`${name}: ${current}/${total}`);
        });
        bus.on('quest:complete', ({ name }) => {
            showToast(`COMPLETED: ${name}! ✨`);
        });

        bus.on('peer:move', ({ peerId, data }) => {
            const name = getPlayerName(peerId);
            
            // If it's just a 1-tile step in the same room, just refresh the UI (Radar)
            if (data.from === data.to) {
                triggerLogicalRefresh();
                return;
            }

            if (data.to === localPlayer.location) {
                const fromDir = Object.entries(world[data.to]?.exits || {}).find(([, dest]) => dest === data.from)?.[0];
                showToast(`${name} arrives${fromDir ? ' from ' + fromDir : ''}`);
                triggerLogicalRefresh();
            } else if (data.from === localPlayer.location) {
                const toDir = Object.entries(world[data.from]?.exits || {}).find(([, dest]) => dest === data.to)?.[0];
                showToast(`${name} leaves${toDir ? ' to ' + toDir : ''}`);
                triggerLogicalRefresh();
            }
        });

    bus.on('peer:emote', ({ peerId, data }) => {
        showToast(`${getPlayerName(peerId)} ${data.text}`);
    });

    bus.on('peer:leave', ({ peerId }) => {
        const name = getPlayerName(peerId);
        showToast(`${name} vanished`);
        triggerLogicalRefresh();
    });
}

// --- UI EVENTS ---
function setupUIEvents() {
    const getAutoCompleteContext = () => ({
        inventory: localPlayer.inventory,
        location: localPlayer.location,
        world,
        players,
        ITEMS,
        NPCS,
        QUESTS,
        worldState,
        getNPCLocation
    });

    let currentSuggestions = [];
    let activeSuggestionIdx = -1;

    const renderSuggestions = (suggestions) => {
        currentSuggestions = suggestions;
        activeSuggestionIdx = -1;
        suggestionsEl.innerHTML = '';
        suggestions.forEach((s, i) => {
            const chip = document.createElement('button');
            chip.className = 'chip' + (s.immediate ? ' immediate' : '');
            chip.textContent = s.display;
            chip.addEventListener('click', () => selectSuggestion(i));
            suggestionsEl.appendChild(chip);
        });
    };

    const selectSuggestion = (idx) => {
        const s = currentSuggestions[idx];
        if (!s) return;
        if (s.immediate) {
            handleCommand(s.fill).then(triggerLogicalRefresh);
            input.value = '';
            renderSuggestions([]);
        } else {
            input.value = s.fill;
            input.focus();
            renderSuggestions(getSuggestions(s.fill, getAutoCompleteContext()));
        }
    };

    const submitCommand = (raw) => {
        const val = raw.trim();
        if (!val) return;
        handleCommand(val).then(triggerLogicalRefresh);
    };

    const inputHistory = [];
    let historyIdx = -1;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIdx < inputHistory.length - 1) {
                historyIdx++;
                input.value = inputHistory[historyIdx];
                renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIdx > 0) { historyIdx--; input.value = inputHistory[historyIdx]; }
            else { historyIdx = -1; input.value = ''; }
            renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (currentSuggestions.length === 0) return;
            activeSuggestionIdx = (activeSuggestionIdx + 1) % currentSuggestions.length;
            suggestionsEl.querySelectorAll('.chip').forEach((el, i) =>
                el.classList.toggle('active', i === activeSuggestionIdx)
            );
            input.value = currentSuggestions[activeSuggestionIdx].fill;
        } else if (e.key === 'Enter') {
            const val = input.value.trim();
            if (!val) return;
            if (activeSuggestionIdx >= 0 && currentSuggestions[activeSuggestionIdx]?.immediate) {
                selectSuggestion(activeSuggestionIdx);
            } else {
                if (val !== inputHistory[0]) { inputHistory.unshift(val); if (inputHistory.length > 50) inputHistory.pop(); }
                historyIdx = -1;
                submitCommand(val);
                input.value = '';
                renderSuggestions([]);
            }
        }
    });

    input.addEventListener('input', () => {
        historyIdx = -1;
        renderSuggestions(getSuggestions(input.value, getAutoCompleteContext()));
    });

    // Space/Enter advances dialogue if open; ~ toggles debug console
    const debugConsole = document.getElementById('debug-console');
    window.addEventListener('keydown', (e) => {
        const inInput = e.target.matches('input,textarea');
        if ((e.key === ' ' || e.key === 'Enter') && isDialogueOpen() && !inInput) {
            // Dialogue takes precedence over world but NOT debug console
            e.preventDefault();
            advanceDialogue();
            return;
        }
        if ((e.key === '~' || e.key === '`') && !inInput) {
            const visible = debugConsole.style.display !== 'none';
            debugConsole.style.display = visible ? 'none' : 'flex';
            if (!visible) bus.emit('ui:requestFocus', {});
        }
    });

    bus.on('ui:requestFocus', () => {
        if (input) input.focus();
    });

    if (window.visualViewport) {
        const onViewportChange = () => {
            document.body.style.height = window.visualViewport.height + 'px';
            if (output) output.scrollTop = output.scrollHeight;
        };
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onViewportChange);
    }
}

// E1: Emergency Flush on tab close or backgrounding
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSync(localPlayer);
});
window.addEventListener('beforeunload', () => {
    flushSync(localPlayer);
});

start();
