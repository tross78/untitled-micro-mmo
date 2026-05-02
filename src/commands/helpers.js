import { players, localPlayer } from '../state/store.js';
import { ITEMS, QUESTS, NPCS } from '../engine/data.js';
import { getNPCLocation } from '../rules/index.js';
import { bus } from '../state/eventbus.js';
import { worldState } from '../state/store.js';

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const nameColor = (name, _color) => String(name);

export const getTag = (ph) => ph ? ph.slice(0, 4) : '????';

export const getPlayerEntry = (id) => players.get(id);

export const getPlayerName = (id) => {
    const entry = players.get(id);
    if (!entry) return `Peer-${escapeHtml(id.slice(0, 4))}`;
    const name = escapeHtml(entry.name || `Peer-${id.slice(0, 4)}`);
    const tag = entry.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};

export const getNPCsAt = (location) => {
    return Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === location);
};

export const getBestGear = () => {
    let weaponBonus = 0;
    let defenseBonus = 0;
    localPlayer.inventory.forEach(id => {
        const item = ITEMS[id];
        if (!item) return;
        if (item.type === 'weapon' && item.bonus > weaponBonus) weaponBonus = item.bonus;
        if (item.type === 'armor' && item.bonus > defenseBonus) defenseBonus = item.bonus;
    });
    const eqWep = localPlayer.equipped?.weapon ? ITEMS[localPlayer.equipped.weapon] : null;
    const eqArm = localPlayer.equipped?.armor ? ITEMS[localPlayer.equipped.armor] : null;

    return { 
        weaponBonus: Math.max(weaponBonus, eqWep?.bonus || 0), 
        defenseBonus: Math.max(defenseBonus, eqArm?.bonus || 0) 
    };
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
