import { localPlayer, worldState, players } from '../state/store.js';
import { ITEMS, NPCS, QUESTS, ENABLE_ADS } from '../engine/data.js';
import { getNPCDialogue, getTimeOfDay, xpToLevel } from '../rules/index.js';
import { log } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { saveLocalState } from '../state/persistence.js';
import { showRewardedAd } from '../engine/ads.js';
import { getNPCsAt, grantItem, nameColor } from './helpers.js';

export const handleNPCCommands = async (command, args) => {
    switch (command) {
        case 'talk': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const targetId = npcs.find(id => NPCS[id].name.toLowerCase() === query || id === query);
            if (!targetId) { log(`They aren't here.`); return true; }
            
            const npc = NPCS[targetId];
            const dialogue = getNPCDialogue(targetId, worldState.seed, worldState.day, worldState.mood);
            bus.emit('npc:speak', { npcName: npc.name, text: dialogue });

            const availableQuests = Object.values(QUESTS).filter(q => q.giver === targetId && !localPlayer.quests[q.id]);
            availableQuests.forEach(q => {
                if (!q.prerequisite || (localPlayer.quests[q.prerequisite] && localPlayer.quests[q.prerequisite].completed)) {
                    log(`[Quest] ${npc.name}: "I have a task for you: ${q.name}. ${q.description}"`, '#ff0');
                }
            });

            const returnableQuests = Object.values(QUESTS).filter(q => q.receiver === targetId && localPlayer.quests[q.id] && !localPlayer.quests[q.id].completed);
            returnableQuests.forEach(q => {
                const pq = localPlayer.quests[q.id];
                const count = q.objective.count || 0;
                if (pq.progress >= count) {
                    log(`[Quest] ${npc.name}: "I see you have finished your task: ${q.name}. Well done!"`, '#0f0');
                } else {
                    log(`[Quest] ${npc.name}: "How is that task (${q.name}) coming along?"`, '#0ff');
                }
            });

            const courierQ = localPlayer.quests['courier_run'];
            if (courierQ && !courierQ.completed && targetId === 'sage') {
                const aleIdx = localPlayer.inventory.indexOf('ale');
                if (aleIdx !== -1) {
                    localPlayer.inventory.splice(aleIdx, 1);
                    courierQ.progress = 1;
                    bus.emit('quest:progress', { name: 'Courier Run', current: 1, total: 1 });
                    log(`[Quest] You deliver the ale to the Sage. They nod gratefully.`, '#ff0');
                }
            }
            return true;
        }

        case 'buy': {
            if (getTimeOfDay() === 'night') {
                log(`[System] The Market is closed for the night. Return at dawn.`, '#555');
                return true;
            }
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpc = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpc) { log(`There is no shop here.`); return true; }

            const npc = NPCS[shopNpc];
            if (!query) {
                log(`\n--- ${npc.name}'s Shop ---`, '#ffa500');
                npc.shop.forEach(id => {
                    const item = ITEMS[id];
                    log(`${item.name} - ${item.price} Gold`, '#ffa500');
                });
                log(`------------------------\n`, '#ffa500');
                log(`Usage: /buy <item name>`);
                return true;
            }

            const itemId = npc.shop.find(id => ITEMS[id].name.toLowerCase() === query || id === query);
            if (!itemId) { log(`They don't sell that.`); return true; }
            
            const item = ITEMS[itemId];
            if (localPlayer.gold < item.price) { log(`You can't afford that!`); return true; }
            
            localPlayer.gold -= item.price;
            grantItem(itemId);
            bus.emit('item:pickup', { item });
            saveLocalState(localPlayer, true);
            return true;
        }

        case 'sell': {
            if (getTimeOfDay() === 'night') {
                log(`[System] The Market is closed for the night. Return at dawn.`, '#555');
                return true;
            }
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpcId = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpcId) { log(`There is no shop here.`); return true; }

            if (!query) { log(`Usage: /sell <item name>`); return true; }

            const invIdx = localPlayer.inventory.findIndex(id => (ITEMS[id]?.name || id).toLowerCase() === query || id === query);
            if (invIdx === -1) { log(`You don't have that.`); return true; }

            const itemId = localPlayer.inventory[invIdx];
            const item = ITEMS[itemId];
            if (!item || item.type === 'gold' || item.price === 0) { log(`They aren't interested in that.`); return true; }

            const sellPrice = Math.floor(item.price * 0.4);
            localPlayer.gold += sellPrice;
            localPlayer.inventory.splice(invIdx, 1);
            bus.emit('log', { msg: `[System] You sold ${item.name} for ${sellPrice} Gold.`, color: '#ff0' });

            Object.keys(localPlayer.quests).forEach(qid => {
                const q = QUESTS[qid];
                const pq = localPlayer.quests[qid];
                if (q && !pq.completed && q.type === 'deliver' && q.objective.target === shopNpcId) {
                    pq.progress = Math.min(q.objective.count, (pq.progress || 0) + 1);
                    bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
                }
            });

            saveLocalState(localPlayer, true);
            return true;
        }

        case 'quest': {
            const sub = args[1]?.toLowerCase();
            const id = args[2]?.toLowerCase();

            if (!sub || sub === 'list') {
                const chains = {};
                Object.values(QUESTS).forEach(q => {
                    const chain = q.chain || 'misc';
                    if (!chains[chain]) chains[chain] = [];
                    chains[chain].push(q);
                });
                log(`\n--- QUEST LOG ---`, '#ff0');
                Object.entries(chains).forEach(([chain, qs]) => {
                    log(`[ ${chain.toUpperCase()} ]`, '#fa0');
                    qs.forEach(q => {
                        const pq = localPlayer.quests[q.id];
                        const prereqDone = !q.prerequisite || localPlayer.quests[q.prerequisite]?.completed;
                        if (!prereqDone && !pq) {
                            log(`  ??? (locked)`, '#555');
                        } else if (!pq) {
                            log(`  ${q.name} — available`, '#aaa');
                        } else if (pq.completed) {
                            log(`  ${q.name} ✅`, '#0f0');
                        } else {
                            const count = q.objective?.count || 1;
                            log(`  ${q.name}: ${pq.progress}/${count}`, '#ff0');
                        }
                    });
                });
                return true;
            }

            if (sub === 'accept') {
                if (!id || !QUESTS[id]) return true;
                const q = QUESTS[id];
                const npcs = getNPCsAt(localPlayer.location);
                if (!npcs.includes(q.giver)) { log(`Nobody here can give you that quest.`); return true; }
                
                if (localPlayer.quests[id]) { log(`You already have that quest.`); return true; }
                localPlayer.quests[id] = { progress: 0, completed: false };
                bus.emit('log', { msg: `[Quest] Accepted: ${q.name}`, color: '#ff0' });
                saveLocalState(localPlayer);
                return true;
            }

            if (sub === 'complete') {
                if (!id || !localPlayer.quests[id]) { log(`You don't have that quest.`); return true; }
                const q = QUESTS[id];
                if (localPlayer.quests[id].completed) { log(`Already completed.`); return true; }
                
                if (localPlayer.quests[id].progress < (q.objective.count || 0)) { log(`Quest not finished yet.`); return true; }
                
                const npcs = getNPCsAt(localPlayer.location);
                if (q.receiver !== null && !npcs.includes(q.receiver)) { log(`Return to the receiver to complete this.`); return true; }

                localPlayer.quests[id].completed = true;
                localPlayer.xp += q.reward.xp;
                localPlayer.gold += q.reward.gold;
                if (q.reward.item) grantItem(q.reward.item);
                
                const newLevel = xpToLevel(localPlayer.xp);
                bus.emit('quest:complete', { name: q.name, rewards: q.reward });
                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    bus.emit('player:levelup', { level: localPlayer.level });
                }

                saveLocalState(localPlayer, true);
                return true;
            }
            return true;
        }

        case 'bank': {
            if (localPlayer.location !== 'cellar') { log(`You can only bank at your home (the cellar).`); return true; }
            const sub = args[1]?.toLowerCase();
            const amount = parseInt(args[2]);

            if (sub === 'deposit') {
                if (isNaN(amount) || amount <= 0) return true;
                if (localPlayer.gold < amount) { log(`You don't have that much gold on you.`); return true; }
                localPlayer.gold -= amount;
                localPlayer.bankedGold += amount;
                log(`[Bank] Deposited ${amount} Gold.`);
                saveLocalState(localPlayer);
            } else if (sub === 'withdraw') {
                if (isNaN(amount) || amount <= 0) return true;
                if (localPlayer.bankedGold < amount) { log(`You don't have that much in the bank.`); return true; }
                localPlayer.bankedGold -= amount;
                localPlayer.gold += amount;
                log(`[Bank] Withdrew ${amount} Gold.`);
                saveLocalState(localPlayer);
            } else {
                log(`\n--- THE CELLAR BANK ---`, '#ffa500');
                log(`Your Wallet: ${localPlayer.gold} Gold`);
                log(`Bank Balance: ${localPlayer.bankedGold} Gold`);
            }
            return true;
        }

        case 'vision': {
            if (localPlayer.location !== 'tavern') { log(`Strange visions only appear in the haze of the Tavern.`); return true; }
            if ((localPlayer.forestFights ?? 15) > 0) { log(`You don't feel the pull of visions yet — you still have energy to burn.`); return true; }
            if (ENABLE_ADS) {
                showRewardedAd(() => {
                    localPlayer.forestFights += 5;
                    log(`[Vision] You feel a surge of energy! (+5 Daily Fights)`, '#0f0');
                    saveLocalState(localPlayer);
                }, (err) => {
                    log(`[System] ${err}`, '#f55');
                });
            } else {
                localPlayer.forestFights += 3;
                log(`[Vision] The ale and firelight blur into a waking dream... You feel restored. (+3 Daily Fights)`, '#f0f');
                saveLocalState(localPlayer);
            }
            return true;
        }
    }
    return false;
};
