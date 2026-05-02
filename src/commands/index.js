import { localPlayer } from '../state/store.js';
import { log } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { joinInstance, currentRtcConfig } from '../network/index.js';
import { getCurrentInstance } from '../network/shard.js';
import { getCommandDefinition, parseCommandInput } from './registry.js';
import { handleSocialCommands } from './social.js';
import { handleInventoryCommands } from './inventory.js';
import { handleNPCCommands } from './npc.js';
import { handleAdminCommands } from './admin.js';
import { handleMiscCommands } from './misc.js';
import { startStateChannel } from './duel.js';
import { ACTION } from '../engine/input.js';

export * from './helpers.js';
export * from './duel.js';

const SIM_COMMANDS = {
    'attack': ACTION.ATTACK,
    'interact': ACTION.INTERACT,
    'pickup': ACTION.INTERACT,
    'north': ACTION.MOVE_N, 'n': ACTION.MOVE_N,
    'south': ACTION.MOVE_S, 's': ACTION.MOVE_S,
    'east': ACTION.MOVE_E,  'e': ACTION.MOVE_E,
    'west': ACTION.MOVE_W,  'w': ACTION.MOVE_W,
    'up': ACTION.MOVE_N,    'down': ACTION.MOVE_S,
    'die': 'die', 'flee': 'flee', 'rest': 'rest'
};

export const handleCommand = async (cmd) => {
    const raw = cmd.trim();
    if (!raw) return;

    const parsed = parseCommandInput(raw);
    const definition = getCommandDefinition(parsed.commandId);
    const command = definition?.id || parsed.commandId;
    const args = definition && definition.id !== parsed.commandId
        ? [definition.id, ...parsed.args.slice(1)]
        : parsed.args;

    // 1. Check for simulation commands (handled by ECS)
    if (SIM_COMMANDS[command]) {
        bus.emit('input:action', { action: SIM_COMMANDS[command], type: 'down' });
        return;
    }
    // Handle 'move north' etc
    if (command === 'move' && args[1] && SIM_COMMANDS[args[1]]) {
        bus.emit('input:action', { action: SIM_COMMANDS[args[1]], type: 'down' });
        return;
    }

    // 2. Try each UI/Admin command handler
    const handlers = [
        handleSocialCommands,
        handleInventoryCommands,
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
    /** @type {any} */(window).devReset = () => {
        localStorage.clear();
        location.reload();
    };

}
