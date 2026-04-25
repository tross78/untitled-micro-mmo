import { selfId } from '@trystero-p2p/torrent';
import { 
    worldState, players, localPlayer, pendingDuel, setPendingDuel, 
    activeChannels, STORAGE_KEY, hasSyncedWithArbiter 
} from './store.js';
import { log, printStatus, triggerShake } from './ui.js';
import { 
    world, ENEMIES, ITEMS, DEFAULT_PLAYER_STATS, GAME_NAME,
    NPCS, QUESTS, ENABLE_ADS
} from './data.js';
import { 
    hashStr, seededRNG, levelBonus, resolveAttack, 
    rollLoot, xpToLevel, validateMove, getShardName,
    getNPCLocation, getNPCDialogue
} from './rules.js';
import { signMessage, verifyMessage, importKey } from './crypto.js';
import { 
    gameActions, joinInstance, globalRooms, rooms, 
    currentInstance, currentRtcConfig 
} from './networking.js';
import { playerKeys, arbiterPublicKey } from './identity.js';
import { showRewardedAd } from './ads.js';

export const pidHash = (playerId) => playerId ? (hashStr(playerId) >>> 0).toString(16).padStart(8, '0') : null;
export const getTag = (ph) => ph ? ph.slice(0, 4) : '????';
export const getPlayerEntry = (id) => players.get(id);

export const getPlayerName = (id) => {
    const entry = players.get(id);
    if (!entry) return `Peer-${id.slice(0, 4)}`;
    const name = entry.name || `Peer-${id.slice(0, 4)}`;
    const tag = entry.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};

const getNPCsAt = (location) => {
    return Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === location);
};

export const saveLocalState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlayer));
};

