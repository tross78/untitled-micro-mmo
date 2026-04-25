import { selfId } from '@trystero-p2p/torrent';
import {
    worldState, players, localPlayer, pendingDuel, setPendingDuel,
    activeChannels, hasSyncedWithArbiter, pendingTrade, setPendingTrade, shardEnemies
} from './store.js';

import { log, printStatus, triggerShake, getHealthBar } from './ui.js';
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

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nameColor = (name, color) => `<span style="color:${color || '#fff'}">${escapeHtml(name)}</span>`;

export const getTag = (ph) => ph ? ph.slice(0, 4) : '????';
export const getPlayerEntry = (id) => players.get(id);

export const getPlayerName = (id) => {
    const entry = players.get(id);
    if (!entry) return `Peer-${escapeHtml(id.slice(0, 4))}`;
    const name = escapeHtml(entry.name || `Peer-${id.slice(0, 4)}`);
    const tag = entry.ph ? getTag(entry.ph) : null;
    return tag ? `${name}#${tag}` : name;
};

const getNPCsAt = (location) => {
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
    return { weaponBonus, defenseBonus };
};

// --- DEV TOOLS ---
if (typeof window !== 'undefined') {
    window.devReset = () => {
        localStorage.clear();
        window.location.reload();
    };
}

export async function handleCommand(cmd) {
    const raw = cmd.trim();
    if (!raw) return;
    
    // Support both "/move north" and "move north"
    const cleanCmd = raw.startsWith('/') ? raw.slice(1) : raw;
    const args = cleanCmd.split(/\s+/);
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
            if (!targetName) break;
            const ids = Array.from(players.keys());
            const getNameOnly = (id) => (getPlayerEntry(id)?.name || '').toLowerCase();
            const targetId = ids.find(id => getNameOnly(id) === targetName)
                          ?? ids.find(id => getNameOnly(id).includes(targetName));
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
            
            const sharedEnemy = shardEnemies.get(localPlayer.location);
            if (loc.enemy && sharedEnemy && sharedEnemy.hp > 0) {
                const enemyDef = ENEMIES[loc.enemy];
                const eName = nameColor(enemyDef.name, enemyDef.color);
                const bar = getHealthBar(sharedEnemy.hp, sharedEnemy.maxHp);
                log(`A wounded ${eName} is here! ${bar} (${sharedEnemy.hp} HP)`, '#f55');
            } else if (loc.enemy) {
                const enemyDef = ENEMIES[loc.enemy];
                log(`A ${nameColor(enemyDef.name, enemyDef.color)} lurks here.`, '#f55');
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
                const name = escapeHtml(p.name || `Peer-${getTag(p.ph)}`);
                log(`${i + 1}. ${name}#${getTag(p.ph)} - Level ${p.level} (${p.xp} XP)`, '#ffa500');
            });
            log(`-----------------------\n`, '#ffa500');
            break;
        }

        case 'stats': {
            const bonus = levelBonus(localPlayer.level);
            const gear = getBestGear();
            const maxHp = localPlayer.maxHp + bonus.maxHp;
            const hpPct = localPlayer.hp / maxHp;
            const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
            const xpForLevel = (l) => (l - 1) ** 2 * 10;
            const xpNeeded = xpForLevel(localPlayer.level + 1) - localPlayer.xp;
            log(`\n--- ${escapeHtml(localPlayer.name).toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp} (${xpNeeded} to next level) ✨`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${maxHp} ❤️`, hpColor);
            log(`Attack: ${localPlayer.attack + bonus.attack + gear.weaponBonus} ⚔️  Defense: ${localPlayer.defense + bonus.defense + gear.defenseBonus} 🛡️`, '#ffa500');
            log(`Gold: ${localPlayer.gold} 💰  Bank: ${localPlayer.bankedGold} 🏦`, '#ffa500');
            log(`Daily Fights Remaining: ${localPlayer.forestFights} ⚡`, '#0af');
            break;
        }

        case 'inventory': {
            if (localPlayer.inventory.length === 0) log(`Your pack is empty.`);
            else {
                log(`\nInventory:`, '#ffa500');
                const gear = getBestGear();
                localPlayer.inventory.forEach(id => {
                    const item = ITEMS[id];
                    if (!item) { log(`  - ${id}`, '#ffa500'); return; }
                    let label = `  - ${item.name}`;
                    if (item.type === 'weapon') {
                        label += ` (+${item.bonus} ATK)`;
                        if (item.bonus === gear.weaponBonus) label += ' [EQUIPPED]';
                    }
                    if (item.type === 'consumable') label += ` (+${item.heal} HP)`;
                    log(label, '#ffa500');
                });
            }
            break;
        }

        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { log(`There is nothing to fight here.`); break; }
            
            let sharedEnemy = shardEnemies.get(localPlayer.location);
            const enemyDef = ENEMIES[loc.enemy];
            // Threat Scaling
            const scale = 1 + (worldState.threatLevel * 0.1);
            const scaledHP = Math.floor(enemyDef.hp * scale);
            const scaledAtk = Math.floor(enemyDef.attack * scale);
            const scaledDef = Math.floor(enemyDef.defense * scale);

            if (!sharedEnemy || sharedEnemy.hp <= 0) {
                if (localPlayer.forestFights <= 0) {
                    log(`You are too exhausted to look for more trouble today. Come back tomorrow!`, '#aaa');
                    break;
                }
                localPlayer.forestFights--;
                sharedEnemy = { type: loc.enemy, hp: scaledHP, maxHp: scaledHP };
                shardEnemies.set(localPlayer.location, sharedEnemy);
                log(`\nA ${nameColor(enemyDef.name, enemyDef.color)} snarls and lunges!`, '#f55');
            }

            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound);
            localPlayer.combatRound++;
            const rng = seededRNG(combatSeed);
            const bonus = levelBonus(localPlayer.level);
            const gear = getBestGear();
            const elixirBonus = (localPlayer.buffs?.activeElixir === 'strength_elixir') ? 5 : 0;

            const playerRes = resolveAttack(localPlayer.attack + bonus.attack + gear.weaponBonus + elixirBonus, scaledDef, rng);
            const enemyRes = resolveAttack(scaledAtk, localPlayer.defense + bonus.defense + gear.defenseBonus, rng);

            const eName = nameColor(enemyDef.name, enemyDef.color);

            // Player Attack
            if (playerRes.isDodge) {
                log(`${eName} dodged your attack!`, '#aaa');
            } else {
                let msg = `You hit ${eName} for ${playerRes.damage}.`;
                if (playerRes.isCrit) msg = `<b>CRITICAL HIT!</b> ` + msg;
                sharedEnemy.hp -= playerRes.damage;
                gameActions.sendMonsterDmg({ roomId: localPlayer.location, damage: playerRes.damage });
                const eBar = getHealthBar(Math.max(0, sharedEnemy.hp), sharedEnemy.maxHp);
                log(`${msg} ${eBar}`, '#0f0');
            }

            // Enemy Attack
            if (sharedEnemy.hp > 0) {
                if (enemyRes.isDodge) {
                    log(`You dodged ${eName}'s attack!`, '#0af');
                } else {
                    let msg = `${eName} hits you for ${enemyRes.damage}.`;
                    if (enemyRes.isCrit) msg = `<b>CRITICAL!</b> ` + msg;
                    localPlayer.hp -= enemyRes.damage;
                    if (enemyRes.damage > 0) triggerShake();
                    const maxHp = localPlayer.maxHp + bonus.maxHp + (localPlayer.buffs?.rested ? 5 : 0);
                    const pBar = getHealthBar(Math.max(0, localPlayer.hp), maxHp);
                    log(`${msg} ${pBar}`, '#f55');
                }
            }

            if (sharedEnemy.hp <= 0) {
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                localPlayer.combatRound = 0; // Reset per fight so seeds stay bounded
                const newLevel = xpToLevel(localPlayer.xp);

                // Security: Broadcast Action Log
                localPlayer.actionIndex++;
                const actionData = {
                    type: 'kill',
                    index: localPlayer.actionIndex,
                    target: loc.enemy,
                    data: 0
                };
                signMessage(JSON.stringify(actionData), playerKeys.privateKey).then(sig => {
                    gameActions.sendActionLog({ ...actionData, signature: sig });
                });

                loot.forEach(itemId => {
                    if (ITEMS[itemId]?.type === 'gold') localPlayer.gold += ITEMS[itemId].amount;
                    else localPlayer.inventory.push(itemId);
                });
                log(`\nYou defeated the ${eName}! (+${enemyDef.xp} XP)`, '#ff0');
                if (loot.length > 0) {
                    const lootStrs = loot.map(i => nameColor(ITEMS[i]?.name || i, ITEMS[i]?.color));
                    log(`Loot: ${lootStrs.join(', ')}`, '#ff0');
                }
                
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
                    
                    // Immediate presence broadcast for updated stats
                    myEntry().then(entry => {
                        if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                    });

                    saveLocalState(true);
                }
            }
            if (localPlayer.hp <= 0) {
                handleCommand('die');
            } else {
                saveLocalState();
            }
            break;
        }

        case 'flee': {
            if (!localPlayer.currentEnemy) { log(`There is nothing to flee from.`); break; }
            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound + 99);
            const rng = seededRNG(combatSeed);
            if (rng(100) < 50) {
                log(`You successfully fled from combat!`, '#0af');
                localPlayer.currentEnemy = null;
                localPlayer.combatRound = 0;
                const loc = world[localPlayer.location];
                const exits = Object.keys(loc.exits);
                if (exits.length > 0) {
                    const dir = exits[rng(exits.length)];
                    handleCommand(`move ${dir}`);
                }
            } else {
                log(`Failed to flee! The enemy gets a free hit.`, '#f55');
                const enemyDef = ENEMIES[localPlayer.currentEnemy.type];
                const scale = 1 + (worldState.threatLevel * 0.1);
                const scaledAtk = Math.floor(enemyDef.attack * scale);
                const bonus = levelBonus(localPlayer.level);
                const enemyRes = resolveAttack(scaledAtk, localPlayer.defense + bonus.defense + getBestGear().defenseBonus, rng);
                if (!enemyRes.isDodge) {
                    localPlayer.hp -= enemyRes.damage;
                    triggerShake();
                    log(`${nameColor(enemyDef.name, enemyDef.color)} hits you for ${enemyRes.damage}!`, '#f55');
                    if (localPlayer.hp <= 0) handleCommand('die');
                }
                saveLocalState();
            }
            break;
        }

        case 'die': {
            log(`\nYou have been slain! 💀`, '#f00');
            triggerShake();
            const deathMaxHp = localPlayer.maxHp + levelBonus(localPlayer.level).maxHp + (localPlayer.buffs?.rested ? 5 : 0);
            localPlayer.hp = Math.floor(deathMaxHp / 2);
            const deathLoc = localPlayer.location;
            localPlayer.location = 'cellar';
            localPlayer.currentEnemy = null;
            localPlayer.combatRound = 0;
            log(`You wake in the cellar...`, '#aaa');
            gameActions.sendMove({ from: deathLoc, to: 'cellar' });
            joinInstance('cellar', currentInstance, currentRtcConfig).then(() => handleCommand('look'));
            saveLocalState(true);
            break;
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { log(`You can't rest mid-combat!`); break; }
            const bonus = levelBonus(localPlayer.level);
            const cap = localPlayer.maxHp + bonus.maxHp + (localPlayer.buffs?.rested ? 5 : 0);
            const healed = Math.max(0, Math.min(10, cap - localPlayer.hp));
            localPlayer.hp += healed;
            log(`You rest and recover ${healed} HP. (HP: ${localPlayer.hp}/${cap})`, '#0f0');

            if (!localPlayer.buffs) localPlayer.buffs = { rested: false, activeElixir: null };
            if (localPlayer.location === 'tavern' && !localPlayer.buffs.rested) {
                localPlayer.buffs.rested = true;
                log(`The comfort of the Tavern makes you feel <b>Well Rested</b>! (+5 Max HP today)`, '#0af');
            }
            saveLocalState();
            break;
        }

        case 'use': {
            const query = args.slice(1).join(' ').toLowerCase();
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { log(`You don't have "${query}".`); break; }
            const itemId = localPlayer.inventory[idx];
            const item = ITEMS[itemId];
            if (item?.type === 'consumable') {
                const bonus = levelBonus(localPlayer.level);
                const cap = localPlayer.maxHp + bonus.maxHp + (localPlayer.buffs?.rested ? 5 : 0);
                localPlayer.hp = Math.min(cap, localPlayer.hp + item.heal);
                localPlayer.inventory.splice(idx, 1);
                log(`You use the ${nameColor(item.name, item.color)} and recover ${item.heal} HP.`, '#0f0');
                saveLocalState();
            } else if (item?.type === 'buff') {
                if (!localPlayer.buffs) localPlayer.buffs = { rested: false, activeElixir: null };
                localPlayer.buffs.activeElixir = itemId;
                localPlayer.inventory.splice(idx, 1);
                log(`You drink the ${nameColor(item.name, item.color)}. You feel much stronger! (+${item.atkBonus} ATK today)`, '#fa0');
                saveLocalState();
            } else log(`You can't use that.`);
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { log(`Usage: /rename <name>`); break; }
            if (newName.length > 14) { log(`Name too long (max 14 characters).`); break; }
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
                
                // Cancel active trade on move
                if (pendingTrade) {
                    setPendingTrade(null);
                    log(`[Trade] Session cancelled due to movement.`, '#555');
                }

                // Immediate presence broadcast for responsiveness
                myEntry().then(entry => {
                    if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                });

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
            log(`                                ${m('mountain_pass')}`, '#aaa');
            log(`                                     |`, '#aaa');
            log(`${m('throne_room')}-${m('dungeon_cell')}-${m('catacombs')}-${m('ruins_descent')}-${m('ruins')}-${m('forest_edge')}-${m('forest_depths')}-${m('lake_shore')}`, '#aaa');
            log(`                                     |          |          |`, '#aaa');
            log(`                               ${m('tavern')}  ${m('cave')}    ${m('bandit_camp')}`, '#aaa');
            log(`                               |`, '#aaa');
            log(`                          ${m('hallway')}--${m('market')}`, '#aaa');
            log(`                               |`, '#aaa');
            log(`                          ${m('cellar')}`, '#aaa');
            log(`-----------------\n`, '#aaa');
            break;
        }

        case 'bank': {
            if (localPlayer.location !== 'cellar') { log(`You can only bank at your home (the cellar).`); break; }
            const sub = args[1]?.toLowerCase();
            const amount = parseInt(args[2]);

            if (sub === 'deposit') {
                if (isNaN(amount) || amount <= 0) break;
                if (localPlayer.gold < amount) { log(`You don't have that much gold on you.`); break; }
                localPlayer.gold -= amount;
                localPlayer.bankedGold += amount;
                log(`[Bank] Deposited ${amount} Gold.`);
                saveLocalState();
            } else if (sub === 'withdraw') {
                if (isNaN(amount) || amount <= 0) break;
                if (localPlayer.bankedGold < amount) { log(`You don't have that much in the bank.`); break; }
                localPlayer.bankedGold -= amount;
                localPlayer.gold += amount;
                log(`[Bank] Withdrew ${amount} Gold.`);
                saveLocalState();
            } else {
                log(`\n--- THE CELLAR BANK ---`, '#ffa500');
                log(`Your Wallet: ${localPlayer.gold} Gold`);
                log(`Bank Balance: ${localPlayer.bankedGold} Gold`);
            }
            break;
        }

        case 'clear': {
            const output = document.getElementById('output');
            if (output) output.innerHTML = '';
            break;
        }

        case 'say': {
            const text = args.slice(1).join(' ').trim();
            if (!text) break;
            gameActions.sendEmote({ room: localPlayer.location, text: `says: "${text}"` });
            log(`[Chat] You say: "${escapeHtml(text)}"`);
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
                // Remove type buy hint
            } else if (npc.role === 'quest' && npc.questId) {
                const q = QUESTS[npc.questId];
                const playerQuest = localPlayer.quests[npc.questId];
                if (!playerQuest) {
                    log(`[Quest] ${npc.name}: "I have a task for you. ${q.description}"`, '#ff0');
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
            log(`[System] You bought ${nameColor(item.name, item.color)} for ${item.price} Gold.`, '#ff0');
            saveLocalState(true);
            break;
        }

        case 'sell': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpc = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpc) { log(`There is no shop here.`); break; }

            if (!query) { log(`Usage: /sell <item name>`); break; }

            const invIdx = localPlayer.inventory.findIndex(id => (ITEMS[id]?.name || id).toLowerCase() === query || id === query);
            if (invIdx === -1) { log(`You don't have that.`); break; }

            const itemId = localPlayer.inventory[invIdx];
            const item = ITEMS[itemId];
            if (!item || item.type === 'gold' || item.price === 0) { log(`They aren't interested in that.`); break; }

            const sellPrice = Math.floor(item.price * 0.5);
            localPlayer.gold += sellPrice;
            localPlayer.inventory.splice(invIdx, 1);
            log(`[System] You sold ${nameColor(item.name, item.color)} for ${sellPrice} Gold.`, '#ff0');
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
                if (!id || !QUESTS[id]) break;
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
                }

                saveLocalState(true);
                break;
            }
            break;
        }

        case 'addxp': {
            const amt = parseInt(args[1]) || 100;
            localPlayer.xp += amt;
            localPlayer.level = xpToLevel(localPlayer.xp);
            log(`[Dev] Added ${amt} XP. Level is now ${localPlayer.level}.`);
            saveLocalState(true);
            break;
        }

        case 'addgold': {
            const amt = parseInt(args[1]) || 1000;
            localPlayer.gold += amt;
            log(`[Dev] Added ${amt} Gold.`);
            saveLocalState(true);
            break;
        }

        case 'spawnitem': {
            const id = args[1];
            if (!ITEMS[id]) { log(`[Dev] Unknown item: ${id}`); break; }
            localPlayer.inventory.push(id);
            log(`[Dev] Spawned ${nameColor(ITEMS[id].name, ITEMS[id].color)}.`);
            saveLocalState(true);
            break;
        }

        case 'trade': {
            const sub = args[1]?.toLowerCase();
            if (!sub) break;
            
            if (sub === 'offer') {
                if (!pendingTrade) break;
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
                break;
            }

            if (sub === 'commit') {
                if (!pendingTrade) break;
                const commit = { gold: pendingTrade.myOffer.gold, items: pendingTrade.myOffer.items, ts: Date.now() };
                signMessage(JSON.stringify(commit), playerKeys.privateKey).then(sig => {
                    pendingTrade.signatures.me = sig;
                    gameActions.sendTradeCommit({ ...commit, signature: sig }, pendingTrade.partnerId);
                });
                break;
            }

            if (sub === 'cancel') {
                setPendingTrade(null);
                log(`Trade cancelled.`);
                break;
            }

            // trade <partnerId>
            const partnerId = sub;
            const partner = players.get(partnerId);
            if (!partner) { log(`Player not found.`); break; }
            if (partner.location !== localPlayer.location) { log(`${partner.name} is not here.`); break; }

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
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('trade-initiated'));
            break;
        }

        default:
            log(`Unknown command: ${command}.`);
    }
}

