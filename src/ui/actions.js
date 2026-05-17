import { NPCS, ENEMIES, ITEMS, RECIPES, QUESTS, roomHasFeature } from '../content/data.js';
import { ACTION } from '../engine/input.js';
import { GAME_NAME } from '../content/data.js';
import { bus } from '../state/eventbus.js';
import { clearElement, getActionButtonsEl, getInputContainerEl, getInputEl } from '../adapters/dom/shell.js';
import { requestTextInput } from '../adapters/dom/prompt.js';
import { getNPCsAt } from '../commands/helpers.js';
import { getBuyPrice, getSellPrice, getShopInventory } from '../commands/helpers.js';
import { getTimeOfDay } from '../rules/index.js';
import { Component } from '../domain/components.js';
import { appRuntime } from '../app/runtime.js';

let uiState = 'root';
let _lastAction = null;
const MOVE_DIRECTIONS = new Set(['north', 'south', 'east', 'west', 'up', 'down']);

export const _resetUiState = () => { uiState = 'root'; };
export const _getUiState   = () => uiState;
export const setUiState = (val) => { uiState = val; };

export const initUIActions = (bus) => {
    bus.on('ui:back', () => {
        uiState = 'root';
    });
    bus.on('player:move', () => {
        uiState = 'root';
    });
};

