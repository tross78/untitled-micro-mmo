import { selfId } from './transport.js';
import {
    worldState, players, localPlayer, pendingDuel, setPendingDuel,
    activeChannels, hasSyncedWithArbiter, pendingTrade, setPendingTrade, shardEnemies
} from './store.js';
import { saveLocalState } from './persistence.js';

import { log, printStatus, triggerShake, getHealthBar } from './ui.js';
import { 
    world, ENEMIES, ITEMS, DEFAULT_PLAYER_STATS,
    NPCS, QUESTS, ENABLE_ADS, RECIPES
} from './data.js';
import { 
    hashStr, seededRNG, levelBonus, resolveAttack, 
    rollLoot, xpToLevel, validateMove, getShardName,
    getNPCLocation, getNPCDialogue, getTimeOfDay
} from './rules.js';
import { signMessage } from './crypto.js';
import { 
    gameActions, joinInstance, globalRooms, rooms, 
    currentInstance, currentRtcConfig 
} from './networking.js';
import { playerKeys, myEntry } from './identity.js';
import { showRewardedAd } from './ads.js';
import { bus } from './eventbus.js';

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
    // Manual overrides from equipped slots
    const eqWep = localPlayer.equipped?.weapon ? ITEMS[localPlayer.equipped.weapon] : null;
    const eqArm = localPlayer.equipped?.armor ? ITEMS[localPlayer.equipped.armor] : null;

    return { 
        weaponBonus: Math.max(weaponBonus, eqWep?.bonus || 0), 
        defenseBonus: Math.max(defenseBonus, eqArm?.bonus || 0) 
    };
};

if (typeof window !== 'undefined') {
    window.devReset = () => {
        localStorage.clear();
        window.location.reload();
    };
}

