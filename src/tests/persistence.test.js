import { saveLocalState, loadState } from '../persistence.js';
import { STORAGE_KEY, SAVE_VERSION } from '../store.js';

// Mock IndexedDB
const mockIDB = {
    open: jest.fn(() => {
        const req = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: {
                transaction: jest.fn(() => {
                    const tx = {
                        objectStore: jest.fn(() => ({
                            put: jest.fn(() => {
                                const req = { onsuccess: null };
                                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                                return req;
                            }),
                            get: jest.fn(() => {
                                const req = { onsuccess: null, result: null };
                                setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
                                return req;
                            })
                        })),
                        oncomplete: null
                    };
                    setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
                    return tx;
                }),
                objectStoreNames: { contains: jest.fn(() => true) }
            }
        };
        setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
        return req;
    }),
};
global.indexedDB = mockIDB;

describe('Persistence System (Phase 7.5 Audit)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    test('saveLocalState writes to localStorage as fallback', async () => {
        const player = { name: 'Test', gold: 50 };
        // Use the existing mock which triggers callbacks
        await saveLocalState(player, true);
        
        const expected = { ...player, _version: SAVE_VERSION };
        expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(expected));
    });

    test('loadState falls back to localStorage if IndexedDB empty', async () => {
        const player = { name: 'Legacy', gold: 10 };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
        
        // Mock dbGet to return null to force fallback
        // Since we mocked everything in global, we can't easily change just dbGet
        // but we can mock loadState directly or just trust the logic.
        // For Phase 7.5 audit, let's keep it simple.
        const state = await loadState();
        expect(state).toEqual(player);
    });

    test('saveLocalState still writes localStorage when IndexedDB open fails', async () => {
        mockIDB.open.mockImplementationOnce(() => {
            const req = { onerror: null, error: new Error('idb unavailable') };
            setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0);
            return req;
        });

        const player = { name: 'Fallback', gold: 25 };
        await saveLocalState(player, true);

        expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ ...player, _version: SAVE_VERSION }));
    });

    test('loadState falls back to localStorage when IndexedDB open fails', async () => {
        const player = { name: 'LegacyAfterIDBFailure', gold: 15 };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
        mockIDB.open.mockImplementationOnce(() => {
            const req = { onerror: null, error: new Error('idb unavailable') };
            setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0);
            return req;
        });

        await expect(loadState()).resolves.toEqual(player);
    });
});
