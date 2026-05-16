import { localPlayer, WORLD_STATE_KEY, STORAGE_KEY } from '../state/store.js';
import { xpToLevel } from '../rules/index.js';
import { log } from '../ui/index.js';
import { saveLocalState } from '../state/persistence.js';
import { ITEMS, GAME_NAME } from '../content/data.js';
import { grantItem, nameColor } from './helpers.js';
import { scopedStorageKey } from '../infra/runtime.js';

export const handleAdminCommands = async (command, args) => {
    switch (command) {
        case 'addxp': {
            const amt = parseInt(args[1]) || 100;
            localPlayer.xp += amt;
            localPlayer.level = xpToLevel(localPlayer.xp);
            log(`[Dev] Added ${amt} XP. Level is now ${localPlayer.level}.`);
            saveLocalState(localPlayer, true);
            return true;
        }

        case 'addgold': {
            const amt = parseInt(args[1]) || 1000;
            localPlayer.gold += amt;
            log(`[Dev] Added ${amt} Gold.`);
            saveLocalState(localPlayer, true);
            return true;
        }

        case 'spawn': {
            const id = args[1];
            if (!ITEMS[id]) { log(`[Dev] Unknown item: ${id}`); return true; }
            grantItem(id);
            log(`[Dev] Spawned ${nameColor(ITEMS[id].name, ITEMS[id].color)}.`);
            saveLocalState(localPlayer, true);
            return true;
        }

        case 'reset': {
            // Wipe player save data, keep identity keys. Reload to reconnect fresh.
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(`${GAME_NAME}_offline_day_ts`);
            localStorage.removeItem(`${GAME_NAME}_last_fight_reset_utc`);
            log('[Dev] Player data cleared. Reloading...', '#fa0');
            setTimeout(() => location.reload(), 800);
            return true;
        }

        case 'resetworld': {
            // Wipe player data + world state + introducer cache. Full clean slate.
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(WORLD_STATE_KEY);
            localStorage.removeItem(scopedStorageKey(`${GAME_NAME}_introducers_v1`));
            localStorage.removeItem(`${GAME_NAME}_offline_day_ts`);
            localStorage.removeItem(`${GAME_NAME}_last_fight_reset_utc`);
            log('[Dev] All local state cleared. Reloading...', '#f55');
            setTimeout(() => location.reload(), 800);
            return true;
        }
    }
    return false;
};