export const grantItem = (itemId) => {
    if (!ITEMS[itemId]) return;
    localPlayer.inventory.push(itemId);

    // Auto-equip if stronger than current gear
    const item = ITEMS[itemId];
    if (item.type === 'weapon' || item.type === 'armor') {
        const slot = item.type === 'weapon' ? 'weapon' : 'armor';
        const current = localPlayer.equipped[slot] ? ITEMS[localPlayer.equipped[slot]] : null;
        if (!current || item.bonus > current.bonus) {
            localPlayer.equipped[slot] = itemId;
        }
    }

    // Fetch Quest Progress
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

export const handleCommand = async (cmd) => {
    const raw = cmd.trim();
    if (!raw) return;
    
    const cleanCmd = raw.startsWith('/') ? raw.slice(1) : raw;
    const args = cleanCmd.split(/\s+/);
    const command = args[0].toLowerCase();

    switch (command) {
        case 'equip': {
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) { bus.emit('log', { msg: `Usage: /equip <item name>` }); break; }

            const invIdx = localPlayer.inventory.findIndex(id => (ITEMS[id]?.name || id).toLowerCase() === query || id === query);
            if (invIdx === -1) { bus.emit('log', { msg: `You don't have that.` }); break; }

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
            break;
        }

        case 'who': {
            const nearby = Array.from(players.keys()).filter(id => !players.get(id).ghost).map(id => getPlayerName(id));
            if (nearby.length === 0) {
                bus.emit('log', { msg: `You are alone here.`, color: '#555' });
            } else {
                bus.emit('log', { msg: `Nearby: ${nearby.join(', ')}`, color: '#aaa' });
            }
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
            const rawArg = args.slice(1).join(' ');
            if (!rawArg) break;
            const ids = Array.from(players.keys()).filter(id => !players.get(id).ghost);
            const getNameOnly = (id) => (getPlayerEntry(id)?.name || '').toLowerCase();
            const lower = rawArg.toLowerCase();
            const targetId = (players.has(rawArg) ? rawArg : null)
                          ?? ids.find(id => getNameOnly(id) === lower)
                          ?? ids.find(id => getNameOnly(id).includes(lower));
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

        case 'interact': {
            const loc = world[localPlayer.location];
            const npcs = getNPCsAt(localPlayer.location);
            if (npcs.length > 0) {
                await handleCommand(`talk ${npcs[0]}`);
            } else {
                const exit = ( loc.exitTiles || []).find(p => p.x === localPlayer.x && p.y === localPlayer.y);
                if (exit) {
                    const prevLoc = localPlayer.location;
                    localPlayer.location = exit.dest;
                    localPlayer.x = exit.destX ?? 5;
                    localPlayer.y = exit.destY ?? 5;
                    saveLocalState(localPlayer);
                    
                    myEntry().then(entry => {
                        if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                    });
                    if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: exit.dest, x: localPlayer.x, y: localPlayer.y });
                    bus.emit('player:move', { from: prevLoc, to: exit.dest });
                    await joinInstance(exit.dest, currentInstance, currentRtcConfig);

                    // Explore Quest Progress
                    Object.keys(localPlayer.quests).forEach(qid => {
                        const q = QUESTS[qid];
                        const pq = localPlayer.quests[qid];
                        if (q && !pq.completed && q.type === 'explore' && q.objective.target === exit.dest) {
                            pq.progress = Math.min(q.objective.count || 1, pq.progress + 1);
                            bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count || 1 });
                            if (pq.progress >= (q.objective.count || 1) && q.receiver === null) {
                                pq.completed = true;
                                localPlayer.xp += q.reward.xp;
                                localPlayer.gold += (q.reward.gold || 0);
                                if (q.reward.item) grantItem(q.reward.item);
                                bus.emit('quest:complete', { name: q.name, rewards: q.reward });
                                const newLevel = xpToLevel(localPlayer.xp);
                                if (newLevel > localPlayer.level) { localPlayer.level = newLevel; bus.emit('player:levelup', { level: localPlayer.level }); }
                            }
                        }
                    });
                } else {
                    bus.emit('log', { msg: `Nothing to interact with here.` });
                }
            }
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
            const here = Array.from(players.keys()).filter(id => !players.get(id).ghost && players.get(id).location === localPlayer.location);
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
            const eqWep = localPlayer.equipped?.weapon ? ITEMS[localPlayer.equipped.weapon]?.name : null;
            const eqArm = localPlayer.equipped?.armor ? ITEMS[localPlayer.equipped.armor]?.name : null;
            log(`\n--- ${escapeHtml(localPlayer.name).toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp} (${xpNeeded} to next level) ✨`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${maxHp} ❤️`, hpColor);
            log(`Attack: ${localPlayer.attack + bonus.attack + gear.weaponBonus} ⚔️  Defense: ${localPlayer.defense + bonus.defense + gear.defenseBonus} 🛡️`, '#ffa500');
            log(`Equipped: ⚔️ ${eqWep || 'none'}  🛡️ ${eqArm || 'none'}`, '#0af');
            log(`Gold: ${localPlayer.gold} 💰  Bank: ${localPlayer.bankedGold} 🏦`, '#ffa500');
            log(`Daily Fights Remaining: ${localPlayer.forestFights} ⚡`, '#0af');
            if (localPlayer.statusEffects?.length > 0) {
                const effectNames = { poisoned: '☠️ Poisoned', well_rested: '😴 Well Rested' };
                const effects = localPlayer.statusEffects.map(s => effectNames[s.id] || s.id).join(', ');
                log(`Status: ${effects}`, '#fa0');
            }
            break;
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
                
                // Group items by ID
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
            break;
        }

        case 'get':
        case 'pickup': {
            const shardEnemy = shardEnemies.get(localPlayer.location);
            if (shardEnemy && shardEnemy.hp <= 0 && shardEnemy.loot && shardEnemy.loot.length > 0) {
                const itemId = shardEnemy.loot.shift();
                if (ITEMS[itemId]?.type === 'gold') {
                    localPlayer.gold += ITEMS[itemId].amount;
                    bus.emit('log', { msg: `You picked up ${ITEMS[itemId].name}.`, color: '#ff0' });
                } else {
                    grantItem(itemId);
                    bus.emit('item:pickup', { item: ITEMS[itemId] || { id: itemId, name: itemId } });
                    bus.emit('log', { msg: `You picked up a ${ITEMS[itemId]?.name || itemId}.`, color: '#ff0' });
                }
                saveLocalState(localPlayer);
            } else {
                bus.emit('log', { msg: `Nothing to pick up here.` });
            }
            break;
        }

        case 'drop': {
            const query = args.slice(1).join(' ').toLowerCase();
            if (!query) { log(`Usage: /drop <item name>`); break; }
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { log(`You don't have that.`); break; }
            const itemId = localPlayer.inventory[idx];
            localPlayer.inventory.splice(idx, 1);
            // If dropped equipped item, unequip it
            if (localPlayer.equipped.weapon === itemId) localPlayer.equipped.weapon = null;
            if (localPlayer.equipped.armor === itemId) localPlayer.equipped.armor = null;
            log(`You dropped the ${ITEMS[itemId]?.name || itemId}.`);
            saveLocalState(localPlayer);
            break;
        }

        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { bus.emit('log', { msg: `There is nothing to fight here.`, color: '#f55' }); break; }

            if (loc.enemy === 'forest_wolf' && getTimeOfDay() === 'night') {
                bus.emit('log', { msg: `The wolves have retreated to their dens for the night.`, color: '#aaa' });
                break;
            }
            
            let sharedEnemy = shardEnemies.get(localPlayer.location);
            const enemyDef = ENEMIES[loc.enemy];
            // Threat Scaling
            const scale = 1 + (worldState.threatLevel * 0.1);
            const scaledHP = Math.floor(enemyDef.hp * scale);
            const scaledAtk = Math.floor(enemyDef.attack * scale);
            const scaledDef = Math.floor(enemyDef.defense * scale);

            if (!sharedEnemy || sharedEnemy.hp <= 0) {
                if (localPlayer.forestFights <= 0) {
                    bus.emit('log', { msg: `You are too exhausted to fight today.`, color: '#aaa' });
                    break;
                }
                localPlayer.forestFights--;
                sharedEnemy = { type: loc.enemy, hp: scaledHP, maxHp: scaledHP };
                shardEnemies.set(localPlayer.location, sharedEnemy);
                localPlayer.currentEnemy = sharedEnemy;
                log(`\nA ${nameColor(enemyDef.name, enemyDef.color)} snarls and lunges!`, '#f55');
            } else {
                // Joining an in-progress fight in this shard
                localPlayer.currentEnemy = sharedEnemy;
            }

            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound);
            localPlayer.combatRound++;
            const rng = seededRNG(combatSeed);
            const bonus = levelBonus(localPlayer.level);
            const gear = getBestGear();
            const elixirBonus = (localPlayer.buffs?.activeElixir === 'strength_elixir') ? 5 : 0;

            const playerRes = resolveAttack(localPlayer.attack + bonus.attack + gear.weaponBonus + elixirBonus, scaledDef, rng);
            const isNight = getTimeOfDay() === 'night';
            const enemyRes = resolveAttack(scaledAtk, localPlayer.defense + bonus.defense + gear.defenseBonus, rng, isNight);

            // Player Attack
            if (playerRes.isDodge) {
                bus.emit('combat:dodge', { attacker: 'You', target: enemyDef.name });
            } else {
                sharedEnemy.hp -= playerRes.damage;
                bus.emit('combat:hit', { 
                    attacker: 'You', 
                    target: enemyDef.name, 
                    damage: playerRes.damage, 
                    crit: playerRes.isCrit,
                    targetHP: Math.max(0, sharedEnemy.hp),
                    targetMaxHP: sharedEnemy.maxHp
                });
                if (gameActions.sendMonsterDmg) gameActions.sendMonsterDmg({ roomId: localPlayer.location, damage: playerRes.damage });
            }

            // Enemy Attack
            if (sharedEnemy.hp > 0) {
                if (enemyRes.isDodge) {
                    bus.emit('combat:dodge', { attacker: enemyDef.name, target: 'You' });
                } else {
                    localPlayer.hp -= enemyRes.damage;
                    const maxHp = localPlayer.maxHp + bonus.maxHp + (localPlayer.buffs?.rested ? 5 : 0);
                    bus.emit('combat:hit', { 
                        attacker: enemyDef.name, 
                        target: 'You', 
                        damage: enemyRes.damage, 
                        crit: enemyRes.isCrit,
                        targetHP: Math.max(0, localPlayer.hp),
                        targetMaxHP: maxHp
                    });
                    if (enemyRes.damage > 0) {
                        triggerShake();
                        // 20% chance to poison from ruin_shade
                        if (localPlayer.currentEnemy.type === 'ruin_shade' && rng(100) < 20) {
                            if (!localPlayer.statusEffects) localPlayer.statusEffects = [];
                            if (!localPlayer.statusEffects.find(s => s.id === 'poisoned')) {
                                localPlayer.statusEffects.push({ id: 'poisoned', duration: 5 });
                                bus.emit('log', { msg: `You have been poisoned!`, color: '#f55' });
                            }
                        }
                    }
                }
            }

            // Poison tick
            const poisonEffect = localPlayer.statusEffects?.find(s => s.id === 'poisoned');
            if (poisonEffect && sharedEnemy.hp > 0) {
                const poisonDmg = 1 + (rng(2));
                localPlayer.hp -= poisonDmg;
                bus.emit('log', { msg: `Poison courses through you for ${poisonDmg} damage.`, color: '#a0f' });
                poisonEffect.duration--;
                if (poisonEffect.duration <= 0) {
                    localPlayer.statusEffects = localPlayer.statusEffects.filter(s => s.id !== 'poisoned');
                    bus.emit('log', { msg: `The poison has worn off.`, color: '#a0f' });
                }
            }

            if (sharedEnemy.hp <= 0) {
                // Clear poison on kill (combat over — infection ends)
                localPlayer.statusEffects = (localPlayer.statusEffects || []).filter(s => s.id !== 'poisoned');
                localPlayer.currentEnemy = null;
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                localPlayer.combatRound = 0;
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
                    if (gameActions.sendActionLog) gameActions.sendActionLog({ ...actionData, signature: sig });
                });

                loot.forEach(itemId => {
                    if (ITEMS[itemId]?.type === 'gold') localPlayer.gold += ITEMS[itemId].amount;
                    else grantItem(itemId);
                });
                bus.emit('combat:death', { entity: enemyDef.name, loot });
                if (loot.length > 0) {
                    const lootStrs = loot.map(i => ITEMS[i]?.name || i);
                    log(`Loot: ${lootStrs.join(', ')}`, '#ff0'); // Keep this for now or move to event
                }
                
                // Quest Progress
                Object.keys(localPlayer.quests).forEach(qid => {
                    const q = QUESTS[qid];
                    const pq = localPlayer.quests[qid];
                    if (!pq.completed && q.type === 'kill' && q.objective.target === loc.enemy) {
                        pq.progress = Math.min(q.objective.count, pq.progress + 1);
                        bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
                    }
                });

                if (newLevel > localPlayer.level) {
                    localPlayer.level = newLevel;
                    bus.emit('player:levelup', { level: localPlayer.level });
                    
                    // Immediate presence broadcast for updated stats
                    myEntry().then(entry => {
                        if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                    });

                    saveLocalState(localPlayer, true);
                }
            }
            if (localPlayer.hp <= 0) {
                await handleCommand('die');
            } else {
                saveLocalState(localPlayer);
            }
            break;
        }

        case 'flee': {
            if (!localPlayer.currentEnemy) { bus.emit('log', { msg: `There is nothing to flee from.` }); break; }
            const combatSeed = hashStr(worldState.seed + worldState.day + selfId + localPlayer.combatRound + 99);
            const rng = seededRNG(combatSeed);
            if (rng(100) < 50) {
                bus.emit('log', { msg: `You successfully fled from combat!`, color: '#0af' });
                localPlayer.currentEnemy = null;
                localPlayer.combatRound = 0;
                const loc = world[localPlayer.location];
                const exits = Object.keys(loc.exits);
                if (exits.length > 0) {
                    const dir = exits[rng(exits.length)];
                    await handleCommand(`move ${dir}`);
                }
            } else {
                bus.emit('log', { msg: `Failed to flee! The enemy gets a free hit.`, color: '#f55' });
                const enemyDef = ENEMIES[localPlayer.currentEnemy.type];
                const scale = 1 + (worldState.threatLevel * 0.1);
                const scaledAtk = Math.floor(enemyDef.attack * scale);
                const bonus = levelBonus(localPlayer.level);
                const enemyRes = resolveAttack(scaledAtk, localPlayer.defense + bonus.defense + getBestGear().defenseBonus, rng);
                if (!enemyRes.isDodge) {
                    localPlayer.hp -= enemyRes.damage;
                    triggerShake();
                    bus.emit('log', { msg: `${enemyDef.name} hits you for ${enemyRes.damage}!`, color: '#f55' });
                    if (localPlayer.hp <= 0) await handleCommand('die');
                }
                saveLocalState(localPlayer);
            }
            break;
        }

        case 'die': {
            bus.emit('log', { msg: `You have been slain! 💀`, color: '#f00' });
            triggerShake();
            const goldLoss = Math.floor(localPlayer.gold * 0.1);
            if (goldLoss > 0) {
                localPlayer.gold -= goldLoss;
                bus.emit('log', { msg: `You dropped ${goldLoss} gold.`, color: '#f55' });
            }
            localPlayer.hp = 5;
            const deathLoc = localPlayer.location;
            localPlayer.location = 'cellar';
            localPlayer.currentEnemy = null;
            localPlayer.combatRound = 0;
            localPlayer.x = 5;
            localPlayer.y = 5;
            bus.emit('combat:death', { entity: 'You' });
            bus.emit('player:move', { from: deathLoc, to: 'cellar' });
            bus.emit('log', { msg: `You awaken in the cellar...`, color: '#aaa' });
            if (gameActions.sendMove) gameActions.sendMove({ from: deathLoc, to: 'cellar', x: 5, y: 5 });
            joinInstance('cellar', currentInstance, currentRtcConfig);
            saveLocalState(localPlayer, true);
            break;
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { bus.emit('log', { msg: `You can't rest mid-combat!` }); break; }
            const bonus = levelBonus(localPlayer.level);
            const cap = localPlayer.maxHp + bonus.maxHp + (localPlayer.statusEffects?.find(s => s.id === 'well_rested') ? 5 : 0);
            const healed = Math.max(0, Math.min(10, cap - localPlayer.hp));
            localPlayer.hp += healed;
            
            const isNight = getTimeOfDay() === 'night';
            const restMsg = (localPlayer.location === 'tavern' && isNight) 
                ? `You sleep until dawn and recover ${healed} HP.` 
                : `You rest and recover ${healed} HP.`;
            bus.emit('log', { msg: `${restMsg} (HP: ${localPlayer.hp}/${cap})`, color: '#0f0' });

            if (localPlayer.location === 'tavern' && !localPlayer.statusEffects?.find(s => s.id === 'well_rested')) {
                if (!localPlayer.statusEffects) localPlayer.statusEffects = [];
                localPlayer.statusEffects.push({ id: 'well_rested', duration: 100 }); // "Today"
                bus.emit('log', { msg: `The Tavern comfort makes you Well Rested! (+5 Max HP)`, color: '#0af' });

                // tavern_regular quest: track unique days rested at Tavern
                const tq = localPlayer.quests['tavern_regular'];
                if (tq && !tq.completed) {
                    const today = worldState.day;
                    if (!tq.daysRested) tq.daysRested = [];
                    if (!tq.daysRested.includes(today)) {
                        tq.daysRested.push(today);
                        tq.progress = tq.daysRested.length;
                        bus.emit('quest:progress', { name: 'Tavern Regular', current: tq.progress, total: QUESTS.tavern_regular.objective.count });
                    }
                }
            }
            saveLocalState(localPlayer);
            break;
        }

        case 'use': {
            const query = args.slice(1).join(' ').toLowerCase();
            const idx = localPlayer.inventory.findIndex(id => id.toLowerCase() === query || (ITEMS[id]?.name || '').toLowerCase() === query);
            if (idx === -1) { bus.emit('log', { msg: `You don't have "${query}".` }); break; }
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
            break;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { bus.emit('log', { msg: `Usage: /rename <name>` }); break; }
            if (newName.length > 14) { bus.emit('log', { msg: `Name too long (max 14 characters).` }); break; }
            localPlayer.name = newName;
            saveLocalState(localPlayer);
            bus.emit('log', { msg: `You are now known as ${newName}` });
            break;
        }

        case 'move': {
            const dir = args[1];
            const loc = world[localPlayer.location];
            const nextLocId = validateMove(localPlayer.location, dir);

            if (nextLocId) {
                if (localPlayer.currentEnemy) { bus.emit('log', { msg: `You can't move while in combat!` }); break; }

                // Spatial Transition logic
                const exit = ( loc.exitTiles || []).find(p => p.dir === dir || (p.dest === nextLocId));
                const prevLoc = localPlayer.location;

                localPlayer.location = nextLocId;
                localPlayer.x = exit?.destX ?? 5;
                localPlayer.y = exit?.destY ?? 5;

                saveLocalState(localPlayer);

                // Cancel active trade on move
                if (pendingTrade) {
                    setPendingTrade(null);
                    bus.emit('log', { msg: `Trade cancelled due to movement.`, color: '#555' });
                }

                // Immediate presence broadcast for responsiveness
                myEntry().then(entry => {
                    if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                });

                if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: nextLocId, x: localPlayer.x, y: localPlayer.y });
                bus.emit('player:move', { from: prevLoc, to: nextLocId });
                await joinInstance(nextLocId, currentInstance, currentRtcConfig);

                // Explore Quest Progress
                Object.keys(localPlayer.quests).forEach(qid => {
                    const q = QUESTS[qid];
                    const pq = localPlayer.quests[qid];
                    if (q && !pq.completed && q.type === 'explore' && q.objective.target === nextLocId) {
                        pq.progress = Math.min(q.objective.count || 1, pq.progress + 1);
                        bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count || 1 });
                        if (pq.progress >= (q.objective.count || 1) && q.receiver === null) {
                            pq.completed = true;
                            localPlayer.xp += q.reward.xp;
                            localPlayer.gold += (q.reward.gold || 0);
                            if (q.reward.item) grantItem(q.reward.item);
                            bus.emit('quest:complete', { name: q.name, rewards: q.reward });
                            const lvl = xpToLevel(localPlayer.xp);
                            if (lvl > localPlayer.level) { localPlayer.level = lvl; bus.emit('player:levelup', { level: localPlayer.level }); }
                        }
                    }
                });
            } else {
                bus.emit('log', { msg: `You can't go that way.` });
            }
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
                saveLocalState(localPlayer);
            } else if (sub === 'withdraw') {
                if (isNaN(amount) || amount <= 0) break;
                if (localPlayer.bankedGold < amount) { log(`You don't have that much in the bank.`); break; }
                localPlayer.bankedGold -= amount;
                localPlayer.gold += amount;
                log(`[Bank] Withdrew ${amount} Gold.`);
                saveLocalState(localPlayer);
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
            bus.emit('chat:say', { name: 'You', text });
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
            if (localPlayer.location !== 'tavern') { log(`Strange visions only appear in the haze of the Tavern.`); break; }
            if ((localPlayer.forestFights ?? 15) > 0) { log(`You don't feel the pull of visions yet — you still have energy to burn.`); break; }
            if (ENABLE_ADS) {
                showRewardedAd(() => {
                    localPlayer.forestFights += 5;
                    log(`[Vision] You feel a surge of energy! (+5 Daily Fights)`, '#0f0');
                    saveLocalState(localPlayer);
                }, (err) => {
                    log(`[System] ${err}`, '#f55');
                });
            } else {
                // Meditate for a modest fight restoration (no ad required)
                localPlayer.forestFights += 3;
                log(`[Vision] The ale and firelight blur into a waking dream... You feel restored. (+3 Daily Fights)`, '#f0f');
                saveLocalState(localPlayer);
            }
            break;
        }

        case 'talk': {
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const targetId = npcs.find(id => NPCS[id].name.toLowerCase() === query || id === query);
            if (!targetId) { log(`They aren't here.`); break; }
            
            const npc = NPCS[targetId];
            const dialogue = getNPCDialogue(targetId, worldState.seed, worldState.day, worldState.mood);
            bus.emit('npc:speak', { npcName: npc.name, text: dialogue });

            // Quest Offering
            const availableQuests = Object.values(QUESTS).filter(q => q.giver === targetId && !localPlayer.quests[q.id]);
            availableQuests.forEach(q => {
                if (!q.prerequisite || (localPlayer.quests[q.prerequisite] && localPlayer.quests[q.prerequisite].completed)) {
                    log(`[Quest] ${npc.name}: "I have a task for you: ${q.name}. ${q.description}"`, '#ff0');
                }
            });

            // Quest Status
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

            // courier_run: deliver ale to Sage on talk
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
            break;
        }

        case 'buy': {
            if (getTimeOfDay() === 'night') {
                log(`[System] The Market is closed for the night. Return at dawn.`, '#555');
                break;
            }
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
            grantItem(itemId);
            bus.emit('item:pickup', { item });
            saveLocalState(localPlayer, true);
            break;
        }

        case 'sell': {
            if (getTimeOfDay() === 'night') {
                log(`[System] The Market is closed for the night. Return at dawn.`, '#555');
                break;
            }
            const query = args.slice(1).join(' ').toLowerCase();
            const npcs = getNPCsAt(localPlayer.location);
            const shopNpcId = npcs.find(id => NPCS[id].role === 'shop');
            if (!shopNpcId) { log(`There is no shop here.`); break; }

            if (!query) { log(`Usage: /sell <item name>`); break; }

            const invIdx = localPlayer.inventory.findIndex(id => (ITEMS[id]?.name || id).toLowerCase() === query || id === query);
            if (invIdx === -1) { log(`You don't have that.`); break; }

            const itemId = localPlayer.inventory[invIdx];
            const item = ITEMS[itemId];
            if (!item || item.type === 'gold' || item.price === 0) { log(`They aren't interested in that.`); break; }

            const sellPrice = Math.floor(item.price * 0.4);
            localPlayer.gold += sellPrice;
            localPlayer.inventory.splice(invIdx, 1);
            bus.emit('log', { msg: `[System] You sold ${item.name} for ${sellPrice} Gold.`, color: '#ff0' });

            // Deliver quest progress (e.g. market_recovery)
            Object.keys(localPlayer.quests).forEach(qid => {
                const q = QUESTS[qid];
                const pq = localPlayer.quests[qid];
                if (q && !pq.completed && q.type === 'deliver' && q.objective.target === shopNpcId) {
                    pq.progress = Math.min(q.objective.count, (pq.progress || 0) + 1);
                    bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
                }
            });

            saveLocalState(localPlayer, true);
            break;
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
                break;
            }

            const recipe = RECIPES.find(r => r.name.toLowerCase() === query || r.id === query);
            if (!recipe) { log(`Unknown recipe.`); break; }

            if (recipe.location && localPlayer.location !== recipe.location) {
                log(`You must be at the ${recipe.location} to craft this.`);
                break;
            }

            // Check inputs
            const hasInputs = Object.entries(recipe.inputs).every(([id, qty]) => {
                const count = localPlayer.inventory.filter(iid => iid === id).length;
                return count >= qty;
            });

            if (!hasInputs) { log(`You don't have the required materials.`); break; }

            // Consume inputs
            Object.entries(recipe.inputs).forEach(([id, qty]) => {
                for (let i = 0; i < qty; i++) {
                    const idx = localPlayer.inventory.indexOf(id);
                    if (idx !== -1) localPlayer.inventory.splice(idx, 1);
                }
            });

            // Grant output
            grantItem(recipe.output);
            bus.emit('item:pickup', { item: ITEMS[recipe.output] });
            
            // Craft Quest Progress
            Object.keys(localPlayer.quests).forEach(qid => {
                const q = QUESTS[qid];
                const pq = localPlayer.quests[qid];
                if (!pq.completed && q.type === 'craft' && q.objective.target === recipe.output) {
                    pq.progress = Math.min(q.objective.count, pq.progress + 1);
                    bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
                }
            });

            saveLocalState(localPlayer, true);
            break;
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
                break;
            }

            if (sub === 'accept') {
                if (!id || !QUESTS[id]) break;
                const q = QUESTS[id];
                const npcs = getNPCsAt(localPlayer.location);
                if (!npcs.includes(q.giver)) { log(`Nobody here can give you that quest.`); break; }
                
                if (localPlayer.quests[id]) { log(`You already have that quest.`); break; }
                localPlayer.quests[id] = { progress: 0, completed: false };
                bus.emit('log', { msg: `[Quest] Accepted: ${q.name}`, color: '#ff0' });
                saveLocalState(localPlayer);
                break;
            }

            if (sub === 'complete') {
                if (!id || !localPlayer.quests[id]) { log(`You don't have that quest.`); break; }
                const q = QUESTS[id];
                if (localPlayer.quests[id].completed) { log(`Already completed.`); break; }
                
                if (localPlayer.quests[id].progress < (q.objective.count || 0)) { log(`Quest not finished yet.`); break; }
                
                const npcs = getNPCsAt(localPlayer.location);
                if (q.receiver !== null && !npcs.includes(q.receiver)) { log(`Return to the receiver to complete this.`); break; }

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
                break;
            }
            break;
        }

        case 'addxp': {
            const amt = parseInt(args[1]) || 100;
            localPlayer.xp += amt;
            localPlayer.level = xpToLevel(localPlayer.xp);
            log(`[Dev] Added ${amt} XP. Level is now ${localPlayer.level}.`);
            saveLocalState(localPlayer, true);
            break;
        }

        case 'addgold': {
            const amt = parseInt(args[1]) || 1000;
            localPlayer.gold += amt;
            log(`[Dev] Added ${amt} Gold.`);
            saveLocalState(localPlayer, true);
            break;
        }

        case 'spawn': {
            const id = args[1];
            if (!ITEMS[id]) { log(`[Dev] Unknown item: ${id}`); break; }
            grantItem(id);
            log(`[Dev] Spawned ${nameColor(ITEMS[id].name, ITEMS[id].color)}.`);
            saveLocalState(localPlayer, true);
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

            // trade <partnerId|name> — sub is lowercased so use args[1] for exact peer ID lookup,
            // falling back to name search for CLI use.
            const rawArg = args.slice(1).join(' ');
            let partnerId = (players.has(rawArg) && !players.get(rawArg).ghost) ? rawArg : null;
            if (!partnerId) {
                const lower = rawArg.toLowerCase();
                const ids = Array.from(players.keys()).filter(id => !players.get(id).ghost);
                partnerId = ids.find(id => (players.get(id)?.name || '').toLowerCase() === lower)
                         ?? ids.find(id => (players.get(id)?.name || '').toLowerCase().includes(lower));
            }
            const partner = partnerId ? players.get(partnerId) : null;
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
            bus.emit('trade:initiated', {});
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
        saveLocalState(localPlayer);
    } else if (totalMyDmg < totalTheirDmg) {
        log(`You LOSE. 💀`, '#f55');
    } else {
        log(`It's a DRAW. 🤝`, '#aaa');
    }
    
    clearTimeout(chan.timeoutId);
    activeChannels.delete(targetId);
}
