import { STORAGE_KEY } from './store.js';

let saveTimer = null;

/**
 * Persists localPlayer state to localStorage.
 */
export const saveLocalState = (localPlayer, immediate = false) => {
    const persist = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
        } catch (e) {
            console.warn('[System] Storage full — progress not saved:', e.message);
        }
    };
    if (immediate) {
        clearTimeout(saveTimer);
        persist();
        return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        persist();
        saveTimer = null;
    }, 5000);
};
