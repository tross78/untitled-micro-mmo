import { localPlayer, worldState, shardEnemies } from '../store.js';
import { world, ENEMIES, ITEMS, QUESTS } from '../data.js';
import { hashStr, seededRNG, levelBonus, resolveAttack, rollLoot, xpToLevel, getTimeOfDay } from '../rules.js';
import { log, triggerShake } from '../ui.js';
import { bus } from '../eventbus.js';
import { selfId } from '../network/transport.js';
import { gameActions } from '../networking.js';
import { signMessage } from '../crypto.js';
import { playerKeys, myEntry } from '../identity.js';
import { saveLocalState } from '../persistence.js';
import { nameColor, getBestGear, grantItem } from './helpers.js';

export const handleCombatCommands = async (command, args) => {
    switch (command) {
        case 'attack': {
            const loc = world[localPlayer.location];
            if (!loc.enemy) { bus.emit('log', { msg: `There is nothing to fight here.`, color: '#f55' }); return true; }

            if (loc.enemy === 'forest_wolf' && getTimeOfDay() === 'night') {
                bus.emit('log', { msg: `The wolves have retreated to their dens for the night.`, color: '#aaa' });
                return true;
            }
            
            let sharedEnemy = shardEnemies.get(localPlayer.location);
            const enemyDef = ENEMIES[loc.enemy];
            const scale = 1 + (worldState.threatLevel * 0.1);
            const scaledHP = Math.floor(enemyDef.hp * scale);
            const scaledAtk = Math.floor(enemyDef.attack * scale);
            const scaledDef = Math.floor(enemyDef.defense * scale);

            if (!sharedEnemy || sharedEnemy.hp <= 0) {
                if (localPlayer.forestFights <= 0) {
                    bus.emit('log', { msg: `You are too exhausted to fight today.`, color: '#aaa' });
                    return true;
                }
                localPlayer.forestFights--;
                sharedEnemy = { type: loc.enemy, hp: scaledHP, maxHp: scaledHP };
                shardEnemies.set(localPlayer.location, sharedEnemy);
                localPlayer.currentEnemy = sharedEnemy;
                log(`\nA ${nameColor(enemyDef.name, enemyDef.color)} snarls and lunges!`, '#f55');
            } else {
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
                localPlayer.statusEffects = (localPlayer.statusEffects || []).filter(s => s.id !== 'poisoned');
                localPlayer.currentEnemy = null;
                const loot = rollLoot(loc.enemy, rng);
                localPlayer.xp += enemyDef.xp;
                localPlayer.combatRound = 0;
                const newLevel = xpToLevel(localPlayer.xp);

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
                    log(`Loot: ${lootStrs.join(', ')}`, '#ff0');
                }
                
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
                    myEntry().then(entry => {
                        if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                    });
                    saveLocalState(localPlayer, true);
                }
            }
            if (localPlayer.hp <= 0) {
                await handleCombatCommands('die', []);
            } else {
                saveLocalState(localPlayer);
            }
            return true;
        }

        case 'flee': {
            if (!localPlayer.currentEnemy) { bus.emit('log', { msg: `There is nothing to flee from.` }); return true; }
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
                    // This creates a circular dependency if we import handleCommand here. 
                    // We'll let the main loop handle the move.
                    return { type: 'move', dir };
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
                    if (localPlayer.hp <= 0) await handleCombatCommands('die', []);
                }
                saveLocalState(localPlayer);
            }
            return true;
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
            // This also needs access to joinInstance which is in networking. 
            // Return an action object to main coordinator.
            return { type: 'respawn', from: deathLoc };
        }

        case 'rest': {
            if (localPlayer.currentEnemy) { bus.emit('log', { msg: `You can't rest mid-combat!` }); return true; }
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
                localPlayer.statusEffects.push({ id: 'well_rested', duration: 100 });
                bus.emit('log', { msg: `The Tavern comfort makes you Well Rested! (+5 Max HP)`, color: '#0af' });

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
            return true;
        }
    }
    return false;
};
