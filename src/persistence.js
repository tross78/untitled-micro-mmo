import { STORAGE_KEY } from './store.js';

let saveTimer = null;

const DB_NAME = 'hearthwick';
const DB_VERSION = 1;

/**
 * Async IndexedDB wrapper
 */
const getDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('player')) db.createObjectStore('player');
        if (!db.objectStoreNames.contains('world')) db.createObjectStore('world');
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
});

const dbPut = async (store, key, val) => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
};

const dbGet = async (store, key) => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
};

/**
 * Persists localPlayer state to IndexedDB (and legacy write-through).
 */
export const saveLocalState = async (localPlayer, immediate = false) => {
    const persist = async () => {
        try {
            // Primary store: IndexedDB
            await dbPut('player', 'local', localPlayer);
            // Legacy write-through (for now)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
        } catch (e) {
            console.warn('[System] Persistence failed:', e.message);
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

export const loadState = async () => {
    try {
        // 1. Try IndexedDB
        const idbState = await dbGet('player', 'local');
        if (idbState) return idbState;
        // 2. Fallback to localStorage (migration)
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) { console.error('[Persistence] Load fail:', e); }
    return null;
};