export async function handleCommand(cmd) {
    const args = cmd.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case 'who': {
            log(`\n--- PLAYERS NEARBY ---`, '#aaa');
            players.forEach((p, id) => {
                log(`${getPlayerName(id)} (Level ${p.level})`, '#aaa');
            });
            if (players.size === 0) log(`You are alone here.`, '#555');
            log(`----------------------\n`, '#aaa');
            break;
        }

        case 'net': {
            const gPeers = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
            const sPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
            const shardName = getShardName(localPlayer.location, currentInstance);
            log(`\n--- NETWORK STATUS ---`, '#0af');
            log(`Global Room: global (${gPeers} peers)`);
            log(`Shard Room: ${shardName} (${sPeers} peers)`);
            log(`Arbiter Sync: ${hasSyncedWithArbiter ? 'YES' : 'NO'}`);
            log(`Identity: ${localPlayer.name}#${getTag(localPlayer.ph)}`);
            log(`----------------------\n`, '#0af');
            break;
        }

        case 'help':
            log('--- Movement: /look, /move <dir>, /map', '#ffa500');
            log('--- Combat:   /attack, /rest, /stats, /inventory, /use <item>', '#ffa500');
            log('--- Social:   /who, /talk <npc>, /wave, /bow, /cheer, /duel <name>, /accept, /decline', '#ffa500');
            log('--- NPC/Shop: /buy <item>, /sell <item>, /quest, /bank', '#ffa500');
            log('--- World:    /status, /rename <name>, /net, /clear', '#ffa500');
            break;

        case 'duel': {
            const targetName = args.slice(1).join(' ').toLowerCase();
            if (!targetName) { log(`Usage: /duel <name>`); break; }
            const ids = Array.from(players.keys());
            const targetId = ids.find(id => getPlayerName(id).toLowerCase() === targetName)
                          ?? ids.find(id => getPlayerName(id).toLowerCase().includes(targetName));
            if (!targetId) { log(`Player not found.`); break; }
            log(`[DUEL] Challenging ${getPlayerName(targetId)}...`, '#ff0');
            gameActions.sendDuelChallenge({ target: targetId, fromName: localPlayer.name });
            break;
        }

        case 'accept': {
            if (!pendingDuel || Date.now() > pendingDuel.expiresAt) { log(`No pending challenge.`); break; }
            log(`[DUEL] Accepting challenge from ${pendingDuel.challengerName}...`, '#0f0');
            gameActions.sendDuelAccept({ target: pendingDuel.challengerId, fromName: localPlayer.name });
            startStateChannel(pendingDuel.challengerId, pendingDuel.challengerName, pendingDuel.day);
            setPendingDuel(null);
            break;
        }

        case 'decline': {
            log(`[DUEL] Challenge declined.`);
            setPendingDuel(null);
            break;
        }

        case 'look': {
            const loc = world[localPlayer.location];
            log(`\n${loc.name}`);
            log(loc.description);
            if (loc.enemy && localPlayer.currentEnemy) {
                log(`A wounded ${ENEMIES[loc.enemy].name} is here! (HP: ${localPlayer.currentEnemy.hp})`, '#f55');
            } else if (loc.enemy) {
                log(`A ${ENEMIES[loc.enemy].name} lurks here. Type /attack to engage.`, '#f55');
            }
            const npcs = getNPCsAt(localPlayer.location);
            if (npcs.length > 0) log(`NPCs here: ${npcs.map(id => NPCS[id].name).join(', ')}`, '#0ff');
            const here = Array.from(players.keys()).filter(id => players.get(id).location === localPlayer.location);
            if (here.length > 0) log(`Also here: ${here.map(getPlayerName).join(', ')}`, '#aaa');
            const exits = Object.keys(loc.exits).join(', ');
            log(`Exits: ${exits}`, '#555');
            break;
        }

        case 'status':
            printStatus();
            break;

        case 'score': {
            const list = Array.from(players.values());
            list.push({ name: localPlayer.name, level: localPlayer.level, xp: localPlayer.xp, ph: localPlayer.ph });
            list.sort((a, b) => b.level - a.level || b.xp - a.xp);
            log(`\n--- TOP ADVENTURERS ---`, '#ffa500');
            list.slice(0, 10).forEach((p, i) => {
                log(`${i + 1}. ${p.name}#${getTag(p.ph)} - Level ${p.level} (${p.xp} XP)`, '#ffa500');
            });
            log(`-----------------------\n`, '#ffa500');
            break;
        }

        case 'stats': {
            const bonus = levelBonus(localPlayer.level);
            const maxHp = localPlayer.maxHp + bonus.maxHp;
            const hpPct = localPlayer.hp / maxHp;
            const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
            const xpForLevel = (l) => (l - 1) ** 2 * 10;
            const xpNeeded = xpForLevel(localPlayer.level + 1) - localPlayer.xp;
            log(`\n--- ${localPlayer.name.toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp} (${xpNeeded} to next level) ✨`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${maxHp} ❤️`, hpColor);
            log(`Attack: ${localPlayer.attack + bonus.attack} ⚔️  Defense: ${localPlayer.defense + bonus.defense} 🛡️`, '#ffa500');
            log(`Gold: ${localPlayer.gold} 💰  Bank: ${localPlayer.bankedGold} 🏦`, '#ffa500');
            log(`Daily Fights Remaining: ${localPlayer.forestFights} ⚡`, '#0af');
            break;
        }

        case 'inventory': {
            if (localPlayer.inventory.length === 0) log(`Your pack is empty.`);
            else {
                log(`\nInventory:`, '#ffa500');
                localPlayer.inventory.forEach(id => log(`  - ${ITEMS[id]?.name || id}`, '#ffa500'));
            }
            break;
        }

        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { log(`There is nothing to fight here.`); break; }
            if (localPlayer.forestFights <= 0 && !localPlayer.currentEnemy) {
                log(`You are too exhausted to look for more trouble today. Come back tomorrow!`, '#aaa');
                if (ENABLE_ADS) log(`[Hint] Perhaps the Bard in the Tavern can grant you a /vision to restore your energy?`, '#0af');
                break;
            }

            const enemyDef = ENEMIES[loc.enemy];
            if (!localPlayer.currentEnemy) {
                localPlayer.forestFights--;
                localPlayer.currentEnemy = { type: loc.enemy, hp: enemyDef.hp };
                log(`\nA ${enemyDef.name} snarls and lunges!`, '#f55');
            }
            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound);
            localPlayer.combatRound++;
            const rng = seededRNG(combatSeed);
            const bonus = levelBonus(localPlayer.level);
            const playerDmg = resolveAttack(localPlayer.attack + bonus.attack, enemyDef.defense, rng);
            const enemyDmg = resolveAttack(enemyDef.attack, localPlayer.defense + bonus.defense, rng);
            localPlayer.currentEnemy.hp -= playerDmg;
            localPlayer.hp -= enemyDmg;
            if (enemyDmg > 0) triggerShake();
            log(`You hit the ${enemyDef.name} for ${playerDmg}. (Enemy HP: ${Math.max(0, localPlayer.currentEnemy.hp)}/${enemyDef.hp})`, '#0f0');
            log(`The ${enemyDef.name} hits you for ${enemyDmg}. (Your HP: ${Math.max(0, localPlayer.hp)}/${localPlayer.maxHp + bonus.maxHp})`, '#f55');

            if (localPlayer.currentEnemy.hp <= 0) {
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                const newLevel = xpToLevel(localPlayer.xp);
                loot.forEach(itemId => {
                    if (ITEMS[itemId]?.type === 'gold') localPlayer.gold += ITEMS[itemId].amount;
                    else localPlayer.inventory.push(itemId);
                });
                log(`\nYou defeated the ${enemyDef.name}! (+${enemyDef.xp} XP)`, '#ff0');
                if (loot.length > 0) log(`Loot: ${loot.map(i => ITEMS[i]?.name || i).join(', ')}`, '#ff0');
                
                // Quest Progress
                Object.keys(localPlayer.quests).forEach(qid => {
                    const q = QUESTS[qid];
                    const pq = localPlayer.quests[qid];
                    if (!pq.completed && q.target === loc.enemy) {
                        pq.progress = Math.min(q.count, pq.progress + 1);
                        log(`[Quest] ${q.name} progress: ${pq.progress}/${q.count}`, '#ff0');
                    }
                });

                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    log(`LEVEL UP! You are now level ${localPlayer.level}! ✨`, '#ff0');
                    saveLocalState(true);
                }

                localPlayer.currentEnemy = null;
            }
            if (localPlayer.hp <= 0) {
                log(`\nYou have been slain! 💀`, '#f00');
                triggerShake();
                localPlayer.hp = Math.floor((localPlayer.maxHp + levelBonus(localPlayer.level).maxHp) / 2);
                const deathLoc = localPlayer.location;
                localPlayer.location = 'cellar';
                localPlayer.currentEnemy = null;
                log(`You wake in the cellar...`, '#aaa');
                gameActions.sendMove({ from: deathLoc, to: 'cellar' });
                await joinInstance('cellar', currentInstance, currentRtcConfig);
                handleCommand('look');
                saveLocalState(true);
            } else {
                saveLocalState();
            }
            break;
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { log(`You can't rest mid-combat!`); break; }
            const bonus = levelBonus(localPlayer.level);
            const cap = localPlayer.maxHp + bonus.maxHp;
            const healed = Math.min(10, cap - localPlayer.hp);
            localPlayer.hp += healed;
            log(`You rest and recover ${healed} HP. (HP: ${localPlayer.hp}/${cap})`, '#0f0');
            saveLocalState();
            break;
        }

        case 'use': {
            const query = args.slice(1).join(' ').toLowerCase();
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { log(`You don't have "${query}".`); break; }
            const item = ITEMS[localPlayer.inventory[idx]];
            if (item?.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                localPlayer.hp = Math.min(localPlayer.maxHp + bonus.maxHp, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                log(`You use the ${item.name} and recover ${item.heal} HP.`, '#0f0');
                saveLocalState();
            } else log(`You can't use that.`);
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { log(`Usage: /rename <name>`); break; }
            localPlayer.name = newName;
            saveLocalState();
            log(`[System] You are now known as ${newName}`);
            break;
        }

        case 'move': {
            const dir = args[1];
            const nextLoc = validateMove(localPlayer.location, dir);
            if (nextLoc) {
                if (localPlayer.currentEnemy) { log(`You can't flee!`); break; }
                const prevLoc = localPlayer.location;
                localPlayer.location = nextLoc;
                saveLocalState();
                log(`You move ${dir}.`);
                handleCommand('look');
                gameActions.sendMove({ from: prevLoc, to: nextLoc });
                await joinInstance(nextLoc, currentInstance, currentRtcConfig);
            } else log(`You can't go that way.`);
            break;
        }

        case 'map': {
            const loc = localPlayer.location;
            const m = (id) => (loc === id ? '[YOU]' : ' [ ] ');
            log(`\n--- WORLD MAP ---`, '#aaa');
            log(`      ${m('tavern')}--${m('market')}`, '#aaa');
            log(`         |`, '#aaa');
            log(`      ${m('hallway')}--${m('forest_edge')}--${m('ruins')}`, '#aaa');
            log(`         |          |`, '#aaa');
            log(`      ${m('cellar')}     ${m('cave')}`, '#aaa');
            log(`-----------------\n`, '#aaa');
            break;
        }

        case 'bank': {
            if (localPlayer.location !== 'cellar') { log(`You can only bank at your home (the cellar).`); break; }
            const sub = args[1]?.toLowerCase();
            const amount = parseInt(args[2]);

            if (sub === 'deposit') {
                if (isNaN(amount) || amount <= 0) { log(`Usage: /bank deposit <amount>`); break; }
                if (localPlayer.gold < amount) { log(`You don't have that much gold on you.`); break; }
                localPlayer.gold -= amount;
                localPlayer.bankedGold += amount;
                log(`[Bank] Deposited ${amount} Gold. (Balance: ${localPlayer.bankedGold})`, '#ff0');
                saveLocalState();
            } else if (sub === 'withdraw') {
                if (isNaN(amount) || amount <= 0) { log(`Usage: /bank withdraw <amount>`); break; }
                if (localPlayer.bankedGold < amount) { log(`You don't have that much in the bank.`); break; }
                localPlayer.bankedGold -= amount;
                localPlayer.gold += amount;
                log(`[Bank] Withdrew ${amount} Gold. (Wallet: ${localPlayer.gold})`, '#ff0');
                saveLocalState();
            } else {
                log(`\n--- THE CELLAR BANK ---`, '#ffa500');
                log(`Your Wallet: ${localPlayer.gold} Gold`);
                log(`Bank Balance: ${localPlayer.bankedGold} Gold`);
                log(`Usage: /bank deposit <amt> | /bank withdraw <amt>`, '#aaa');
            }
            break;
        }

        case 'clear': {
            const output = document.getElementById('output');
            if (output) output.innerHTML = '';
            break;
        }

        case 'wave':
        case 'bow':
        case 'cheer': {
            const emoteText = command === 'wave' ? 'waves hello.' : command === 'bow' ? 'bows respectfully.' : 'cheers loudly!';
            gameActions.sendEmote({ room: localPlayer.location, text: emoteText });
            log(`[Social] You ${emoteText}`);
            break;
        }

        case 'vision': {
            if (!ENABLE_ADS) { log(`The world is currently free of strange visions.`); break; }
            if (localPlayer.location !== 'tavern') { log(`Strange visions only appear in the haze of the Tavern.`); break; }
            
            showRewardedAd(() => {
                localPlayer.forestFights += 5;
                log(`[Reward] You feel a surge of energy! (+5 Daily Fights)`, '#0f0');
                saveLocalState();
            }, (err) => {
                log(`[System] ${err}`, '#f55');
            });
            break;
        }

        case 'talk': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const targetId = npcs.find(id => NPCS[id].name.toLowerCase() === query || id === query);
            if (!targetId) { log(`They aren't here.`); break; }
            
            const npc = NPCS[targetId];
            const dialogue = getNPCDialogue(targetId, worldState.seed, worldState.day, worldState.mood);
            log(`\n[Talk] ${npc.name}: "${dialogue}"`, '#0ff');

            if (npc.role === 'shop') {
                log(`[System] Type /buy to see what's for sale.`, '#aaa');
            } else if (npc.role === 'quest' && npc.questId) {
                const q = QUESTS[npc.questId];
                const playerQuest = localPlayer.quests[npc.questId];
                if (!playerQuest) {
                    log(`[Quest] ${npc.name}: "I have a task for you. ${q.description}"`, '#ff0');
                    log(`[System] Type /quest accept ${npc.questId} to take this task.`, '#aaa');
                } else if (playerQuest.completed) {
                    log(`[Quest] ${npc.name}: "Thank you for your help earlier."`, '#0ff');
                } else {
                    log(`[Quest] ${npc.name}: "How is that task coming along?"`, '#0ff');
                }
            }
            break;
        }

        case 'buy': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpc = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpc) { log(`There is no shop here.`); break; }

            const npc = NPCS[shopNpc];
            if (!query) {
                log(`\n--- ${npc.name}'s Shop ---`, '#ffa500');
                npc.shop.forEach(id => {
                    const item = ITEMS[id];
                    log(`${item.name} - ${item.price} Gold`, '#ffa500');
                });
                log(`------------------------\n`, '#ffa500');
                log(`Usage: /buy <item name>`);
                break;
            }

            const itemId = npc.shop.find(id => ITEMS[id].name.toLowerCase() === query || id === query);
            if (!itemId) { log(`They don't sell that.`); break; }
            
            const item = ITEMS[itemId];
            if (localPlayer.gold < item.price) { log(`You can't afford that!`); break; }
            
            localPlayer.gold -= item.price;
            localPlayer.inventory.push(itemId);
            log(`[System] You bought ${item.name} for ${item.price} Gold.`, '#ff0');
            saveLocalState(true);
            break;
        }

        case 'sell': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpc = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpc) { log(`There is no shop here.`); break; }

            if (!query) { log(`Usage: /sell <item name>`); break; }

            const invIdx = localPlayer.inventory.findIndex(id => ITEMS[id].name.toLowerCase() === query || id === query);
            if (invIdx === -1) { log(`You don't have that.`); break; }

            const itemId = localPlayer.inventory[invIdx];
            const item = ITEMS[itemId];
            if (item.price === 0) { log(`They aren't interested in that.`); break; }

            const sellPrice = Math.floor(item.price * 0.5);
            localPlayer.gold += sellPrice;
            localPlayer.inventory.splice(invIdx, 1);
            log(`[System] You sold ${item.name} for ${sellPrice} Gold.`, '#ff0');
            saveLocalState(true);
            break;
        }

        case 'quest': {
            const sub = args[1]?.toLowerCase();
            const id = args[2]?.toLowerCase();

            if (!sub || sub === 'list') {
                const active = Object.entries(localPlayer.quests).filter(([, q]) => !q.completed);
                if (active.length === 0) { log(`You have no active quests.`); break; }
                log(`\n--- ACTIVE QUESTS ---`, '#ff0');
                active.forEach(([qid, data]) => {
                    const q = QUESTS[qid];
                    log(`${q.name}: ${data.progress}/${q.count}`, '#ff0');
                });
                break;
            }

            if (sub === 'accept') {
                if (!id || !QUESTS[id]) { log(`Usage: /quest accept <quest_id>`); break; }
                const npcs = getNPCsAt(localPlayer.location);
                const questGiver = npcs.find(nid => NPCS[nid].questId === id);
                if (!questGiver) { log(`Nobody here can give you that quest.`); break; }
                
                if (localPlayer.quests[id]) { log(`You already have that quest.`); break; }
                localPlayer.quests[id] = { progress: 0, completed: false };
                log(`[Quest] Accepted: ${QUESTS[id].name}`, '#ff0');
                saveLocalState();
                break;
            }

            if (sub === 'complete') {
                if (!id || !localPlayer.quests[id]) { log(`You don't have that quest.`); break; }
                if (localPlayer.quests[id].completed) { log(`Already completed.`); break; }
                
                const q = QUESTS[id];
                if (localPlayer.quests[id].progress < q.count) { log(`Quest not finished yet.`); break; }
                
                const npcs = getNPCsAt(localPlayer.location);
                const questGiver = npcs.find(nid => NPCS[nid].questId === id);
                if (!questGiver) { log(`Return to the quest giver to complete this.`); break; }

                localPlayer.quests[id].completed = true;
                localPlayer.xp += q.reward.xp;
                localPlayer.gold += q.reward.gold;
                const newLevel = xpToLevel(localPlayer.xp);
                log(`\n[Quest] COMPLETED: ${q.name}!`, '#0f0');
                log(`[Quest] Reward: ${q.reward.xp} XP, ${q.reward.gold} Gold`, '#ff0');
                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    log(`LEVEL UP! You are now level ${localPlayer.level}! ✨`, '#ff0');
                    saveLocalState(true);
                }

                saveLocalState();
                break;
            }
            break;
        }

        default:
            log(`Unknown command: ${command}. Type /help.`);
    }
}

