// @ts-check
import { selfId } from '../network/transport.js';
import { DEFAULT_PLAYER_STATS, GAME_NAME, ITEMS, SPAWN_ROOM_ID } from '../content/data.js';
import { deriveWorldState, findSafeArrival, xpToLevel } from '../rules/index.js';
import { world } from '../content/data.js';
import { scopedStorageKey } from '../infra/runtime.js';

export const WORLD_STATE_KEY = scopedStorageKey(`${GAME_NAME}_worldstate_v1`);
export const STORAGE_KEY = scopedStorageKey(`${GAME_NAME}_state_v5`);
export const TAB_CHANNEL = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(scopedStorageKey(`${GAME_NAME}_state`))
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
    surplus: [],
    event: null,
    weather: 'clear',
    lastTick: 0
};

export const players = new Map(); // id -> {name, location, ph, level, xp, ts, publicKey, rawPresence}
export const shadowPlayers = new Map(); // id -> {level, xp, inventory, gold, actionIndex}
export const shardEnemies = new Map(); // roomId -> {hp, maxHp, lastUpdate}
export const bans = new Set();
export let bansHash = '';

// A3: SWIM-inspired presence deltas
export let _presenceDelta = { joined: new Set(), left: new Set() };
export const clearPresenceDelta = () => {
    _presenceDelta.joined.clear();
    _presenceDelta.left.clear();
};

export const SAVE_VERSION = 2;

const PEER_LIMIT = 200;


export const setBans = (list, hash) => {
    bans.clear();
    list.forEach(k => bans.add(k));
    bansHash = hash;
};

export const evictPlayer = (id) => {
    if (players.has(id)) {
        players.delete(id);
        _presenceDelta.left.add(id);
        _presenceDelta.joined.delete(id);
    }
};

export const trackPlayer = (id, data) => {
    const isNew = !players.has(id);
    players.set(id, { ...data, ghost: !!data.ghost });
    
    if (isNew) {
        _presenceDelta.joined.add(id);
        _presenceDelta.left.delete(id);
    }

    if (players.size > PEER_LIMIT) {
        const first = players.keys().next().value;
        evictPlayer(first);
    }
};

export const evictShadowPlayer = (id) => {
    shadowPlayers.delete(id);
};

export const trackShadowPlayer = (id, data) => {
    const shadow = { 
        ph: data.ph,
        level: data.level, 
        xp: data.xp, 
        inventory: data.inventory || [], 
        gold: data.gold || 0,
        quests: data.quests || {},
        actionIndex: data.actionIndex ?? -1,
        signature: data.signature,
        ts: Date.now()
    };
    shadowPlayers.set(id, shadow);
    if (shadowPlayers.size > PEER_LIMIT) {
        const first = shadowPlayers.keys().next().value;
        evictShadowPlayer(first);
    }
};

export let localPlayer = { 
    name: `Peer-${selfId.slice(0, 4)}`, 
    location: SPAWN_ROOM_ID,
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

// Tracks the last time a valid signed arbiter beacon was received.
// Used to distinguish "arbiter never seen" (0) from "arbiter went offline".
export let arbiterLastSeenAt = 0;
export const setArbiterLastSeenAt = () => { arbiterLastSeenAt = Date.now(); };

// Hard state is frozen when the arbiter has been absent for >5 minutes.
// During a freeze, durable rewards (XP, loot, gold) are queued rather than
// applied immediately — they will be drained when the arbiter returns.
const HARD_STATE_FREEZE_MS = 5 * 60 * 1000;
export const isHardStateFrozen = () =>
    arbiterLastSeenAt > 0 && (Date.now() - arbiterLastSeenAt) > HARD_STATE_FREEZE_MS;

// Queue of deferred hard-state operations accumulated during an arbiter outage.
// Each entry: { peerId, data, ts }
export const hardStateQueue = [];

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

const isRoomTileWalkable = (room, x, y) => {
    if (!room || x < 0 || y < 0 || x >= room.width || y >= room.height) return false;
    const wall = (room.tileOverrides || []).find((t) => t.x === x && t.y === y && t.type === 'wall');
    if (wall) return false;
    const scenery = (room.scenery || []).find((s) =>
        x >= s.x && x < s.x + (s.w || 1) &&
        y >= s.y && y < s.y + (s.h || 1)
    );
    if (scenery) return false;
    const staticEntity = (room.staticEntities || []).find((e) => e.x === x && e.y === y);
    if (staticEntity) return false;
    return true;
};

const resolveSafePlayerSpawn = (location, x, y) => {
    const room = world[location];
    if (!room) return { x: 0, y: 0 };

    const targetX = Number.isFinite(x) ? x : Math.floor(room.width / 2);
    const targetY = Number.isFinite(y) ? y : Math.floor(room.height / 2);
    const safe = findSafeArrival(targetX, targetY, room.width, room.height, (cx, cy) => isRoomTileWalkable(room, cx, cy));
    if (safe) return safe;

    for (let yy = 0; yy < room.height; yy++) {
        for (let xx = 0; xx < room.width; xx++) {
            if (isRoomTileWalkable(room, xx, yy)) return { x: xx, y: yy };
        }
    }

    return { x: targetX, y: targetY };
};

import { loadState } from './persistence.js';
// ...
// --- PERSISTENCE HELPERS ---
export const loadLocalState = async (log) => {
    let data = await loadState();
    if (data) {
        try {
            // E3: Migration - If no version or old version, handle appropriately
            if (!data._version || data._version < SAVE_VERSION) {
                if (log) log(`[System] Migrating state to v${SAVE_VERSION}...`, '#aaa');
                data._version = SAVE_VERSION;
            }

            // E2: Field Clamping / Validation
            data.maxHp = Math.max(1, data.maxHp ?? 50);
            data.hp = Math.max(0, Math.min(data.hp ?? 0, data.maxHp));
            data.gold = Math.max(0, data.gold ?? 0);
            if (data.gold > 999999) data.gold = 999999;
            data.xp = Math.max(0, data.xp ?? 0);
            data.level = xpToLevel(data.xp); // derive, don't trust
            
            if (!Array.isArray(data.inventory)) data.inventory = [];
            // strip unknown items and clamp size
            data.inventory = data.inventory.filter(id => ITEMS[id]).slice(0, 50);

            // Security: Never restore 'ph' from saved state. 
            // It must be derived from the current cryptographic keys by initIdentity.
            if ('ph' in data) delete data.ph;

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
                localPlayer.location = SPAWN_ROOM_ID;
            }
            if (!Array.isArray(localPlayer.visitedRooms)) {
                localPlayer.visitedRooms = [];
            } else {
                localPlayer.visitedRooms = localPlayer.visitedRooms.filter(id => world[id]);
            }
            const safeSpawn = resolveSafePlayerSpawn(localPlayer.location, localPlayer.x, localPlayer.y);
            localPlayer.x = safeSpawn.x;
            localPlayer.y = safeSpawn.y;
            if (log) log(`[System] Welcome back, ${localPlayer.name}.`);
        } catch (e) { console.error('[Store] Load error:', e); }
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
        if (id !== selfId && (entry.ts ?? 0) < cutoff) evictPlayer(id);
    });
};
