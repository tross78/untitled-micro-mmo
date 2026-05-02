import { localPlayer, players, pendingTrade, setPendingTrade, worldState } from '../state/store.js';
import { ITEMS, QUESTS, RECIPES } from '../engine/data.js';
import { levelBonus, xpToLevel, getTimeOfDay } from '../rules/index.js';
import { log } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { saveLocalState } from '../state/persistence.js';
import { gameActions } from '../network/index.js';
import { playerKeys } from '../security/identity.js';
import { signMessage } from '../security/crypto.js';
import { getNPCsAt, grantItem } from './helpers.js';

export const handleInventoryCommands = async (command, args) => {
    switch (command) {
        case 'equip': {
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) { bus.emit('log', { msg: `Usage: /equip <item name>` }); return true; }

            const invIdx = localPlayer.inventory.findIndex(id => (ITEMS[id]?.name || id).toLowerCase() === query || id === query);
            if (invIdx === -1) { bus.emit('log', { msg: `You don't have that.` }); return true; }

            const itemId = localPlayer.inventory[invIdx];
            const item = ITEMS[itemId];
            if (item.type === 'weapon') {
                localPlayer.equipped.weapon = itemId;
                bus.emit('log', { msg: `You equip the ${item.name}.`, color: '#0f0' });
            } else if (item.type === 'armor') {
                localPlayer.equipped.armor = itemId;
                bus.emit('log', { msg: `You equip the ${item.name}.`, color: '#0f0' });
            } else {
                bus.emit('log', { msg: `You can't equip that.` });
            }
            saveLocalState(localPlayer);
            return true;
        }

        case 'inventory': {
            if (localPlayer.inventory.length === 0) log(`Your pack is empty.`);
            else {
                const eqWep = localPlayer.equipped?.weapon;
                const eqArm = localPlayer.equipped?.armor;
                if (eqWep || eqArm) {
                    const wName = eqWep ? ITEMS[eqWep]?.name || eqWep : 'none';
                    const aName = eqArm ? ITEMS[eqArm]?.name || eqArm : 'none';
                    log(`Equipped: ⚔️ ${wName}  🛡️ ${aName}`, '#0af');
                }
                log(`\nInventory:`, '#ffa500');
                
                const counts = {};
                localPlayer.inventory.forEach(id => counts[id] = (counts[id] || 0) + 1);

                Object.entries(counts).forEach(([id, count]) => {
                    const item = ITEMS[id];
                    if (!item) { log(`  - ${id}${count > 1 ? ' x' + count : ''}`, '#ffa500'); return; }
                    let label = `  - ${item.name}`;
                    if (item.type === 'weapon') label += ` (+${item.bonus} ATK)`;
                    if (item.type === 'armor') label += ` (+${item.bonus} DEF)`;
                    if (item.type === 'consumable') label += ` (+${item.heal} HP)`;
                    if (id === eqWep || id === eqArm) label += ' [EQUIPPED]';
                    if (count > 1) label += ` x${count}`;
                    log(label, '#ffa500');
                });
            }
            return true;
        }

        case 'use': {
            const query = args.slice(1).join(' ').toLowerCase();
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { bus.emit('log', { msg: `You don't have "${query}".` }); return true; }
            const itemId = localPlayer.inventory[idx];
            const item = ITEMS[itemId];
            if (item?.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                const cap = localPlayer.maxHp + bonus.maxHp + (localPlayer.buffs?.rested ? 5 : 0);
                localPlayer.hp = Math.min(cap, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                bus.emit('log', { msg: `You use ${item.name} (+${item.heal} HP).`, color: '#0f0' });
                saveLocalState(localPlayer);
            } else if (item?.type === 'buff') {
                if (!localPlayer.buffs) localPlayer.buffs = { rested: false, activeElixir: null };
                localPlayer.buffs.activeElixir = itemId;
                localPlayer.inventory.splice(idx, 1);
                bus.emit('log', { msg: `You drink ${item.name} (+${item.atkBonus} ATK).`, color: '#fa0' });
                saveLocalState(localPlayer);
            } else bus.emit('log', { msg: `You can't use that.` });
            return true;
        }

        case 'drop': {
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) { log(`Usage: /drop <item name>`); return true; }
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { log(`You don't have that.`); return true; }
            const itemId = localPlayer.inventory[idx];
            localPlayer.inventory.splice(idx, 1);
            if (localPlayer.equipped.weapon === itemId) localPlayer.equipped.weapon = null;
            if (localPlayer.equipped.armor === itemId) localPlayer.equipped.armor = null;
            log(`You dropped the ${ITEMS[itemId]?.name || itemId}.`);
            saveLocalState(localPlayer);
            return true;
        }

        case 'craft': {
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) {
                log(`\n--- CRAFTING RECIPES ---`, '#ffa500');
                RECIPES.forEach(r => {
                    const inputs = Object.entries(r.inputs).map(([id, qty]) => `${qty}x ${ITEMS[id]?.name || id}`).join(', ');
                    log(`${r.name} - Requires: ${inputs}`, '#ffa500');
                });
                log(`------------------------\n`, '#ffa500');
                log(`Usage: /craft <item name>`);
                return true;
            }

            const recipe = RECIPES.find(r => r.name.toLowerCase() === query || r.id === query);
            if (!recipe) { log(`Unknown recipe.`); return true; }

            if (recipe.location && localPlayer.location !== recipe.location) {
                log(`You must be at the ${recipe.location} to craft this.`);
                return true;
            }

            const hasInputs = Object.entries(recipe.inputs).every(([id, qty]) => {
                const count = localPlayer.inventory.filter(iid => iid === id).length;
                return count >= qty;
            });

            if (!hasInputs) { log(`You don't have the required materials.`); return true; }

            Object.entries(recipe.inputs).forEach(([id, qty]) => {
                for (let i = 0; i < qty; i++) {
                    const idx = localPlayer.inventory.indexOf(id);
                    if (idx !== -1) localPlayer.inventory.splice(idx, 1);
                }
            });

            grantItem(recipe.output);
            bus.emit('item:pickup', { item: ITEMS[recipe.output] });
            
            Object.keys(localPlayer.quests).forEach(qid => {
                const q = QUESTS[qid];
                const pq = localPlayer.quests[qid];
                if (!pq.completed && q.type === 'craft' && q.objective.target === recipe.output) {
                    pq.progress = Math.min(q.objective.count, pq.progress + 1);
                    bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
                }
            });

            saveLocalState(localPlayer, true);
            return true;
        }

        case 'trade': {
            const sub = args[1]?.toLowerCase();
            if (!sub) return true;
            
            if (sub === 'offer') {
                if (!pendingTrade) return true;
                const type = args[2]?.toLowerCase();
                const val = args[3];
                if (type === 'gold') {
                    const amt = parseInt(val);
                    if (amt <= localPlayer.gold) pendingTrade.myOffer.gold = amt;
                } else if (type === 'item') {
                    if (localPlayer.inventory.includes(val)) {
                        if (!pendingTrade.myOffer.items.includes(val)) pendingTrade.myOffer.items.push(val);
                    }
                }
                gameActions.sendTradeOffer({ fromName: localPlayer.name, offer: pendingTrade.myOffer }, pendingTrade.partnerId);
                return true;
            }

            if (sub === 'commit') {
                if (!pendingTrade) return true;
                const commit = { gold: pendingTrade.myOffer.gold, items: pendingTrade.myOffer.items, ts: Date.now() };
                signMessage(JSON.stringify(commit), playerKeys.privateKey).then(sig => {
                    pendingTrade.signatures.me = sig;
                    gameActions.sendTradeCommit({ ...commit, signature: sig }, pendingTrade.partnerId);
                });
                return true;
            }

            if (sub === 'cancel') {
                setPendingTrade(null);
                log(`Trade cancelled.`);
                return true;
            }

            const rawArg = args.slice(1).join(' ');
            let partnerId = (players.has(rawArg) && !players.get(rawArg).ghost) ? rawArg : null;
            if (!partnerId) {
                const lower = rawArg.toLowerCase();
                const ids = Array.from(players.keys()).filter(id => !players.get(id).ghost);
                partnerId = ids.find(id => (players.get(id)?.name || '').toLowerCase() === lower)
                         ?? ids.find(id => (players.get(id)?.name || '').toLowerCase().includes(lower));
            }
            const partner = partnerId ? players.get(partnerId) : null;
            if (!partner) { log(`Player not found.`); return true; }
            if (partner.location !== localPlayer.location) { log(`${partner.name} is not here.`); return true; }

            setPendingTrade({
                partnerId,
                partnerName: partner.name || partnerId,
                partnerOffer: { gold: 0, items: [] },
                myOffer: { gold: 0, items: [] },
                ts: Date.now(),
                signatures: { me: null, partner: null }
            });
            log(`[Trade] Initiating trade with ${partner.name}...`, '#ff0');
            gameActions.sendTradeOffer({ fromName: localPlayer.name, offer: { gold: 0, items: [] } }, partnerId);
            bus.emit('trade:initiated', {});
            return true;
        }
    }
    return false;
};