export const renderActionButtons = (ctx, onAction) => {
    try {
        const actionButtonsEl = getActionButtonsEl();
        if (!actionButtonsEl) return;
        clearElement(actionButtonsEl);
        
        const { localPlayer, world, shardEnemies } = ctx;
        if (!localPlayer || !world) return;

        const loc = world[localPlayer.location];
        if (!loc) return;

        const addButton = (label, action) => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.textContent = label;
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof action === 'string') {
                    _lastAction = action;
                    onAction(action);
                    uiState = 'root';
                    renderActionButtons(ctx, onAction);
                } else if (typeof action === 'function') {
                    await action();
                    renderActionButtons(ctx, onAction);
                }
            });
            actionButtonsEl.appendChild(btn);
        };

        const localNpcs = getNPCsAt(localPlayer.location);
        const timeOfDay = getTimeOfDay();
        const roomEnemyId = loc.enemy;
        const roomEnemyDef = roomEnemyId ? ENEMIES[roomEnemyId] : null;
        const sharedEnemy = shardEnemies?.get(localPlayer.location);
        const enemyDead = !!sharedEnemy && sharedEnemy.hp <= 0;
        const enemyVisible = !!roomEnemyDef
            && !enemyDead
            && (!loc.nightOnly || timeOfDay === 'night')
            && !(roomEnemyId === 'forest_wolf' && timeOfDay === 'night');

        if (uiState === 'root') {
            if (_lastAction === 'attack' && enemyVisible && localPlayer.currentEnemy) {
                addButton('Attack Again ⚔️', ACTION.ATTACK);
            }

            addButton('Move 🧭', () => { uiState = 'move'; renderActionButtons(ctx, onAction); });
            
            if (enemyVisible) {
                const label = (localPlayer.currentEnemy && localPlayer.currentEnemy.hp > 0)
                    ? `Strike ${roomEnemyDef.name} ⚔️`
                    : `Attack ${roomEnemyDef.name} ⚔️`;
                addButton(label, ACTION.ATTACK);
                if (localPlayer.currentEnemy) {
                    addButton('Flee 🏃', 'flee');
                }
            }

            if ((localPlayer.inventory || []).length > 0) {
                addButton('Inventory 🎒', ACTION.INVENTORY);
                addButton('Use 🧪', () => { uiState = 'use'; renderActionButtons(ctx, onAction); });
                if (localPlayer.inventory.some(id => ITEMS[id] && (ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor'))) {
                    addButton('Equip ⚔️', () => { uiState = 'equip'; renderActionButtons(ctx, onAction); });
                }
            }

            if (sharedEnemy && sharedEnemy.hp <= 0 && sharedEnemy.loot && sharedEnemy.loot.length > 0) {
                addButton('Pickup 📦', ACTION.INTERACT);
            }

            // Phase 8.7x: Gather / Fish contextual buttons
            const gatherables = appRuntime.world.query([Component.Gatherable, Component.Transform]);
            const hasGatherableAtFeet = gatherables.some(id => {
                const t = appRuntime.world.getComponent(id, Component.Transform);
                return t && t.x === localPlayer.x && t.y === localPlayer.y && t.mapId === localPlayer.location;
            });
            if (hasGatherableAtFeet) {
                addButton('Gather 🌿', ACTION.INTERACT);
            }

            const playerEntityTransform = appRuntime.playerEntityId ? appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Transform) : null;
            if (playerEntityTransform) {
                const facing = playerEntityTransform.facing || 's';
                const fdx = facing === 'e' ? 1 : facing === 'w' ? -1 : 0;
                const fdy = facing === 's' ? 1 : facing === 'n' ? -1 : 0;
                const fx = playerEntityTransform.x + fdx;
                const fy = playerEntityTransform.y + fdy;
                const isFacingWater = (loc.tileOverrides || []).some(t => t.x === fx && t.y === fy && t.type === 'water');
                if (isFacingWater) {
                    addButton('Fish 🎣', ACTION.INTERACT);
                }
            }

            if (localNpcs.length > 0) {
                addButton('Talk 💬', () => { uiState = 'talk'; renderActionButtons(ctx, onAction); });
                if (localNpcs.some(id => NPCS[id]?.role === 'shop')) {
                    addButton('Buy 💰', () => { 
                        bus.emit('ui:menu', { type: 'shop' }); 
                        uiState = 'buy';
                        renderActionButtons(ctx, onAction); 
                    });
                    if (localPlayer.inventory.some(id => ITEMS[id] && ITEMS[id].type !== 'gold' && ITEMS[id].price > 0)) {
                        addButton('Sell 💵', () => { uiState = 'sell'; renderActionButtons(ctx, onAction); });
                    }
                }
            }

            if (roomHasFeature(localPlayer.location, 'bank')) {
                addButton('Bank 🏦', () => { uiState = 'bank'; renderActionButtons(ctx, onAction); });
            }

            const craftableHere = (RECIPES || []).filter(r => r.location === localPlayer.location);
            if (craftableHere.length > 0 && !localPlayer.currentEnemy) {
                addButton('Craft ⚒️', () => { 
                    bus.emit('ui:menu', { type: 'crafting' }); 
                    uiState = 'craft';
                    renderActionButtons(ctx, onAction); 
                });
            }

            if (!localPlayer.currentEnemy) {
                addButton('Rest 💤', 'rest');
            }

            addButton('Quests 📜', () => { 
                bus.emit('ui:menu', { type: 'quests' }); 
                uiState = 'quests';
                renderActionButtons(ctx, onAction); 
            });
            addButton('Config ⚙️', () => { uiState = 'settings'; renderActionButtons(ctx, onAction); });
            addButton('Help ❓', () => { uiState = 'help'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'move') {
            Object.keys(loc.exits || {}).filter(dir => MOVE_DIRECTIONS.has(dir)).forEach(dir => {
                const dirEmoji = { north: '⬆️', south: '⬇️', east: '➡️', west: '⬅️', up: '⤴️', down: '⤵️' }[dir] || '➡️';
                addButton(`${dir.charAt(0).toUpperCase() + dir.slice(1)} ${dirEmoji}`, `move ${dir}`);
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'use') {
            const uniqueItems = Array.from(new Set(localPlayer.inventory || []));
            uniqueItems.forEach(id => {
                const item = ITEMS[id];
                if (item && (item.type === 'consumable' || item.type === 'buff')) {
                    let label = `${item.name}`;
                    if (item.heal) label += ` (+${item.heal}hp)`;
                    if (item.atkBonus) label += ` (+${item.atkBonus}atk)`;
                    addButton(label, `use ${item.name.toLowerCase()}`);
                }
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'equip') {
            const gear = (localPlayer.inventory || []).filter(id => ITEMS[id] && (ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor'));
            const seen = new Set();
            gear.forEach(id => {
                if (seen.has(id)) return;
                seen.add(id);
                const item = ITEMS[id];
                const slot = item.type === 'weapon' ? 'weapon' : 'armor';
                const isEquipped = localPlayer.equipped?.[slot] === id;
                const label = `${item.name} (+${item.bonus})${isEquipped ? ' ✅' : ''}`;
                if (!isEquipped) addButton(label, `equip ${item.name.toLowerCase()}`);
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'talk') {
            localNpcs.forEach(id => {
                if (NPCS[id]) addButton(`${NPCS[id].name}`, `talk ${id}`);
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'buy') {
            const shopNpc = localNpcs.find(id => NPCS[id]?.role === 'shop');
            const shopInventory = getShopInventory(shopNpc);
            if (shopNpc && shopInventory.length > 0) {
                shopInventory.forEach(itemId => {
                    const item = ITEMS[itemId];
                    if (item) {
                        const price = getBuyPrice(itemId);
                        let label = `${item.name} (${price}g)`;
                        if (item.bonus) label += ` (+${item.bonus}atk)`;
                        if (item.heal) label += ` (+${item.heal}hp)`;
                        addButton(label, `buy ${item.name.toLowerCase()}`);
                    }
                });
            }
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'sell') {
            const shopNpc = localNpcs.find(id => NPCS[id]?.role === 'shop');
            if (shopNpc) {
                const sellable = (localPlayer.inventory || []).filter(id => ITEMS[id] && ITEMS[id].type !== 'gold' && ITEMS[id].price > 0);
                const seen = new Set();
                sellable.forEach(id => {
                    if (seen.has(id)) return;
                    seen.add(id);
                    const item = ITEMS[id];
                    const price = getSellPrice(id);
                    addButton(`${item.name} (${price}g)`, `sell ${item.name.toLowerCase()}`);
                });
            }
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'bank') {
            addButton('Deposit 📥', () => { uiState = 'bank_deposit'; renderActionButtons(ctx, onAction); });
            addButton('Withdraw 📤', () => { uiState = 'bank_withdraw'; renderActionButtons(ctx, onAction); });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'bank_deposit') {
            if (localPlayer.gold >= 10) addButton('10 Gold', 'bank deposit 10');
            if (localPlayer.gold >= 50) addButton('50 Gold', 'bank deposit 50');
            if (localPlayer.gold > 0) addButton('All Gold', `bank deposit ${localPlayer.gold}`);
            addButton('Back ⬅️', () => { uiState = 'bank'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'bank_withdraw') {
            if (localPlayer.bankedGold >= 10) addButton('10 Gold', 'bank withdraw 10');
            if (localPlayer.bankedGold >= 50) addButton('50 Gold', 'bank withdraw 50');
            if (localPlayer.bankedGold > 0) addButton('All Gold', `bank withdraw ${localPlayer.bankedGold}`);
            addButton('Back ⬅️', () => { uiState = 'bank'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'quests') {
            const active = Object.entries(localPlayer.quests || {}).filter(([, q]) => !q.completed);
            Object.values(QUESTS || {}).forEach(q => {
                if (localPlayer.quests?.[q.id]) return;
                if (!localNpcs.includes(q.giver)) return;
                const prereqIds = Array.isArray(q.prerequisite) ? q.prerequisite : (q.prerequisite ? [q.prerequisite] : []);
                const prereqOk = prereqIds.every(pid => localPlayer.quests?.[pid]?.completed);
                if (prereqOk) addButton(`Accept: ${q.name} 📋`, `quest accept ${q.id}`);
            });
            const completable = active.filter(([qid, data]) => {
                const qDef = QUESTS[qid];
                const count = qDef?.objective?.count || 1;
                return data.progress >= count && (qDef.receiver === null || localNpcs.includes(qDef.receiver));
            });
            completable.forEach(([qid]) => {
                const qDef = QUESTS[qid];
                if (qDef) addButton(`Complete: ${qDef.name} ✅`, `quest complete ${qid}`);
            });
            const inProgress = active.filter(([qid]) => !completable.find(([cid]) => cid === qid));
            inProgress.forEach(([qid, data]) => {
                const qDef = QUESTS[qid];
                if (!qDef) return;
                const count = qDef.objective?.count || 1;
                addButton(`${qDef.name} (${data.progress}/${count})`, 'quest list');
            });
            if (active.length === 0 && completable.length === 0) {
                addButton('No active quests', () => { uiState = 'root'; renderActionButtons(ctx, onAction); });
            }
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'craft') {
            const craftableHere = (RECIPES || []).filter(r => r.location === localPlayer.location);
            craftableHere.forEach(r => {
                const inputs = Object.entries(r.inputs).map(([id, n]) => `${n}x ${ITEMS[id]?.name || id}`).join(', ');
                addButton(`${ITEMS[r.output]?.name || r.output} (${inputs})`, `craft ${r.id}`);
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'help') {
            addButton('Controls 📱', () => onAction('help-controls'));
            addButton('Keys ⌨️', () => onAction('help-keys'));
            addButton('About 📖', () => onAction('help'));
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'settings') {
            const inputContainer = getInputContainerEl();
            const input = getInputEl();
            const isVisible = !!inputContainer && !inputContainer.classList.contains('is-hidden');
            addButton(isVisible ? 'Hide Text Input' : 'Show Text Input', () => {
                if (inputContainer) {
                    inputContainer.classList.toggle('is-hidden', isVisible);
                    if (!isVisible) input?.focus();
                }
            });
            const debug = localStorage.getItem(`${GAME_NAME}_debug`) === 'true';
            addButton(debug ? 'Disable Net Debug' : 'Enable Net Debug', () => localStorage.setItem(`${GAME_NAME}_debug`, debug ? 'false' : 'true'));
            addButton('Rename Character 👤', async () => {
                const name = await requestTextInput({
                    title: 'Rename character',
                    initialValue: localPlayer.name,
                    maxLength: 14,
                    placeholder: 'name...',
                });
                if (name) onAction(`rename ${name}`);
            });
            addButton('Score 🏆', 'score');
            addButton('Net Status 📡', 'net');
            addButton('Map 🗺️', 'map');
            addButton('Back ⬅️', ACTION.CANCEL);
        }
    } catch (err) {
        console.error('[UI] renderActionButtons crash:', err);
    }
};
