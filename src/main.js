import { selfId } from '@trystero-p2p/torrent';
import { 
    worldState, players, localPlayer, hasSyncedWithArbiter,
    TAB_CHANNEL, loadLocalState, pruneStale, pendingTrade, setPendingTrade, shardEnemies
} from './store.js';
import { saveLocalState } from './persistence.js';
import { log, printStatus, renderActionButtons, startTicker } from './ui.js';
import { renderWorld } from './renderer.js';
import { 
    playHit, playCrit, playLevelUp, playPickup, playPortal, playDeath 
} from './audio.js';
import { 
    initIdentity, arbiterPublicKey, myEntry 
} from './identity.js';
import { 
    initNetworking, gameActions, lastValidStatePacket, updateSimulation, joinInstance, currentInstance, currentRtcConfig
} from './networking.js';
import {
    handleCommand, getPlayerName, getTag, startStateChannel, resolveRound, escapeHtml, grantItem
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

const input = document.getElementById('input');
const suggestionsEl = document.getElementById('suggestions');
const output = document.getElementById('output');

const HEARTBEAT_MS = 120000;

/**
 * Global UI refresh trigger. Call this whenever state changes.
 */
const triggerUIRefresh = () => {
    const ctx = {
        localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, pendingTrade, players, shardEnemies
    };
    renderActionButtons(ctx, (cmdOrAction) => {
        if (typeof cmdOrAction === 'string') {
            log(`> ${cmdOrAction}`, '#555');
            handleCommand(cmdOrAction).then(triggerUIRefresh);
        } else {
            // It's an ACTION constant
            bus.emit('input:action', { action: cmdOrAction, type: 'down' });
        }
    });
    renderWorld(ctx, (tx, ty) => {
        // Pathfinding / Micro-movement (Manhattan step)
        const loc = world[localPlayer.location];
        if (tx < 0 || tx >= loc.width || ty < 0 || ty >= loc.height) return;
        
        // Find next step towards target
        const dx = tx - localPlayer.x;
        const dy = ty - localPlayer.y;
        if (dx === 0 && dy === 0) return;

        // Move only 1 tile at a time
        const stepX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
        const stepY = stepX === 0 && dy !== 0 ? (dy > 0 ? 1 : -1) : 0;
        
        const nextX = localPlayer.x + stepX;
        const nextY = localPlayer.y + stepY;

        localPlayer.x = nextX;
        localPlayer.y = nextY;
        saveLocalState(localPlayer);
        triggerUIRefresh();

        // Broadcast micro-movement (guard: gameActions not yet populated until joinInstance completes)
        if (gameActions.sendMove) gameActions.sendMove({ from: localPlayer.location, to: localPlayer.location, x: nextX, y: nextY });
        
        // Check for portal hit
        const portal = (loc.portals || []).find(p => p.x === nextX && p.y === nextY);
        if (portal) {
            log(`[System] Stepping into the portal to ${world[portal.dest].name}...`, '#f0f');
            const prevLoc = localPlayer.location;
            localPlayer.location = portal.dest;
            localPlayer.x = portal.destX ?? 5;
            localPlayer.y = portal.destY ?? 5;
            saveLocalState(localPlayer);
            
            myEntry().then(entry => {
                if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
            });
            handleCommand('look');
            if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: portal.dest, x: localPlayer.x, y: localPlayer.y });
            bus.emit('player:move', { from: prevLoc, to: portal.dest, portal: true });
            joinInstance(portal.dest, currentInstance, currentRtcConfig).then(triggerUIRefresh);
        }
    });
};

