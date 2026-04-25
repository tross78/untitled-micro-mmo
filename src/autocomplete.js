/**
 * Hearthwick Autocomplete Engine
 * Pure function — no DOM, no side effects. Fully testable.
 */

const TOP_COMMANDS = [
    'look', 'move', 'attack', 'rest', 'stats', 'inventory',
    'use', 'who', 'status', 'wave', 'bow', 'cheer',
    'duel', 'accept', 'decline', 'rename', 'map', 'clear', 'help',
    'talk', 'buy', 'sell', 'quest', 'bank', 'say'
];

// Commands that take no argument — tapping their chip runs them immediately.
const NO_ARG_COMMANDS = new Set([
    'look', 'attack', 'rest', 'stats', 'inventory', 'who',
    'status', 'wave', 'bow', 'cheer', 'accept', 'decline',
    'map', 'clear', 'help', 'quest', 'bank'
]);

/**
 * Returns up to 4 autocomplete suggestions for the current input.
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
        case 'talk':   return getNPCSuggestions(arg, ctx);
        case 'buy':    return getShopSuggestions(arg, ctx);
        case 'sell':   return getSellSuggestions(arg, ctx);
        case 'quest':  return getQuestSuggestions(arg, ctx);
        case 'bank':   return getBankSuggestions(arg, ctx);
        case 'say':    return [];
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
            immediate: true,
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

function getNPCSuggestions(arg, { location, NPCS, worldState, getNPCLocation }) {
    if (!getNPCLocation || !NPCS) return [];
    const localNpcs = Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === location);
    return localNpcs
        .map(id => ({ id, name: NPCS[id].name }))
        .filter(({ name }) => name.toLowerCase().startsWith(arg))
        .slice(0, 4)
        .map(({ name }) => ({
            display: name,
            fill: 'talk ' + name.toLowerCase(),
            immediate: true,
        }));
}

function getShopSuggestions(arg, { location, NPCS, worldState, getNPCLocation, ITEMS }) {
    if (!getNPCLocation || !NPCS) return [];
    const shopId = Object.keys(NPCS).find(id => 
        NPCS[id].role === 'shop' && getNPCLocation(id, worldState.seed, worldState.day) === location
    );
    if (!shopId) return [];
    
    return NPCS[shopId].shop
        .map(id => ({ id, name: ITEMS[id]?.name || id }))
        .filter(({ name }) => name.toLowerCase().startsWith(arg))
        .slice(0, 4)
        .map(({ name }) => ({
            display: name,
            fill: 'buy ' + name.toLowerCase(),
            immediate: false,
        }));
}

function getSellSuggestions(arg, { inventory, ITEMS }) {
    const invItems = Array.from(new Set(inventory));
    return invItems
        .map(id => ({ id, name: ITEMS[id]?.name || id }))
        .filter(({ name }) => name.toLowerCase().startsWith(arg))
        .slice(0, 4)
        .map(({ name }) => ({
            display: name,
            fill: 'sell ' + name.toLowerCase(),
            immediate: false,
        }));
}

function getQuestSuggestions(arg) {
    const subs = ['list', 'accept', 'complete'];
    return subs
        .filter(s => s.startsWith(arg))
        .map(s => ({
            display: s,
            fill: 'quest ' + s,
            immediate: s === 'list',
        }));
}

function getBankSuggestions(arg) {
    const subs = ['deposit', 'withdraw'];
    return subs
        .filter(s => s.startsWith(arg))
        .map(s => ({
            display: s,
            fill: 'bank ' + s,
            immediate: false,
        }));
}
