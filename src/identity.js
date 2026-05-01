import { importKey, generateKeyPair, exportKey, signMessage } from './crypto.js';
import { MASTER_PUBLIC_KEY } from './constants.js';
import { localPlayer } from './store.js';
import { hashStr } from './rules.js';
import { GAME_NAME } from './data.js';
import { presenceSignaturePayload } from './network/packer.js';
import { scopedStorageKey } from './runtime.js';

export let playerKeys = null;
export let arbiterPublicKey = null;

const pidHash = (playerId) => playerId ? (hashStr(playerId) >>> 0).toString(16).padStart(8, '0') : null;

export const initIdentity = async (log) => {
    try {
        const KEYS_STORAGE_KEY = scopedStorageKey(`${GAME_NAME}_keys_v4`);
        arbiterPublicKey = await importKey(MASTER_PUBLIC_KEY, 'public');
        const savedKeys = localStorage.getItem(KEYS_STORAGE_KEY);
        if (savedKeys) {
            const { publicKey, privateKey } = JSON.parse(savedKeys);
            playerKeys = {
                publicKey: await importKey(publicKey, 'public'),
                privateKey: await importKey(privateKey, 'private')
            };
        } else {
            const keys = await generateKeyPair();
            const exported = {
                publicKey: await exportKey(keys.publicKey),
                privateKey: await exportKey(keys.privateKey)
            };
            localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(exported));
            playerKeys = keys;
            if (log) log(`[System] New identity generated.`);
        }
        
        // Autoritative update of localPlayer.ph from the current key
        const finalExported = JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY));
        localPlayer.ph = pidHash(finalExported.publicKey);
    } catch (e) {
        console.error('Identity Init Failed', e);
        throw e;
    }
};

export const myEntry = async () => {
    if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return null;
    const data = { 
        name: localPlayer.name, 
        location: localPlayer.location, 
        ph: localPlayer.ph, 
        level: localPlayer.level, 
        xp: localPlayer.xp,
        x: localPlayer.x || 5,
        y: localPlayer.y || 5,
        gold: localPlayer.gold || 0,
        inventory: localPlayer.inventory || [],
        quests: localPlayer.quests || {},
        equipped: localPlayer.equipped || { weapon: null, armor: null },
        ts: Date.now() 
    };
    const signature = await signMessage(JSON.stringify(presenceSignaturePayload(data)), playerKeys.privateKey);
    return { ...data, signature };
};
