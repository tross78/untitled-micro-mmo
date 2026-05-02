import { localPlayer } from '../state/store.js';
import { xpToLevel } from '../rules/index.js';
import { log } from '../ui/index.js';
import { saveLocalState } from '../state/persistence.js';
import { ITEMS } from '../content/data.js';
import { grantItem, nameColor } from './helpers.js';

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
    }
    return false;
};
