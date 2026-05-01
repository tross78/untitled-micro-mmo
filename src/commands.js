import { localPlayer } from './store.js';
import { log } from './ui.js';
import { bus } from './eventbus.js';
import { joinInstance, currentInstance, currentRtcConfig } from './networking.js';

import { handleCombatCommands } from './commands/combat.js';
import { handleSocialCommands } from './commands/social.js';
import { handleInventoryCommands } from './commands/inventory.js';
import { handleMovementCommands } from './commands/movement.js';
import { handleNPCCommands } from './commands/npc.js';
import { handleAdminCommands } from './commands/admin.js';
import { handleMiscCommands } from './commands/misc.js';
import { startStateChannel } from './commands/duel.js';

export * from './commands/helpers.js';
export * from './commands/duel.js';

export const handleCommand = async (cmd) => {
    const raw = cmd.trim();
    if (!raw) return;
    
    const cleanCmd = raw.startsWith('/') ? raw.slice(1) : raw;
    const args = cleanCmd.split(/\s+/);
    const command = args[0].toLowerCase();

    // Try each command handler until one handles it
    const handlers = [
        handleCombatCommands,
        handleSocialCommands,
        handleInventoryCommands,
        handleMovementCommands,
        handleNPCCommands,
        handleAdminCommands,
        handleMiscCommands
    ];

    for (const handler of handlers) {
        const result = await handler(command, args);
        if (result) {
            // Handle cross-cutting concerns returned by handlers (e.g. room changes)
            if (typeof result === 'object') {
                if (result.type === 'move') {
                    await handleCommand(`move ${result.dir}`);
                } else if (result.type === 'respawn' || result.type === 'join_instance') {
                    await joinInstance(localPlayer.location, currentInstance, currentRtcConfig);
                } else if (result.type === 'duel_accept') {
                    await startStateChannel(result.targetId, result.targetName, result.day);
                } else if (result.type === 'recursive') {
                    await handleCommand(result.cmd);
                }
            }
            return;
        }
    }

    log(`Unknown command: ${command}.`);
};

if (typeof window !== 'undefined') {
    window.devReset = () => {
        localStorage.clear();
        window.location.reload();
    };
}
