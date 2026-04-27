import { selfId } from '@trystero-p2p/torrent';
import { DEFAULT_PLAYER_STATS, GAME_NAME } from './data.js';
import { deriveWorldState } from './rules.js';
import { world } from './data.js';

export const WORLD_STATE_KEY = `${GAME_NAME}_worldstate_v1`;
export const STORAGE_KEY = `${GAME_NAME}_state_v5`;
export const TAB_CHANNEL = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(`${GAME_NAME}_state`)
    : (() => {
        console.warn('[System] BroadcastChannel not available; multi-tab sync disabled.');
        return { postMessage: () => {}, onmessage: null, close: () => {} };
    })();

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
export const shardEnemies = new Map(); // roomId -> {hp, maxHp, lastUpdate}
export const bans = new Set();
export let bansHash = '';

const PEER_LIMIT = 200;

export const setBans = (list, hash) => {
    bans.clear();
    list.forEach(k => bans.add(k));
    bansHash = hash;
};

export const trackShadowPlayer = (id, data) => {
    // data is the unpacked presence
    const shadow = { 
        ph: data.ph,
        level: data.level, 
        xp: data.xp, 
        inventory: data.inventory || [], 
        gold: data.gold || 0,
        quests: data.quests || {},
        signature: data.signature,
        ts: Date.now()
    };
    shadowPlayers.set(id, shadow);
    if (shadowPlayers.size > PEER_LIMIT) {
        const first = shadowPlayers.keys().next().value;
        shadowPlayers.delete(first);
    }
};

export const trackPlayer = (id, data) => {
    if (players.has(id)) players.delete(id);
    players.set(id, data);
    if (players.size > PEER_LIMIT) {
        const first = players.keys().next().value;
        players.delete(first);
    }
};

export let localPlayer = { 
    name: `Peer-${selfId.slice(0, 4)}`, 
    location: 'cellar', 
    direction: 'south',
    animState: 'idle',
    statusEffects: [],
    equipped: { weapon: null, armor: null },
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

// --- TRADE SESSIONS ---
export let pendingTrade = null; // { partnerId, partnerName, partnerOffer: {gold, items: []}, myOffer: {gold, items: []}, ts, signatures: { me: null, partner: null } }
export function setPendingTrade(val) {
    pendingTrade = val;
}

import { loadState } from './persistence.js';
// ...
// --- PERSISTENCE HELPERS ---
export const loadLocalState = async (log) => {
    const data = await loadState();
    if (data) {
        try {
            Object.assign(localPlayer, data);
            if (typeof localPlayer.combatRound !== 'number' || isNaN(localPlayer.combatRound)) {
                localPlayer.combatRound = 0;
            }
            if (!localPlayer.buffs || typeof localPlayer.buffs !== 'object') {
                localPlayer.buffs = { rested: false, activeElixir: null };
            }
            if (!localPlayer.direction) localPlayer.direction = 'south';
            if (!localPlayer.animState) localPlayer.animState = 'idle';
            if (!localPlayer.statusEffects) localPlayer.statusEffects = [];
            if (!localPlayer.equipped) localPlayer.equipped = { weapon: null, armor: null };
            if (!world[localPlayer.location]) {
                localPlayer.location = 'cellar';
            }
            if (log) log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) { console.error(e); }
    }
    const cachedWorld = localStorage.getItem(WORLD_STATE_KEY);
    // ...
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

export const pruneStale = (PRESENCE_TTL) => {
    const cutoff = Date.now() - PRESENCE_TTL;
    players.forEach((entry, id) => {
        if (id !== selfId && (entry.ts ?? 0) < cutoff) players.delete(id);
    });
};
