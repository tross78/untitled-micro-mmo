import { NPCS, ENEMIES, ITEMS, RECIPES, QUESTS } from '../engine/data.js';
import { ACTION } from '../engine/input.js';
import { GAME_NAME } from '../engine/data.js';
import { players } from '../state/store.js';
import { refreshStatusBar } from './status.js';

let uiState = 'root';
let _lastAction = null;

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
        const actionButtonsEl = document.getElementById('action-buttons');
        if (!actionButtonsEl) return;
        actionButtonsEl.innerHTML = '';
        
        const { localPlayer, world, worldState, getNPCLocation, shardEnemies, pendingDuel } = ctx;
        if (!localPlayer || !world) return;

        const loc = world[localPlayer.location];
        if (!loc) return;

        refreshStatusBar(localPlayer, world);

        const addButton = (label, action) => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.textContent = label;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof action === 'string') {
                    _lastAction = action;
                    onAction(action);
                    uiState = 'root';
                    renderActionButtons(ctx, onAction);
                } else if (typeof action === 'function') {
                    action();
                    renderActionButtons(ctx, onAction);
                }
            });
            actionButtonsEl.appendChild(btn);
        };

        const localNpcs = Object.keys(NPCS || {}).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);

        if (uiState === 'root') {
            if (pendingDuel && Date.now() <= pendingDuel.expiresAt) {
                addButton(`Accept Duel vs ${pendingDuel.challengerName} ⚔️`, 'accept');
                addButton('Decline Duel', 'decline');
            }
            if (_lastAction === 'attack' && loc.enemy && localPlayer.currentEnemy) {
                addButton('Attack Again ⚔️', ACTION.ATTACK);
            }

            addButton('Move 🧭', () => { uiState = 'move'; renderActionButtons(ctx, onAction); });
            
            if (loc.enemy) {
                const enemyDef = ENEMIES[loc.enemy];
                if (enemyDef) {
                    const sharedEnemy = shardEnemies?.get(localPlayer.location);
                    const enemyDead = sharedEnemy && sharedEnemy.hp <= 0;
                    if (!(enemyDead && localPlayer.forestFights <= 0)) {
                        const label = (localPlayer.currentEnemy && localPlayer.currentEnemy.hp > 0)
                            ? `Strike ${enemyDef.name} ⚔️`
                            : `Attack ${enemyDef.name} ⚔️`;
                        addButton(label, ACTION.ATTACK);
                    }
                    if (localPlayer.currentEnemy) {
                        addButton('Flee 🏃', 'flee');
                    }
                }
            }

            if ((localPlayer.inventory || []).length > 0) {
                addButton('Inventory 🎒', ACTION.INVENTORY);
                addButton('Use 🧪', () => { uiState = 'use'; renderActionButtons(ctx, onAction); });
                if (localPlayer.inventory.some(id => ITEMS[id] && (ITEMS[id].type === 'weapon' || ITEMS[id].type === 'armor'))) {
                    addButton('Equip ⚔️', () => { uiState = 'equip'; renderActionButtons(ctx, onAction); });
                }
            }

            const sharedEnemy = shardEnemies?.get(localPlayer.location);
            if (sharedEnemy && sharedEnemy.hp <= 0 && sharedEnemy.loot && sharedEnemy.loot.length > 0) {
                addButton('Pickup 📦', ACTION.INTERACT);
            }

            if (localNpcs.length > 0) {
                addButton('Talk 💬', () => { uiState = 'talk'; renderActionButtons(ctx, onAction); });
                if (localNpcs.some(id => NPCS[id]?.role === 'shop')) {
                    addButton('Buy 💰', () => { uiState = 'buy'; renderActionButtons(ctx, onAction); });
                    if (localPlayer.inventory.some(id => ITEMS[id] && ITEMS[id].type !== 'gold' && ITEMS[id].price > 0)) {
                        addButton('Sell 💵', () => { uiState = 'sell'; renderActionButtons(ctx, onAction); });
                    }
                }
            }

            if (localPlayer.location === 'cellar') {
                addButton('Bank 🏦', () => { uiState = 'bank'; renderActionButtons(ctx, onAction); });
            }

            const craftableHere = (RECIPES || []).filter(r => r.location === localPlayer.location);
            if (craftableHere.length > 0 && !localPlayer.currentEnemy) {
                addButton('Craft ⚒️', () => { uiState = 'craft'; renderActionButtons(ctx, onAction); });
            }

            addButton('Say 🗣️', () => {
                const msg = window.prompt("What do you want to say?");
                if (msg) onAction(`say ${msg}`);
            });

            if (!localPlayer.currentEnemy) {
                addButton('Rest 💤', 'rest');
            }

            if (localPlayer.location === 'tavern' && (localPlayer.forestFights ?? 15) <= 0) {
                addButton('Vision 🔮', 'vision');
            }

            const localPeers = Array.from(players.keys()).filter(id => !players.get(id)?.ghost && players.get(id)?.location === localPlayer.location);
            if (localPeers.length > 0) {
                addButton('Trade 🤝', () => { uiState = 'trade_select'; renderActionButtons(ctx, onAction); });
                addButton('Duel ⚔️', () => { uiState = 'duel_select'; renderActionButtons(ctx, onAction); });
            }

            addButton('Quests 📜', () => { uiState = 'quests'; renderActionButtons(ctx, onAction); });
            addButton('Config ⚙️', () => { uiState = 'settings'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'trade_select') {
            const localPeers = Array.from(players.keys()).filter(id => !players.get(id)?.ghost && players.get(id)?.location === localPlayer.location);
            localPeers.forEach(id => {
                const name = players.get(id).name || `Peer-${id.slice(0, 4)}`;
                addButton(`${name}`, () => {
                    onAction(`trade ${id}`);
                    uiState = 'trade_session';
                });
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'duel_select') {
            const localPeers = Array.from(players.keys()).filter(id => !players.get(id)?.ghost && players.get(id)?.location === localPlayer.location);
            localPeers.forEach(id => {
                const name = players.get(id).name || `Peer-${id.slice(0, 4)}`;
                addButton(`⚔️ ${name}`, () => {
                    onAction(`duel ${id}`);
                    uiState = 'root';
                });
            });
            addButton('Back ⬅️', ACTION.CANCEL);

        } else if (uiState === 'trade_session') {
            const { pendingTrade } = ctx;
            if (!pendingTrade) {
                addButton('Waiting...', () => { uiState = 'root'; renderActionButtons(ctx, onAction); });
                addButton('Cancel', () => { uiState = 'root'; renderActionButtons(ctx, onAction); });
            } else {
                addButton(`Offer Gold (${pendingTrade.myOffer.gold})`, () => { uiState = 'trade_offer_gold'; renderActionButtons(ctx, onAction); });
                addButton(`Offer Items (${pendingTrade.myOffer.items.length})`, () => { uiState = 'trade_offer_items'; renderActionButtons(ctx, onAction); });
                const canSign = pendingTrade.myOffer.gold > 0 || pendingTrade.myOffer.items.length > 0 || pendingTrade.partnerOffer.gold > 0 || pendingTrade.partnerOffer.items.length > 0;
                if (canSign) {
                    addButton(pendingTrade.signatures.me ? '✅ Signed' : 'Sign Trade 📝', () => onAction('trade commit'));
                }
                addButton('Cancel Trade', () => { onAction('trade cancel'); uiState = 'root'; });
            }

        } else if (uiState === 'trade_offer_gold') {
            [10, 50, 100].forEach(amt => {
                if (localPlayer.gold >= amt) addButton(`${amt} Gold`, () => { onAction(`trade offer gold ${amt}`); uiState = 'trade_session'; });
            });
            addButton('Back ⬅️', () => { uiState = 'trade_session'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'trade_offer_items') {
            const { pendingTrade } = ctx;
            if (pendingTrade) {
                localPlayer.inventory.forEach((id) => {
                    const item = ITEMS[id];
                    if (item && !pendingTrade.myOffer.items.includes(id)) {
                        addButton(item.name, () => { onAction(`trade offer item ${id}`); uiState = 'trade_session'; });
                    }
                });
            }
            addButton('Back ⬅️', () => { uiState = 'trade_session'; renderActionButtons(ctx, onAction); });

        } else if (uiState === 'move') {
            Object.keys(loc.exits || {}).forEach(dir => {
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
            if (shopNpc && NPCS[shopNpc].shop) {
                NPCS[shopNpc].shop.forEach(itemId => {
                    const item = ITEMS[itemId];
                    if (item) {
                        let label = `${item.name} (${item.price}g)`;
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
                    const price = Math.floor(item.price * 0.4);
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
                const prereqOk = !q.prerequisite || localPlayer.quests[q.prerequisite]?.completed;
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

        } else if (uiState === 'settings') {
            const inputContainer = document.getElementById('input-container');
            const isVisible = inputContainer && inputContainer.style.display !== 'none';
            addButton(isVisible ? 'Hide Text Input' : 'Show Text Input', () => {
                if (inputContainer) {
                    inputContainer.style.display = isVisible ? 'none' : 'flex';
                    if (!isVisible) inputContainer.querySelector('input').focus();
                }
            });
            const debug = localStorage.getItem(`${GAME_NAME}_debug`) === 'true';
            addButton(debug ? 'Disable Net Debug' : 'Enable Net Debug', () => localStorage.setItem(`${GAME_NAME}_debug`, debug ? 'false' : 'true'));
            addButton('Rename Character 👤', () => {
                const name = window.prompt("Enter new name (max 14 chars):", localPlayer.name);
                if (name) onAction(`rename ${name}`);
            });
            addButton('Score 🏆', 'score');
            addButton('Net Status 📡', 'net');
            addButton('Map 🗺️', 'map');
            addButton('Keys ⌨️', () => {
                // Return action to main coordinator to avoid direct log() import loop
                onAction('help-keys');
            });
            addButton('Back ⬅️', ACTION.CANCEL);
        }
    } catch (err) {
        console.error('[UI] renderActionButtons crash:', err);
    }
};
