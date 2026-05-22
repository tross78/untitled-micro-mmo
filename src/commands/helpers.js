import { players, localPlayer } from '../state/store.js';
import { ITEMS, QUESTS, NPCS, world } from '../content/data.js';
import { getNPCLocation } from '../rules/index.js';
import { bus } from '../state/eventbus.js';
import { worldState } from '../state/store.js';

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const nameColor = (name, _color) => String(name);

export const getTag = (ph) => ph ? ph.slice(0, 4) : '????';

export const getPlayerEntry = (id) => players.get(id);

const PEER_ADJECTIVES = ['Amber','Bold','Calm','Dark','Eager','Fair','Glad','Hale','Iron','Just','Keen','Lone','Mild','Noble','Odd','Pale','Quick','Rare','Sage','True','Umber','Vast','Wild','Young'];
const PEER_ANIMALS = ['Bear','Crow','Deer','Eagle','Fox','Hawk','Ibis','Jay','Kite','Lynx','Mink','Newt','Owl','Pike','Quail','Rook','Swan','Toad','Tern','Vole','Wren'];

export const peerDisplayName = (id) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    const adj = PEER_ADJECTIVES[h % PEER_ADJECTIVES.length];
    const ani = PEER_ANIMALS[(h >>> 8) % PEER_ANIMALS.length];
    return `${adj} ${ani}`;
};

export const getPlayerName = (id) => {
    const entry = players.get(id);
    const name = escapeHtml(entry?.name || peerDisplayName(id));
    const tag = entry?.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};

export const getNPCsAt = (location) => {
    const room = world[location];
    const staticIds = new Set((room?.staticEntities || []).map(entry => entry.id));
    Object.keys(NPCS).forEach(id => {
        if (getNPCLocation(id, worldState.seed, worldState.day) === location) {
            staticIds.add(id);
        }
    });
    return Array.from(staticIds);
};

export const getBestGear = () => {
    const eqWep = localPlayer.equipped?.weapon ? ITEMS[localPlayer.equipped.weapon] : null;
    const eqArm = localPlayer.equipped?.armor ? ITEMS[localPlayer.equipped.armor] : null;

    // Equipped gear takes effect. Fall back to best in inventory only when nothing
    // is equipped so players without equip habit aren't penalised, but equipping
    // a specific piece locks in that bonus rather than auto-using the best available.
    let weaponBonus = eqWep?.bonus ?? 0;
    let defenseBonus = eqArm?.bonus ?? 0;
    if (!eqWep || !eqArm) {
        localPlayer.inventory.forEach(id => {
            const item = ITEMS[id];
            if (!item) return;
            if (!eqWep && item.type === 'weapon' && item.bonus > weaponBonus) weaponBonus = item.bonus;
            if (!eqArm && item.type === 'armor' && item.bonus > defenseBonus) defenseBonus = item.bonus;
        });
    }
    return { weaponBonus, defenseBonus };
};

const WANDERING_TRADER_WARES = ['old_tome', 'healing_elixir', 'steel_sword'];

export const getShopInventory = (npcId) => {
    const npc = NPCS[npcId];
    if (!npc?.shop) return [];
    const inventory = [...npc.shop];
    if (npcId === 'merchant' && worldState.event?.type === 'wandering_trader') {
        WANDERING_TRADER_WARES.forEach((itemId) => {
            if (!inventory.includes(itemId)) inventory.push(itemId);
        });
    }
    return inventory;
};

export const getBuyPrice = (itemId) => {
    const item = ITEMS[itemId];
    if (!item) return 0;
    let price = item.price || 0;
    
    // 8.6b: scarcity raises buy price; surplus lowers it
    if (worldState.scarcity?.includes(itemId)) price *= 1.5;
    if (worldState.surplus?.includes(itemId)) price *= 0.7;
    
    // market_surplus event applies to all materials and consumables
    if (worldState.event?.type === 'market_surplus' && (item.type === 'material' || item.type === 'consumable')) {
        price *= 0.8;
    }
    
    return Math.ceil(price);
};

export const getSellPrice = (itemId) => {
    const item = ITEMS[itemId];
    if (!item) return 0;
    let price = (item.price || 0) * 0.4;
    
    // 8.6b: scarcity raises sell price; surplus lowers it
    if (worldState.scarcity?.includes(itemId)) price *= 1.4;
    if (worldState.surplus?.includes(itemId)) price *= 0.6;
    
    // market_surplus event depresses sell prices too
    if (worldState.event?.type === 'market_surplus' && (item.type === 'material' || item.type === 'consumable')) {
        price *= 0.7;
    }
    
    // 8.6b: bounty_hunt event doubles bounty price on contraband items
    if (worldState.event?.type === 'bounty_hunt' && item.bountyPrice) {
        return (item.bountyPrice || Math.ceil(price)) * 2;
    }
    
    return Math.max(1, Math.ceil(price));
};

export const grantItem = (itemId) => {
    if (!ITEMS[itemId]) return;
    localPlayer.inventory.push(itemId);

    const item = ITEMS[itemId];
    if (item.type === 'weapon' || item.type === 'armor') {
        const slot = item.type === 'weapon' ? 'weapon' : 'armor';
        const current = localPlayer.equipped[slot] ? ITEMS[localPlayer.equipped[slot]] : null;
        if (!current || item.bonus > current.bonus) {
            localPlayer.equipped[slot] = itemId;
        }
    }

    Object.keys(localPlayer.quests).forEach(qid => {
        const q = QUESTS[qid];
        const pq = localPlayer.quests[qid];
        if (q && !pq.completed && q.type === 'fetch' && q.objective.target === itemId) {
            const count = localPlayer.inventory.filter(id => id === itemId).length;
            pq.progress = Math.min(q.objective.count, count);
            bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
        }
    });
};
