import { selfId } from '@trystero-p2p/torrent';
import { DEFAULT_PLAYER_STATS, GAME_NAME } from './data.js';
import { deriveWorldState } from './rules.js';

export const WORLD_STATE_KEY = `${GAME_NAME}_worldstate_v1`;
export const STORAGE_KEY = `${GAME_NAME}_state_v5`;
export const TAB_CHANNEL = typeof BroadcastChannel !== 'undefined' 
    ? new BroadcastChannel(`${GAME_NAME}_state`)
    : { postMessage: () => {}, onmessage: null, close: () => {} };

export let worldState = { 
    seed: '', 
    day: 0, 
    mood: '', 
    season: '', 
    seasonNumber: 1, 
    threatLevel: 0, 
    scarcity: [], 
    lastTick: 0 
};

export const players = new Map(); // id -> {name, location, ph, level, xp, ts, publicKey}
export const shadowPlayers = new Map(); // id -> {level, xp, inventory, gold, actionIndex}

export let localPlayer = { 
    name: `Peer-${selfId.slice(0, 4)}`, 
    location: 'cellar', 
    ...DEFAULT_PLAYER_STATS 
};

export let hasSyncedWithArbiter = false;

export function setHasSyncedWithArbiter(val) {
    hasSyncedWithArbiter = val;
}

// --- PVP STATE CHANNELS ---
export let pendingDuel = null; // { challengerId, challengerName, expiresAt, day }
export function setPendingDuel(val) {
    pendingDuel = val;
}

export const activeChannels = new Map(); // targetId -> { opponentName, lastCommit, myHistory, theirHistory, timeoutId }

// --- PERSISTENCE HELPERS ---
export const loadLocalState = (log) => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            Object.assign(localPlayer, data);
            if (typeof localPlayer.combatRound !== 'number' || isNaN(localPlayer.combatRound)) {
                localPlayer.combatRound = 0;
            }
            if (log) log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) { console.error(e); }
    }
    const cachedWorld = localStorage.getItem(WORLD_STATE_KEY);
    if (cachedWorld) {
        try {
            const { seed, day, lastTick } = JSON.parse(cachedWorld);
            worldState.seed = seed;
            worldState.day = day;
            worldState.lastTick = lastTick;
            const derived = deriveWorldState(seed, day);
            worldState.mood = derived.mood;
            worldState.season = derived.season;
            worldState.seasonNumber = derived.seasonNumber;
            worldState.threatLevel = derived.threatLevel;
            worldState.scarcity = derived.scarcity;
        } catch (e) { console.error(e); }
    }
};

let saveTimer = null;
export const saveLocalState = (immediate = false) => {
    if (immediate) {
        clearTimeout(saveTimer);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
        return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
        saveTimer = null;
    }, 5000);
};

export const pruneStale = (PRESENCE_TTL) => {
    const cutoff = Date.now() - PRESENCE_TTL;
    players.forEach((entry, id) => {
        if (id !== selfId && entry.ts < cutoff) players.delete(id);
    });
};