export async function startStateChannel(targetId, targetName, day) {
    const timeoutId = setTimeout(() => {
        if (activeChannels.has(targetId)) {
            log(`[DUEL] Combat with ${targetName} timed out.`, '#555');
            activeChannels.delete(targetId);
        }
    }, 30000);
    activeChannels.set(targetId, {
        opponentName: targetName,
        day,
        round: 0,
        myHistory: [],
        theirHistory: [],
        timeoutId,
    });
    await resolveRound(targetId);
}

export async function resolveRound(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    // If they are ahead, we need to catch up. 
    // If we are ahead or equal, we only proceed if we haven't reached the cap.
    if (chan.myHistory.length >= chan.theirHistory.length && chan.round >= 3) return;

    chan.round++;
    const seed = hashStr(selfId + targetId + chan.day + chan.round);
    const rng = seededRNG(seed);
    
    const myBonus = levelBonus(localPlayer.level);
    const myAtk = localPlayer.attack + myBonus.attack;
    
    const opponent = getPlayerEntry(targetId);
    const opBonus = levelBonus(opponent?.level || 1);
    const opDef = (opponent?.defense ?? DEFAULT_PLAYER_STATS.defense) + opBonus.defense;

    const dmg = resolveAttack(myAtk, opDef, rng);

    const commit = { round: chan.round, dmg, day: chan.day };
    const signature = await signMessage(JSON.stringify(commit), playerKeys.privateKey);
    chan.myHistory.push(commit);
    
    gameActions.sendDuelCommit({ commit, signature }, targetId);

    if (chan.round >= 3) {
        let totalMyDmg = chan.myHistory.reduce((a, b) => a + b.dmg, 0);
        let totalTheirDmg = chan.theirHistory.reduce((a, b) => a + b.dmg, 0);
        
        log(`\n--- DUEL RESULT vs ${chan.opponentName} ---`, '#ff0');
        log(`You dealt: ${totalMyDmg} | Opponent dealt: ${totalTheirDmg}`, '#aaa');
        
        if (totalMyDmg > totalTheirDmg) {
            log(`You WIN! (+10 XP)`, '#0f0');
            localPlayer.xp += 10;
        } else if (totalMyDmg < totalTheirDmg) {
            log(`You LOSE.`, '#f55');
        } else {
            log(`It's a DRAW.`, '#aaa');
        }
        clearTimeout(chan.timeoutId);
        activeChannels.delete(targetId);
        saveLocalState();
    }
}
