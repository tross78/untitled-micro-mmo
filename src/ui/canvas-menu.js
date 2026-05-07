import { ITEMS, NPCS, QUESTS, RECIPES, roomHasFeature } from '../content/data.js';
import { ENEMIES } from '../content/data.js';
import { levelBonus } from '../rules/index.js';
import { players, worldState } from '../state/store.js';
import { getBuyPrice, getSellPrice } from '../commands/helpers.js';
import { getAudioSettings } from '../engine/audio.js';

const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const MOVE_DIRECTIONS = new Set(['north', 'south', 'east', 'west', 'up', 'down']);

const itemCommandName = (itemId) => (ITEMS[itemId]?.name || itemId).toLowerCase();

const countItem = (inventory, itemId) => inventory.filter(id => id === itemId).length;

const getSellableItems = (localPlayer) => {
    const seen = new Set();
    return (localPlayer.inventory || []).filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        const item = ITEMS[id];
        return !!item && item.type !== 'gold' && item.price > 0;
    });
};

const getQuestRowsForNpc = (localPlayer, npcId, npcsHere) => {
    const rows = [];
    Object.values(QUESTS).forEach((quest) => {
        if (quest.giver === npcId && !localPlayer.quests?.[quest.id]) {
            const prereqOk = !quest.prerequisite || localPlayer.quests?.[quest.prerequisite]?.completed;
            if (prereqOk) {
                rows.push({
                    label: `Accept ${quest.name}`,
                    detail: quest.description,
                    action: { kind: 'command', command: `quest accept ${quest.id}` },
                });
            }
        }
    });

    Object.entries(localPlayer.quests || {}).forEach(([qid, progress]) => {
        const quest = QUESTS[qid];
        if (!quest) return;

        if (quest.receiver === npcId && !progress.completed) {
            const goal = quest.objective?.count || 1;
            if ((progress.progress || 0) >= goal) {
                rows.push({
                    label: `Complete ${quest.name}`,
                    detail: `Reward: ${quest.reward.gold || 0}g / ${quest.reward.xp || 0}xp`,
                    action: { kind: 'command', command: `quest complete ${quest.id}` },
                });
            } else {
                rows.push({
                    label: quest.name,
                    detail: `${progress.progress || 0}/${goal}`,
                    disabled: true,
                });
            }
        } else if (quest.giver === npcId && !progress.completed) {
            rows.push({
                label: quest.name,
                detail: `${progress.progress || 0}/${quest.objective?.count || 1}`,
                disabled: true,
            });
        }
    });

    if (rows.length === 0 && npcsHere.includes(npcId)) {
        rows.push({ label: 'No quests right now', detail: 'Come back later.', disabled: true });
    }
    return rows;
};

const baseNpcMessage = (npcId) => NPCS[npcId]?.baseDialogue || '...';

