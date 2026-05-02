import { localPlayer } from '../state/store.js';
import { log } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { joinInstance, currentRtcConfig } from '../network/index.js';
import { getCurrentInstance } from '../network/shard.js';
import { getCommandDefinition, parseCommandInput } from './registry.js';

import { handleCombatCommands } from './combat.js';
import { handleSocialCommands } from './social.js';
import { handleInventoryCommands } from './inventory.js';
import { handleMovementCommands } from './movement.js';
import { handleNPCCommands } from './npc.js';
import { handleAdminCommands } from './admin.js';
import { handleMiscCommands } from './misc.js';
import { startStateChannel } from './duel.js';

export * from './helpers.js';
export * from './duel.js';

export const handleCommand = async (cmd) => {
    const raw = cmd.trim();
    if (!raw) return;

    const parsed = parseCommandInput(raw);
    const definition = getCommandDefinition(parsed.commandId);
    const command = definition?.id || parsed.commandId;
    const args = definition && definition.id !== parsed.commandId
        ? [definition.id, ...parsed.args.slice(1)]
        : parsed.args;

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
                    await joinInstance(localPlayer.location, getCurrentInstance(), currentRtcConfig);
                } else if (result.type === 'duel_accept') {
                    await startStateChannel(result.targetId, result.targetName, result.day);
                } else if (result.type === 'recursive') {
                    await handleCommand(result.cmd);
                }
            }
            return;
        }
    }

    log(`Unknown command: ${parsed.commandId}.`);
};

if (typeof window !== 'undefined') {
    window.devReset = () => {
        localStorage.clear();
        window.location.reload();
    };
}
