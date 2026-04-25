import { importKey, generateKeyPair, exportKey, signMessage } from './crypto';
import { MASTER_PUBLIC_KEY } from './constants';
import { localPlayer } from './store';
import { hashStr } from './rules';
import { GAME_NAME } from './data';

export let playerKeys = null;
export let arbiterPublicKey = null;

const pidHash = (playerId) => playerId ? (hashStr(playerId) >>> 0).toString(16).padStart(8, '0') : null;

export const initIdentity = async (log) => {
    try {
        const KEYS_STORAGE_KEY = `${GAME_NAME}_keys_v3`;
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
        const exported = JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY));
        localPlayer.ph = pidHash(exported.publicKey);
    } catch (e) {
        console.error('Identity Init Failed', e);
        throw e;
    }
};

export const myEntry = async () => {
    if (!playerKeys) return null;
    const data = { 
        name: localPlayer.name, 
        location: localPlayer.location, 
        ph: localPlayer.ph, 
        level: localPlayer.level, 
        xp: localPlayer.xp,
        ts: Date.now() 
    };
    const signature = await signMessage(JSON.stringify(data), playerKeys.privateKey);
    return { ...data, signature };
};