export function buildCanvasMenu(type, context, menuCtx) {
    const { localPlayer, world, getNPCsAt, getTimeOfDay } = menuCtx;
    const location = world[localPlayer.location];
    const npcsHere = getNPCsAt(localPlayer.location);
    const timeOfDay = getTimeOfDay();

    if (type === 'root') {
        const enemyId = location?.enemy;
        const enemy = enemyId ? ENEMIES[enemyId] : null;
        const audio = getAudioSettings();
        const entries = [
            { label: 'Inventory', detail: `${localPlayer.inventory?.length || 0} items`, action: { kind: 'menu', menuType: 'inventory' } },
            { label: 'Quests', detail: `${Object.keys(localPlayer.quests || {}).length} active`, action: { kind: 'menu', menuType: 'quests' } },
        ];
        if ((RECIPES || []).some(r => r.location === localPlayer.location)) {
            entries.push({ label: 'Craft', detail: capitalize(localPlayer.location), action: { kind: 'menu', menuType: 'crafting' } });
        }
        if (!localPlayer.currentEnemy) {
            entries.push({ label: 'Rest', detail: 'Recover and regroup', action: { kind: 'command', command: 'rest' } });
        }
        if (roomHasFeature(localPlayer.location, 'bank')) {
            entries.push({ label: 'Bank', detail: `${localPlayer.bankedGold || 0}g stored`, action: { kind: 'command', command: 'bank' } });
        }
        if (enemy) {
            entries.push({ label: `Attack ${enemy.name}`, detail: 'Hostile nearby', action: { kind: 'command', command: 'attack' } });
        }
        entries.push({ label: 'Stats', detail: `Lvl ${localPlayer.level}`, action: { kind: 'menu', menuType: 'stats' } });
        entries.push({ label: 'Status', detail: 'Effects & world state', action: { kind: 'menu', menuType: 'status' } });
        entries.push({ label: 'Map', detail: 'Connected locations', action: { kind: 'menu', menuType: 'map' } });
        entries.push({ label: 'Audio', detail: audio.muted ? 'Muted' : `Music ${Math.round(audio.music * 100)}% / SFX ${Math.round(audio.sfx * 100)}%`, action: { kind: 'menu', menuType: 'audio' } });
        entries.push({ label: 'Close', detail: 'Return to the world', action: { kind: 'close' } });
        return { type, title: 'Adventurer Menu', message: 'Select an action.', entries, selectedIndex: 0 };
    }

    if (type === 'audio') {
        const audio = getAudioSettings();
        const entries = [
            {
                label: audio.muted ? 'Unmute Audio' : 'Mute Audio',
                detail: audio.muted ? 'Enable music and sound effects' : 'Silence all audio output',
                action: { kind: 'emit', event: 'audio:toggle-mute' },
            },
            {
                label: 'Music Volume',
                detail: `${Math.round(audio.music * 100)}%`,
                action: { kind: 'emit', event: 'audio:change-volume', payload: { field: 'music', delta: audio.music >= 1 ? -0.2 : 0.2 } },
            },
            {
                label: 'SFX Volume',
                detail: `${Math.round(audio.sfx * 100)}%`,
                action: { kind: 'emit', event: 'audio:change-volume', payload: { field: 'sfx', delta: audio.sfx >= 1 ? -0.2 : 0.2 } },
            },
            { label: 'Back', detail: 'Return', action: { kind: 'back' } },
        ];
        return { type, title: 'Audio', message: 'Tune the demo mix.', entries, selectedIndex: 0 };
    }

    if (type === 'move') {
        const entries = Object.keys(location?.exits || {})
            .filter((dir) => MOVE_DIRECTIONS.has(dir))
            .map((dir) => ({
                label: capitalize(dir),
                detail: location.exits[dir],
                action: { kind: 'command', command: `move ${dir}` },
            }));
        if (!entries.length) entries.push({ label: 'No clear route', detail: 'Use a marked doorway or path.', disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'Move', message: 'Choose a direction.', entries, selectedIndex: 0 };
    }

    if (type === 'inventory') {
        const items = Array.from(new Set(localPlayer.inventory || []));
        const entries = items.map((id) => {
            const item = ITEMS[id];
            const count = countItem(localPlayer.inventory || [], id);
            if (!item) {
                return { label: `${id}${count > 1 ? ` x${count}` : ''}`, detail: 'Unknown item', disabled: true };
            }
            let command = null;
            if (item.type === 'consumable' || item.type === 'buff') command = `use ${itemCommandName(id)}`;
            else if (item.type === 'weapon' || item.type === 'armor') command = `equip ${itemCommandName(id)}`;
            const detail = item.heal ? `Heals ${item.heal}` : item.bonus ? `+${item.bonus}` : item.price ? `${item.price}g` : item.type;
            return {
                label: `${item.name}${count > 1 ? ` x${count}` : ''}`,
                detail,
                disabled: !command,
                action: command ? { kind: 'command', command } : null,
            };
        });
        if (entries.length === 0) entries.push({ label: 'Pack is empty', detail: 'No items to use.', disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'Inventory', message: 'Use or equip your gear.', entries, selectedIndex: 0 };
    }

    if (type === 'quests') {
        const entries = [];
        Object.entries(localPlayer.quests || {}).forEach(([qid, progress]) => {
            const quest = QUESTS[qid];
            if (!quest) return;
            const goal = quest.objective?.count || 1;
            const status = progress.completed ? 'Complete' : `${progress.progress || 0}/${goal}`;
            entries.push({
                label: quest.name,
                detail: status,
                disabled: true,
            });
        });
        if (entries.length === 0) entries.push({ label: 'No active quests', detail: 'Talk to townsfolk for work.', disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'Quest Log', message: 'Current objectives.', entries, selectedIndex: 0 };
    }

    if (type === 'npc') {
        const npcId = context?.npcId;
        const npc = NPCS[npcId];
        if (!npc) return null;
        const entries = [];
        const questRows = getQuestRowsForNpc(localPlayer, npcId, npcsHere);
        if (npc.role === 'shop' && npc.shop?.length) {
            const closedAtNight = npcId === 'merchant' && timeOfDay === 'night';
            entries.push({ label: 'Buy', detail: closedAtNight ? 'Shop is closed at night' : `${npc.shop.length} wares`, disabled: closedAtNight, action: { kind: 'menu', menuType: 'shop', context: { npcId } } });
            if (getSellableItems(localPlayer).length > 0) {
                entries.push({ label: 'Sell', detail: 'Turn goods into gold', disabled: closedAtNight, action: { kind: 'menu', menuType: 'sell', context: { npcId } } });
            }
        }
        if (questRows.some(row => !row.disabled)) {
            entries.push({ label: 'Quests', detail: 'Jobs and turn-ins', action: { kind: 'menu', menuType: 'npc_quests', context: { npcId } } });
        }
        entries.push({ label: 'Leave', detail: 'Step away', action: { kind: 'close' } });
        return { type, title: npc.name, message: context?.text || baseNpcMessage(npcId), entries, selectedIndex: 0, context: { npcId } };
    }

    if (type === 'npc_quests') {
        const npcId = context?.npcId;
        const npc = NPCS[npcId];
        if (!npc) return null;
        const entries = getQuestRowsForNpc(localPlayer, npcId, npcsHere);
        entries.push({ label: 'Back', detail: npc.name, action: { kind: 'back' } });
        return { type, title: `${npc.name} Quests`, message: 'Choose a quest action.', entries, selectedIndex: 0, context: { npcId } };
    }

    if (type === 'shop') {
        const npcId = context?.npcId;
        const npc = NPCS[npcId];
        if (!npc) return null;
        const entries = (npc.shop || []).map((itemId) => {
            const item = ITEMS[itemId];
            const detail = item.heal ? `+${item.heal} hp` : item.bonus ? `+${item.bonus}` : item.type;
            const closedAtNight = npcId === 'merchant' && timeOfDay === 'night';
            const price = getBuyPrice(itemId);
            const scarcityTag = worldState.scarcity.includes(itemId) ? ' ⚠️ scarce' : worldState.event?.type === 'market_surplus' && (item.type === 'material' || item.type === 'consumable') ? ' ↓ surplus' : '';
            return {
                label: `${item.name} - ${price}g`,
                detail: `${detail}${scarcityTag}`,
                disabled: localPlayer.gold < price || closedAtNight,
                action: { kind: 'command', command: `buy ${itemCommandName(itemId)}` },
            };
        });
        if (entries.length === 0) entries.push({ label: 'No wares', detail: 'Try later.', disabled: true });
        entries.push({ label: 'Back', detail: npc.name, action: { kind: 'back' } });
        return { type, title: `${npc.name}'s Wares`, message: `Gold: ${localPlayer.gold || 0}`, entries, selectedIndex: 0, context: { npcId } };
    }

    if (type === 'sell') {
        const npcId = context?.npcId;
        const npc = NPCS[npcId];
        if (!npc) return null;
        const entries = getSellableItems(localPlayer).map((itemId) => {
            const item = ITEMS[itemId];
            const sellPrice = getSellPrice(itemId);
            return {
                label: `${item.name} - ${sellPrice}g`,
                detail: item.type,
                action: { kind: 'command', command: `sell ${itemCommandName(itemId)}` },
            };
        });
        if (entries.length === 0) entries.push({ label: 'Nothing to sell', detail: 'Bring tradable goods.', disabled: true });
        entries.push({ label: 'Back', detail: npc.name, action: { kind: 'back' } });
        return { type, title: `Sell to ${npc.name}`, message: `Gold: ${localPlayer.gold || 0}`, entries, selectedIndex: 0, context: { npcId } };
    }

    if (type === 'crafting') {
        const recipes = (RECIPES || []).filter(r => r.location === localPlayer.location);
        const entries = recipes.map((recipe) => {
            const inputs = Object.entries(recipe.inputs).map(([id, qty]) => `${qty}x ${ITEMS[id]?.name || id}`).join(', ');
            const canCraft = Object.entries(recipe.inputs).every(([id, qty]) => countItem(localPlayer.inventory || [], id) >= qty);
            return {
                label: recipe.name,
                detail: inputs,
                disabled: !canCraft,
                action: { kind: 'command', command: `craft ${recipe.id}` },
            };
        });
        if (entries.length === 0) entries.push({ label: 'Nothing to craft here', detail: localPlayer.location, disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'Crafting', message: capitalize(localPlayer.location), entries, selectedIndex: 0 };
    }

    if (type === 'stats') {
        const bonus = levelBonus(localPlayer.level);
        const restedBonus = (localPlayer.statusEffects || []).find(s => s.id === 'well_rested') ? 5 : 0;
        const maxHp = (localPlayer.maxHp || 20) + bonus.maxHp + restedBonus;
        const xpForLevel = (l) => (l - 1) ** 2 * 10;
        const xpNeeded = xpForLevel(localPlayer.level + 1) - (localPlayer.xp || 0);
        const eqWep = localPlayer.equipped?.weapon ? (ITEMS[localPlayer.equipped.weapon]?.name || 'none') : 'none';
        const eqArm = localPlayer.equipped?.armor ? (ITEMS[localPlayer.equipped.armor]?.name || 'none') : 'none';
        const entries = [
            { label: 'Level', detail: `${localPlayer.level}  (${xpNeeded} XP to next)`, disabled: true },
            { label: 'HP', detail: `${localPlayer.hp} / ${maxHp}`, disabled: true },
            { label: 'Attack', detail: `${(localPlayer.attack || 1) + bonus.attack}`, disabled: true },
            { label: 'Defense', detail: `${(localPlayer.defense || 0) + bonus.defense}`, disabled: true },
            { label: 'Weapon', detail: eqWep, disabled: true },
            { label: 'Armor', detail: eqArm, disabled: true },
            { label: 'Gold', detail: `${localPlayer.gold || 0}g  (Bank: ${localPlayer.bankedGold || 0}g)`, disabled: true },
            { label: 'Fights left today', detail: `${localPlayer.forestFights ?? '?'}`, disabled: true },
            { label: 'Back', detail: 'Return', action: { kind: 'back' } },
        ];
        return { type, title: localPlayer.name || 'Character', message: `XP: ${localPlayer.xp || 0}`, entries, selectedIndex: entries.length - 1 };
    }

    if (type === 'status') {
        const { worldState } = menuCtx;
        const effects = localPlayer.statusEffects || [];
        const effectLabels = { poisoned: 'Poisoned', well_rested: 'Well Rested' };
        const entries = [];
        if (effects.length === 0) {
            entries.push({ label: 'No active effects', detail: 'Feeling normal', disabled: true });
        } else {
            effects.forEach(e => {
                const dur = e.duration != null ? `${e.duration} turns left` : 'active';
                entries.push({ label: effectLabels[e.id] || e.id, detail: dur, disabled: true });
            });
        }
        entries.push({ label: 'Day', detail: `${worldState?.day ?? 1}`, disabled: true });
        const threat = worldState?.threatLevel || 0;
        const scarcity = worldState?.scarcity || [];
        const surplus = worldState?.surplus || [];
        if (threat > 0) entries.push({ label: 'Threat Level', detail: `${threat} — enemies are stronger`, disabled: true });
        if (scarcity.length > 0) entries.push({ label: 'Scarce goods', detail: scarcity.map(id => ITEMS[id]?.name || id).join(', '), disabled: true });
        if (surplus.length > 0) entries.push({ label: 'Market surplus', detail: surplus.map(id => ITEMS[id]?.name || id).join(', '), disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'World Status', message: location?.name || '', entries, selectedIndex: entries.length - 1 };
    }

    if (type === 'map') {
        const visited = localPlayer.visitedRooms || [localPlayer.location];
        const currentLoc = localPlayer.location;
        const entries = visited.map(locId => {
            const loc = world[locId];
            if (!loc) return null;
            const exits = Object.keys(loc.exits || {}).join(', ') || 'none';
            const isCurrent = locId === currentLoc;
            return {
                label: `${isCurrent ? '▶ ' : ''}${loc.name || locId}`,
                detail: isCurrent ? 'You are here' : `Exits: ${exits}`,
                disabled: true,
            };
        }).filter(Boolean);
        if (entries.length === 0) entries.push({ label: location?.name || currentLoc, detail: 'You are here', disabled: true });
        entries.push({ label: 'Back', detail: 'Return', action: { kind: 'back' } });
        return { type, title: 'World Map', message: `${visited.length} location${visited.length !== 1 ? 's' : ''} discovered`, entries, selectedIndex: entries.length - 1 };
    }

    return null;
}

export function findNearestEnabledIndex(entries, startIndex, delta) {
    if (!entries.length) return 0;
    let index = startIndex;
    for (let i = 0; i < entries.length; i++) {
        index = (index + delta + entries.length) % entries.length;
        if (!entries[index]?.disabled) return index;
    }
    return startIndex;
}

export function getNearbyNpcIds(location, getNPCsAt) {
    return getNPCsAt(location);
}

export function getLocalPeerCount(location) {
    let count = 0;
    players.forEach((peer) => {
        if (peer.location === location && !peer.ghost) count += 1;
    });
    return count;
}
