import { localPlayer, hasSyncedWithArbiter, worldState, TAB_CHANNEL, loadLocalState, pruneStale } from '../state/store.js';
import { log, startTicker } from '../ui/index.js';
import { initIdentity, arbiterPublicKey, myEntry } from '../security/identity.js';
import { getRuntimeParam, isE2EMode, getArbiterUrl } from '../infra/runtime.js';
import { initAds, showBanner } from '../engine/ads.js';
import { inputManager } from '../engine/input.js';
import { setupGlobalEvents, triggerLogicalRefresh } from './events.js';
import { initCrossTabSync } from './sync.js';
import { verifyMessage, stableStringify } from '../security/crypto.js';
import { updateSimulation, initNetworking, gameActions, initOfflineDayTick } from '../network/index.js';
import { patchIceGatheringTimeout } from '../network/config.js';
import { setArbiterLastSeenAt } from '../state/store.js';
import { world, GAME_NAME } from '../content/data.js';
import { GH_GIST_ID, GH_GIST_USERNAME, ARBITER_URL } from '../infra/constants.js';
import { saveLocalState } from '../state/persistence.js';
import { bindSessionLifecycle } from './lifecycle.js';
import { setTicker, showDialogue, showToast } from '../graphics/renderer.js';
import { ensureShell } from '../adapters/dom/shell.js';
import { requestTextInput } from '../adapters/dom/prompt.js';
import { validateContent } from '../content/validate.js';
import * as contentDefs from '../content/index.js';
import { appRuntime } from '../app/runtime.js';
import { selfId } from '../network/transport.js';
import { markNetworkEvent, resetNetworkAudit } from '../network/audit-debug.js';

const HEARTBEAT_MS = 30000;

export const processBeacon = async (packet, source) => {
    if (!packet) return false;
    const { state, signature, snapshot } = packet;
    const stateStr = typeof state === 'string' ? state : stableStringify(state);
    const valid = await verifyMessage(stateStr, signature, arbiterPublicKey).catch(() => false);
    if (valid) {
        if (hasSyncedWithArbiter) return true;
        setArbiterLastSeenAt();
        log(`[System] Fast-Path connected via ${source}!`, '#0f0');
        TAB_CHANNEL.postMessage({ type: 'state', packet });
        const stateObj = typeof state === 'string' ? JSON.parse(state) : state;
        updateSimulation(stateObj);
        if (snapshot) {
            const { seedFromSnapshot } = await import('../network/index.js');
            const localLoc = localPlayer?.location;
            const filtered = localLoc
                ? snapshot.filter(e => e.location === localLoc)
                : snapshot;
            seedFromSnapshot(filtered);
        }
        triggerLogicalRefresh();
        return true;
    } else {
        console.warn(`[System] Beacon from ${source} failed verification.`);
    }
    return false;
};

const fetchJsonWithTimeout = async (url, timeoutMs = 5000) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

export const bootstrapFromGist = async () => {
    if (!GH_GIST_ID || !GH_GIST_USERNAME) return false;

    const directUrl = `https://gist.githubusercontent.com/${GH_GIST_USERNAME}/${GH_GIST_ID}/raw/mmo_arbiter_discovery_v4.json?t=${Date.now()}`;
    try {
        const packet = await fetchJsonWithTimeout(directUrl);
        return processBeacon(packet, 'GitHub Gist (Direct)');
    } catch {
        try {
            const gist = await fetchJsonWithTimeout(`https://api.github.com/gists/${GH_GIST_ID}`);
            const file = gist?.files?.['mmo_arbiter_discovery_v4.json'];
            if (!file?.raw_url) return false;
            const packet = await fetchJsonWithTimeout(file.raw_url + '?t=' + Date.now());
            return processBeacon(packet, 'GitHub Gist (API)');
        } catch {
            return false;
        }
    }
};

export const start = async () => {
    try {
        resetNetworkAudit();
        markNetworkEvent('bootstrap:start');
        patchIceGatheringTimeout();
        ensureShell();
        const validation = validateContent(contentDefs);
        if (!validation.ok) {
            throw new Error(`Content validation failed: ${validation.problems.join('; ')}`);
        }

        await loadLocalState(log);
        markNetworkEvent('bootstrap:local_state_loaded');
        await initIdentity(log);
        markNetworkEvent('bootstrap:identity_ready');
        markNetworkEvent('bootstrap:arbiter_resolved');
        appRuntime.configurePorts({
            ui: {
                showToast,
                showDialogue,
                requestText: requestTextInput,
            },
            storage: {
                save: saveLocalState,
            },
        });
        appRuntime.hydratePlayer(localPlayer);
        bindSessionLifecycle(localPlayer);
        appRuntime.initSystems(localPlayer, gameActions);
        appRuntime.start();
        
        const E2E_MODE = isE2EMode();
        if (E2E_MODE && getRuntimeParam('debugnet') === '1') {
            localStorage.setItem(`${GAME_NAME}_debug`, 'true');
        }
        if (localStorage.getItem(`${GAME_NAME}_debug`) === 'true') {
            window.__debug = { worldState, localPlayer };
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

        // Gist beacon is world-state only — peer discovery/signaling is Nostr+torrent.
        // Fire-and-forget so a slow GitHub round-trip can't delay shard joining.
        // The beacon arrives in parallel and triggers a state sync whenever it lands.
        if (!E2E_MODE && GH_GIST_ID && GH_GIST_USERNAME && !hasSyncedWithArbiter) {
            bootstrapFromGist().catch(() => {});
        }

        // HTTP bootstrap
        const runtimeArbiterUrl = getArbiterUrl(ARBITER_URL);
        if (!E2E_MODE && runtimeArbiterUrl && !hasSyncedWithArbiter) {
            fetch(`${runtimeArbiterUrl}/state`, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : null)
                .then(async packet => {
                    if (!packet || hasSyncedWithArbiter) return;
                    await processBeacon(packet, 'HTTP');
                })
                .catch(() => {});
        }

        initOfflineDayTick();
        markNetworkEvent('bootstrap:networking_start');
        await initNetworking();
        markNetworkEvent('bootstrap:networking_ready');
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
