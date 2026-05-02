import { localPlayer, players, shardEnemies, worldState, pendingTrade, setPendingTrade } from '../state/store.js';
import { world, QUESTS, ENEMIES, NPCS, ITEMS } from '../engine/data.js';
import { validateMove, xpToLevel } from '../rules/index.js';
import { log, getHealthBar, printStatus } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { saveLocalState } from '../state/persistence.js';
import { gameActions } from '../network/index.js';
import { myEntry } from '../security/identity.js';
import { getPlayerName, getNPCsAt, nameColor, getTag, grantItem } from './helpers.js';

export const handleMovementCommands = async (command, args) => {
    switch (command) {
        case 'interact': {
            const loc = world[localPlayer.location];
            const npcs = getNPCsAt(localPlayer.location);
            if (npcs.length > 0) {
                // Circular dependency workaround: return an action to main
                return { type: 'recursive', cmd: `talk ${npcs[0]}` };
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
                    return { type: 'join_instance', shard: exit.dest };
                } else {
                    bus.emit('log', { msg: `Nothing to interact with here.` });
                }
            }
            return true;
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
            return true;
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
            return true;
        }

        case 'move':
        case 'go': {
            const dir = args[1] || args[0]; // support "/move north" or just "/north"
            const loc = world[localPlayer.location];
            const nextLocId = validateMove(localPlayer.location, dir);

            if (nextLocId) {
                if (localPlayer.currentEnemy) { bus.emit('log', { msg: `You can't move while in combat!` }); return true; }

                const exit = ( loc.exitTiles || []).find(p => p.dir === dir || (p.dest === nextLocId));
                const prevLoc = localPlayer.location;

                localPlayer.location = nextLocId;
                localPlayer.x = exit?.destX ?? 5;
                localPlayer.y = exit?.destY ?? 5;

                saveLocalState(localPlayer);

                if (pendingTrade) {
                    setPendingTrade(null);
                    bus.emit('log', { msg: `Trade cancelled due to movement.`, color: '#555' });
                }

                myEntry().then(entry => {
                    if (gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                });

                if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: nextLocId, x: localPlayer.x, y: localPlayer.y });
                bus.emit('player:move', { from: prevLoc, to: nextLocId });
                
                // Quest Progress
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

                return { type: 'join_instance', shard: nextLocId };
            } else {
                bus.emit('log', { msg: `You can't go that way.` });
            }
            return true;
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
            return true;
        }
    }
    return false;
};