// --- IDENTITY & P2P BOOTSTRAP ---
const start = async () => {
    try {
        await initIdentity(log);
        await loadLocalState(log);
        initAds();
        showBanner();
        inputManager.init();

        bus.on('combat:hit', ({ attacker, crit }) => {
            if (crit) playCrit();
            else playHit();
        });
        bus.on('combat:death', ({ entity }) => {
            if (entity === 'You') playDeath();
            else playPickup(); // Victory sound?
        });
        bus.on('player:levelup', () => playLevelUp());
        bus.on('item:pickup', () => playPickup());
        bus.on('player:move', ({ to, from, portal }) => {
            if (to !== from && portal) playPortal();
        });

        bus.on('input:action', ({ action, type }) => {
            if (type !== 'down') return;
            
            let cmd = null;
            switch (action) {
                case ACTION.MOVE_N: cmd = 'move north'; break;
                case ACTION.MOVE_S: cmd = 'move south'; break;
                case ACTION.MOVE_E: cmd = 'move east'; break;
                case ACTION.MOVE_W: cmd = 'move west'; break;
                case ACTION.ATTACK: cmd = 'attack'; break;
                case ACTION.INTERACT: cmd = 'interact'; break;
                case ACTION.INVENTORY: cmd = 'inventory'; break;
                case ACTION.CANCEL: cmd = 'back'; break;
                case ACTION.CONFIRM: cmd = 'confirm'; break;
                case ACTION.MENU: cmd = 'status'; break;
            }
            if (cmd) {
                if (cmd === 'back') {
                    window.dispatchEvent(new CustomEvent('ui-back'));
                    triggerUIRefresh();
                } else {
                    handleCommand(cmd).then(triggerUIRefresh);
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
            const { state, signature } = packet;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            const valid = await verifyMessage(stateStr, signature, arbiterPublicKey).catch(() => false);
            if (valid) {
                log(`[System] Fast-Path connected via ${source}!`, '#0f0');
                TAB_CHANNEL.postMessage({ type: 'state', packet });
                const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
                updateSimulation(stateObj);
                triggerUIRefresh();
            } else {
                console.warn(`[System] Beacon from ${source} failed verification.`);
            }
        };

        // Gist Discovery
        if (GH_GIST_ID && GH_GIST_USERNAME && !hasSyncedWithArbiter) {
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
        if (ARBITER_URL && !hasSyncedWithArbiter) {
            fetch(`${ARBITER_URL}/state`, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : null)
                .then(async packet => {
                    if (!packet || hasSyncedWithArbiter) return;
                    processBeacon(packet, 'HTTP');
                })
                .catch(() => {});
        }

        await initNetworking();
        startTicker(worldState);

        // Heartbeat for presence
        setInterval(async () => {
            if (typeof gameActions.sendPresenceSingle === 'function') {
                const entry = await myEntry();
                if (entry) gameActions.sendPresenceSingle(entry);
            }
        }, HEARTBEAT_MS);
        
        const PRESENCE_TTL = 300000;
        setInterval(() => {
            pruneStale(PRESENCE_TTL);
            triggerUIRefresh();
        }, HEARTBEAT_MS);

        log(`\nWelcome to ${GAME_NAME.charAt(0).toUpperCase() + GAME_NAME.slice(1)}.`);
        log(`Your Peer ID: ${selfId}`);
        log(`[System] Connecting to the world...`, '#aaa');

        setTimeout(() => {
            log(`${world[localPlayer.location].name}`);
            log(world[localPlayer.location].description);
            triggerUIRefresh();
        }, 1000);

        setupNetworkEvents();
        setupUIEvents();
        triggerUIRefresh();

    } catch (err) { log(`[FATAL] Engine crash: ${err.message}`, '#f00'); }
};

// --- CROSS-TAB SYNC ---
TAB_CHANNEL.onmessage = ({ data }) => {
    if (data.type === 'request_state' && lastValidStatePacket) {
        TAB_CHANNEL.postMessage({ type: 'state', packet: lastValidStatePacket });
    }
    if (data.type === 'state' && worldState.day === 0) {
        verifyMessage(
            typeof data.packet.state === 'string' ? data.packet.state : JSON.stringify(data.packet.state),
            data.packet.signature,
            arbiterPublicKey
        ).then(valid => {
            if (!valid) return;
            const stateObj = typeof data.packet.state === 'string' ? JSON.parse(data.packet.state) : data.packet.state;
            updateSimulation(stateObj);
            triggerUIRefresh();
        }).catch(() => {});
    }
};

// --- NETWORK EVENT LISTENERS ---
function setupNetworkEvents() {
    window.addEventListener('start-duel', (e) => {
        const { targetId, targetName, day } = e.detail;
        startStateChannel(targetId, targetName, day).then(triggerUIRefresh);
    });

    window.addEventListener('duel-commit-received', (e) => {
        const { targetId } = e.detail;
        resolveRound(targetId).then(triggerUIRefresh);
    });

    let tradeTimeout = null;
    const startTradeTimeout = () => {
        clearTimeout(tradeTimeout);
        tradeTimeout = setTimeout(() => {
            if (pendingTrade) {
                log(`[Trade] Session timed out.`, '#555');
                setPendingTrade(null);
                triggerUIRefresh();
            }
        }, 30000);
    };

    window.addEventListener('trade-offer-received', (e) => {
        const { partnerId, partnerName, offer } = e.detail;
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
        triggerUIRefresh();
    });

    window.addEventListener('trade-accept-received', (e) => {
        const { partnerId, offer } = e.detail;
        if (pendingTrade && pendingTrade.partnerId === partnerId) {
            pendingTrade.partnerOffer = offer;
            startTradeTimeout();
            triggerUIRefresh();
        }
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
        triggerUIRefresh();
    };

    window.addEventListener('trade-commit-received', async (e) => {
        const { partnerId, commit } = e.detail;
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
            triggerUIRefresh();
        }
    });

    window.addEventListener('trade-initiated', startTradeTimeout);

    window.addEventListener('monster-damaged', () => {
        triggerUIRefresh();
    });

    window.addEventListener('player-move', (e) => {
        const { peerId, data } = e.detail;
        const name = getPlayerName(peerId);
        
        // If it's just a 1-tile step in the same room, just refresh the UI (Radar)
        if (data.from === data.to) {
            triggerUIRefresh();
            return;
        }

        if (data.to === localPlayer.location) {
            const fromDir = Object.entries(world[data.to]?.exits || {}).find(([, dest]) => dest === data.from)?.[0];
            log(`[System] ${name} arrives${fromDir ? ' from the ' + fromDir : ''}.`, '#aaa');
            handleCommand('look').then(triggerUIRefresh);
        } else if (data.from === localPlayer.location) {
            const toDir = Object.entries(world[data.from]?.exits || {}).find(([, dest]) => dest === data.to)?.[0];
            log(`[System] ${name} leaves${toDir ? ' to the ' + toDir : ''}.`, '#aaa');
            triggerUIRefresh();
        }
    });

    window.addEventListener('player-emote', (e) => {
        const { peerId, data } = e.detail;
        log(`[System] ${getPlayerName(peerId)} ${escapeHtml(data.text)}`, '#aaa');
    });

    window.addEventListener('player-leave', (e) => {
        const { peerId } = e.detail;
        const name = getPlayerName(peerId);
        log(`[Social] ${name} has vanished.`, '#555');
        triggerUIRefresh();
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
            log(`> ${s.fill}`, '#555');
            handleCommand(s.fill).then(triggerUIRefresh);
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
        handleCommand(val).then(triggerUIRefresh);
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

    if (window.visualViewport) {
        const onViewportChange = () => {
            document.body.style.height = window.visualViewport.height + 'px';
            if (output) output.scrollTop = output.scrollHeight;
        };
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onViewportChange);
    }
}

start();
