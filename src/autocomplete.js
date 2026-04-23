/**
 * Hearthwick Autocomplete Engine
 * Pure function — no DOM, no side effects. Fully testable.
 */

const TOP_COMMANDS = [
    'look', 'move', 'attack', 'rest', 'stats', 'inventory',
    'use', 'who', 'status', 'wave', 'bow', 'cheer',
    'duel', 'accept', 'decline', 'rename', 'map', 'clear', 'help',
];

// Commands that take no argument — tapping their chip runs them immediately.
const NO_ARG_COMMANDS = new Set([
    'look', 'attack', 'rest', 'stats', 'inventory', 'who',
    'status', 'wave', 'bow', 'cheer', 'accept', 'decline',
    'map', 'clear', 'help',
]);

/**
 * Returns up to 4 autocomplete suggestions for the current input.
 *
 * @param {string} raw - Current input value (with or without leading /)
 * @param {object} ctx
 * @param {string[]}    ctx.inventory    - Array of item IDs the player is carrying
 * @param {string}      ctx.location     - Current room ID
 * @param {object}      ctx.world        - World map (room definitions with exits)
 * @param {Map}         ctx.players      - Peer map: id -> { name, location, ... }
 * @param {object}      ctx.ITEMS        - Item definitions: id -> { name, type, ... }
 *
 * @returns {{ display: string, fill: string, immediate: boolean }[]}
 *   display  — text shown on the chip
 *   fill     — value placed in the input on selection
 *   immediate — if true, the command is submitted on tap (no Enter needed)
 */
export function getSuggestions(raw, ctx) {
    const input = raw.replace(/^\//, '').trimStart().toLowerCase();

    const spaceIdx = input.indexOf(' ');
    if (spaceIdx === -1) {
        return getCommandSuggestions(input);
    }

    const cmd = input.slice(0, spaceIdx);
    const arg = input.slice(spaceIdx + 1);
    return getArgSuggestions(cmd, arg, ctx);
}

function getCommandSuggestions(partial) {
    return TOP_COMMANDS
        .filter(c => c.startsWith(partial))
        .slice(0, 4)
        .map(c => ({
            display: c,
            fill: NO_ARG_COMMANDS.has(c) ? c : c + ' ',
            immediate: NO_ARG_COMMANDS.has(c),
        }));
}

function getArgSuggestions(cmd, arg, ctx) {
    switch (cmd) {
        case 'use':    return getItemSuggestions(arg, ctx);
        case 'move':   return getMoveSuggestions(arg, ctx);
        case 'duel':   return getPlayerSuggestions(arg, ctx);
        default:       return [];
    }
}

function getItemSuggestions(arg, { inventory, ITEMS }) {
    return inventory
        .map(id => {
            const name = ITEMS[id]?.name || id;
            return { id, name, nameLower: name.toLowerCase() };
        })
        .filter(({ nameLower }) => nameLower.startsWith(arg))
        .slice(0, 4)
        .map(({ name, nameLower }) => ({
            display: name,
            fill: 'use ' + nameLower,
            immediate: false,
        }));
}

function getMoveSuggestions(arg, { location, world }) {
    const exits = Object.keys(world[location]?.exits || {});
    return exits
        .filter(dir => dir.startsWith(arg))
        .slice(0, 4)
        .map(dir => ({
            display: dir,
            fill: 'move ' + dir,
            immediate: true,  // one tap = move, no Enter needed
        }));
}

function getPlayerSuggestions(arg, { players }) {
    const results = [];
    for (const entry of players.values()) {
        const name = entry.name || '';
        if (name.toLowerCase().startsWith(arg)) {
            results.push({
                display: name,
                fill: 'duel ' + name.toLowerCase(),
                immediate: false,
            });
            if (results.length >= 4) break;
        }
    }
    return results;
}
