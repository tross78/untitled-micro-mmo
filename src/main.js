import { selfId } from '@trystero-p2p/torrent';
import { 
    worldState, players, localPlayer, hasSyncedWithArbiter, 
    TAB_CHANNEL, loadLocalState, pruneStale, saveLocalState
} from './store';
import { log, printStatus } from './ui';
import { 
    initIdentity, arbiterPublicKey, myEntry 
} from './identity';
import { 
    initNetworking, gameActions, lastValidStatePacket, updateSimulation, joinInstance, currentInstance, currentRtcConfig
} from './networking';
import { 
    handleCommand, getPlayerName, getTag, startStateChannel, resolveRound
} from './commands';
import { verifyMessage } from './crypto';
import { getSuggestions } from './autocomplete';
import { initAds, showBanner } from './ads';
import { 
    world, ITEMS, GAME_NAME, NPCS, QUESTS
} from './data';
import { 
    GH_GIST_ID, ARBITER_URL 
} from './constants';
import { getNPCLocation } from './rules';

const input = document.getElementById('input');
const suggestionsEl = document.getElementById('suggestions');
const output = document.getElementById('output');

const HEARTBEAT_MS = 30000;

// --- IDENTITY & P2P BOOTSTRAP ---
const start = async () => {
    try {
        await initIdentity(log);
        loadLocalState(log);
        initAds();
        showBanner();

        // Ask other open tabs for state before touching the network
        TAB_CHANNEL.postMessage({ type: 'request_state' });

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
            } else {
                console.warn(`[System] Beacon from ${source} failed verification.`);
            }
        };

        // Gist Discovery
        if (GH_GIST_ID && !hasSyncedWithArbiter) {
            const directUrl = `https://gist.githubusercontent.com/tross78/${GH_GIST_ID}/raw/mmo_arbiter_discovery.json?t=${Date.now()}`;
            fetch(directUrl)
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

        // Heartbeat for presence
        setInterval(async () => {
            if (typeof gameActions.sendPresenceSingle === 'function') {
                const entry = await myEntry();
                if (entry) gameActions.sendPresenceSingle(entry);
            }
        }, HEARTBEAT_MS);
        
        const PRESENCE_TTL = 90000;
        setInterval(() => pruneStale(PRESENCE_TTL), HEARTBEAT_MS);

        log(`\nWelcome to ${GAME_NAME.charAt(0).toUpperCase() + GAME_NAME.slice(1)}.`);
        log(`Your Peer ID: ${selfId}`);
        log(`[System] Connecting to the world...`, '#aaa');

        setTimeout(() => {
            log(`${world[localPlayer.location].name}`);
            log(world[localPlayer.location].description);
        }, 1000);

        setupUIEvents();
        setupNetworkEvents();

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
        }).catch(() => {});
    }
};

// --- NETWORK EVENT LISTENERS ---
function setupNetworkEvents() {
    window.addEventListener('start-duel', (e) => {
        const { targetId, targetName, day } = e.detail;
        startStateChannel(targetId, targetName, day);
    });

    window.addEventListener('resolve-duel-round', (e) => {
        const { targetId } = e.detail;
        resolveRound(targetId);
    });

    window.addEventListener('player-move', (e) => {
        const { peerId, data } = e.detail;
        const name = getPlayerName(peerId);
        if (data.to === localPlayer.location) {
            const fromDir = Object.entries(world[data.to]?.exits || {}).find(([, dest]) => dest === data.from)?.[0];
            log(`[System] ${name} arrives${fromDir ? ' from the ' + fromDir : ''}.`, '#aaa');
            handleCommand('look');
        } else if (data.from === localPlayer.location) {
            const toDir = Object.entries(world[data.from]?.exits || {}).find(([, dest]) => dest === data.to)?.[0];
            log(`[System] ${name} leaves${toDir ? ' to the ' + toDir : ''}.`, '#aaa');
        }
    });

    window.addEventListener('player-emote', (e) => {
        const { peerId, data } = e.detail;
        log(`[System] ${getPlayerName(peerId)} ${data.text}`, '#aaa');
    });

    window.addEventListener('player-leave', (e) => {
        const { peerId } = e.detail;
        const name = getPlayerName(peerId);
        log(`[Social] ${name} has vanished.`, '#555');
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
            handleCommand(s.fill);
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
        handleCommand(val.startsWith('/') ? val.slice(1) : val);
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

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cmd = btn.dataset.cmd;
            log(`> ${cmd}`, '#555');
            handleCommand(cmd);
        });
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
