import { STORAGE_KEY, SAVE_VERSION } from './store.js';
import { scopedStorageKey } from '../infra/runtime.js';

let saveTimer = null;

const DB_NAME = scopedStorageKey('hearthwick');
const DB_VERSION = 1;

/**
 * Async IndexedDB wrapper
 */
const getDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
        const db = (/** @type {any} */ (e.target)).result;
        if (!db.objectStoreNames.contains('player')) db.createObjectStore('player');
        if (!db.objectStoreNames.contains('world')) db.createObjectStore('world');
    };
    request.onsuccess = (e) => resolve((/** @type {any} */ (e.target)).result);
    request.onerror = (e) => reject((/** @type {any} */ (e.target)).error);
});

const dbPut = async (store, key, val) => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject((/** @type {any} */ (e.target)).error);
    });
};

const dbGet = async (store, key) => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = (e) => resolve((/** @type {any} */ (e.target)).result);
        req.onerror = (e) => reject((/** @type {any} */ (e.target)).error);
    });
};

/**
 * Persists localPlayer state to IndexedDB (and legacy write-through).
 */
export const saveLocalState = async (localPlayer, immediate = false) => {
    const dataWithVersion = { ...localPlayer, _version: SAVE_VERSION };
    const persist = async () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataWithVersion));
        } catch (e) {
            console.warn('[System] localStorage persistence failed:', e.message);
        }
        try {
            // Primary store: IndexedDB
            await dbPut('player', 'local', dataWithVersion);
        } catch (e) {
            console.warn('[System] IndexedDB persistence failed:', e.message);
        }
    };
    if (immediate) {
        clearTimeout(saveTimer);
        await persist();
        return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        await persist();
        saveTimer = null;
    }, 5000);
};

/**
 * Emergency synchronous flush for beforeunload.
 * Uses localStorage only as IDB is async and unreliable in beforeunload.
 */
export const flushSync = (localPlayer) => {
    try {
        const dataWithVersion = { ...localPlayer, _version: SAVE_VERSION };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataWithVersion));
    } catch (e) {
        console.warn('[System] Emergency flush failed:', e.message);
    }
};

export const loadState = async () => {
    try {
        // 1. Try IndexedDB
        const idbState = await dbGet('player', 'local');
        if (idbState) return idbState;
    } catch (e) { console.error('[Persistence] Load fail:', e); }
    try {
        // 2. Fallback to localStorage (migration / IDB unavailable)
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) { console.error('[Persistence] localStorage load fail:', e); }
    return null;
};
