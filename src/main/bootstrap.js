import { localPlayer, hasSyncedWithArbiter, worldState, TAB_CHANNEL, loadLocalState, pruneStale } from '../store.js';
import { log, startTicker } from '../ui.js';
import { initIdentity, arbiterPublicKey, myEntry } from '../identity.js';
import { resolveBootstrapArbiterUrl, getRuntimeParam, isE2EMode, getArbiterUrl } from '../runtime.js';
import { initAds, showBanner } from '../ads.js';
import { inputManager } from '../input.js';
import { setupGlobalEvents, triggerLogicalRefresh, triggerVisualRefresh } from './events.js';
import { initCrossTabSync } from './sync.js';
import { verifyMessage } from '../crypto.js';
import { updateSimulation, initNetworking, gameActions, selfId } from '../networking.js';
import { world, GAME_NAME } from '../data.js';
import { GH_GIST_ID, GH_GIST_USERNAME, ARBITER_URL } from '../constants.js';
import { saveLocalState } from '../persistence.js';
import { setTicker, showDialogue, showToast } from '../renderer.js';

const HEARTBEAT_MS = 30000;

export const processBeacon = async (packet, source) => {
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
            const { seedFromSnapshot } = await import('../networking.js');
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

export const start = async () => {
    try {
        await loadLocalState(log);
        await initIdentity(log);
        await resolveBootstrapArbiterUrl();
        
        const E2E_MODE = isE2EMode();
        if (E2E_MODE && getRuntimeParam('debugnet') === '1') {
            localStorage.setItem(`${GAME_NAME}_debug`, 'true');
        }
        
        initAds();
        showBanner();
        inputManager.init();
        initCrossTabSync();
        setupGlobalEvents();

        // P2P State Rescue
        setTimeout(() => {
            if (localPlayer.xp === 0 && gameActions.sendStateRequest) {
                log(`[System] Local state empty. Requesting rescue from peers...`, '#aaa');
                gameActions.sendStateRequest(localPlayer.ph);
            }
        }, 5000);

        // Gist Discovery
        if (!E2E_MODE && GH_GIST_ID && GH_GIST_USERNAME && !hasSyncedWithArbiter) {
            const directUrl = `https://gist.githubusercontent.com/${GH_GIST_USERNAME}/${GH_GIST_ID}/raw/mmo_arbiter_discovery_v4.json?t=${Date.now()}`;
            fetch(directUrl, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : Promise.reject('Direct fail'))
                .then(packet => processBeacon(packet, 'GitHub Gist (Direct)'))
                .catch(() => {
                    fetch(`https://api.github.com/gists/${GH_GIST_ID}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(gist => {
                            const file = gist?.files?.['mmo_arbiter_discovery_v4.json'];
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

        triggerLogicalRefresh();

    } catch (err) { 
        log(`[FATAL] Engine crash: ${err.message}`, '#f00'); 
        console.error(err);
    }
};