export async function startStateChannel(targetId, targetName, day) {
    if (activeChannels.has(targetId)) return; // Duel already in progress with this peer
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
    
    // Only the leader (smaller selfId) starts the first round automatically
    // The other peer will trigger resolveRound when they receive the first commit.
    if (selfId < targetId) {
        await resolveRound(targetId);
    }
}

export async function resolveRound(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    const myLen = chan.myHistory.length;
    const theirLen = chan.theirHistory.length;

    // 1. Check for finalization
    if (myLen === 3 && theirLen === 3) {
        finishDuel(targetId);
        return;
    }

    // 2. Determine if we should send a commit
    let shouldSend = false;
    if (myLen < theirLen && myLen < 3) {
        shouldSend = true; // Catch up
    } else if (myLen === theirLen && myLen < 3 && selfId < targetId) {
        shouldSend = true; // Leader initiates next round
    }

    if (shouldSend) {
        const round = myLen + 1;
        const seed = hashStr(selfId + targetId + chan.day + round);
        const rng = seededRNG(seed);
        
        const myBonus = levelBonus(localPlayer.level);
        const myAtk = localPlayer.attack + myBonus.attack;
        
        const opponent = getPlayerEntry(targetId);
        const opBonus = levelBonus(opponent?.level || 1);
        const opDef = (opponent?.defense ?? DEFAULT_PLAYER_STATS.defense) + opBonus.defense;

        const dmg = resolveAttack(myAtk, opDef, rng).damage;

        const commit = { round, dmg, day: chan.day };
        const signature = await signMessage(JSON.stringify(commit), playerKeys.privateKey);
        
        chan.myHistory.push(commit);
        gameActions.sendDuelCommit({ commit, signature }, targetId);

        // Re-check if this send completed the duel
        if (chan.myHistory.length === 3 && chan.theirHistory.length === 3) {
            finishDuel(targetId);
        }
    }
}

function finishDuel(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    let totalMyDmg = chan.myHistory.reduce((a, b) => a + b.dmg, 0);
    let totalTheirDmg = chan.theirHistory.reduce((a, b) => a + b.dmg, 0);
    
    log(`\n--- DUEL RESULT vs ${chan.opponentName} ---`, '#ff0');
    log(`You dealt: ${totalMyDmg} | Opponent dealt: ${totalTheirDmg}`, '#aaa');
    
    if (totalMyDmg > totalTheirDmg) {
        log(`You WIN! (+10 XP) 🏆`, '#0f0');
        localPlayer.xp += 10;
        saveLocalState();
    } else if (totalMyDmg < totalTheirDmg) {
        log(`You LOSE. 💀`, '#f55');
    } else {
        log(`It's a DRAW. 🤝`, '#aaa');
    }
    
    clearTimeout(chan.timeoutId);
    activeChannels.delete(targetId);
}
