import { worldState, players } from './store.js';
import { levelBonus, seededRNG, hashStr } from './rules.js';
import { GAME_NAME, CORPORA, RECIPES, NPCS, QUESTS, ENEMIES, ITEMS } from './data.js';
import { generateSentence } from './markov.js';
import { ACTION } from './input.js';
import { bus } from './eventbus.js';

const output = document.getElementById('output');
const radarEl = document.getElementById('radar-container');
const getActionButtonsEl = () => document.getElementById('action-buttons');

let lastLogMsg = '';
let lastLogColor = '';
let lastLogCount = 1;
let lastLogEl = null;

const _injectLog = (msg, color = '#0f0') => {
    if (!output) {
        console.log(`[LOG] ${msg}`);
        return;
    }
    if (msg === lastLogMsg && color === lastLogColor && lastLogEl) {
        lastLogCount++;
        const baseMsg = msg.replace(/\s+\(x\d+\)$/, '');
        lastLogEl.innerHTML = `${baseMsg} (x${lastLogCount})`;
        return;
    }
    const line = document.createElement('div');
    line.className = 'log-line';
    line.style.color = color;
    line.innerHTML = msg;
    output.appendChild(line);
    lastLogMsg = msg;
    lastLogColor = color;
    lastLogCount = 1;
    lastLogEl = line;
    output.scrollTop = output.scrollHeight;
    if (output.childNodes.length > 500) {
        output.removeChild(output.firstChild);
    }
};

export const log = (msg, color = '#0f0') => {
    bus.emit('log', { msg, color });
};

export const getHealthBar = (current, max, length = 10) => {
    const filledLength = Math.max(0, Math.min(length, Math.round((current / (max || 1)) * length)));
    const emptyLength = length - filledLength;
    return `[${'█'.repeat(filledLength)}${'░'.repeat(emptyLength)}]`;
};

let _shakeTimer = null;
export const triggerShake = () => {
    clearTimeout(_shakeTimer);
    document.body.classList.add('shake');
    _shakeTimer = setTimeout(() => {
        document.body.classList.remove('shake');
        _shakeTimer = null;
    }, 200);
};

let uiState = 'root';
let _lastAction = null;

export const _resetUiState = () => { uiState = 'root'; };   // test isolation helper
export const _getUiState   = () => uiState;                  // read-only test hook

bus.on('ui:back', () => {
    uiState = 'root';
});

// Reset to root whenever the player changes room — prevents stale submenus
// (e.g. being stuck in 'buy' state after moving from the Market)
bus.on('player:move', () => {
    uiState = 'root';
});

export const renderActionButtons = (ctx, onAction) => {
    try {
        const actionButtonsEl = getActionButtonsEl();
        if (!actionButtonsEl) return;
        actionButtonsEl.innerHTML = '';
        
        const { localPlayer, world, worldState, getNPCLocation, shardEnemies } = ctx;
        if (!localPlayer || !world) return;

        const loc = world[localPlayer.location];
        if (!loc) return;

        // Refresh Status Bar
        const statusLeft = document.getElementById('status-left');
        const statusCenter = document.getElementById('status-center');
        const statusRight = document.getElementById('status-right');
        if (statusLeft && statusCenter && statusRight) {
            const bonus = (typeof levelBonus === 'function') ? levelBonus(localPlayer.level) : { maxHp: (localPlayer.level-1)*10 };
            const maxHp = (localPlayer.maxHp || 50) + (bonus.maxHp || 0) + (localPlayer.buffs?.rested ? 5 : 0);
            const hpPct = localPlayer.hp / maxHp;
            const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
            statusLeft.innerHTML = `Lvl ${localPlayer.level} <span style="color:${hpColor}">HP ${localPlayer.hp}/${maxHp}</span>`;

            const eqWepId = localPlayer.equipped?.weapon;
            const eqArmId = localPlayer.equipped?.armor;
            const wepTag = eqWepId && ITEMS[eqWepId] ? ` ⚔️${ITEMS[eqWepId].name}` : '';
            const armTag = eqArmId && ITEMS[eqArmId] ? ` 🛡️${ITEMS[eqArmId].name}` : '';
            const poisoned = (localPlayer.statusEffects || []).find(s => s.id === 'poisoned') ? ' ☠️' : '';
            const rested = (localPlayer.statusEffects || []).find(s => s.id === 'well_rested') ? ' 😴' : '';
            statusCenter.textContent = `${loc.name}${wepTag}${armTag}${poisoned}${rested}`;

            const fightsLeft = localPlayer.forestFights ?? 15;
            statusRight.textContent = `${localPlayer.gold}g  ⚡${fightsLeft}`;
        }

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
                log(`\n--- Keyboard Shortcuts ---`, '#aaa');
                log(`WASD / Arrows — Move one tile`, '#aaa');
                log(`Space / E — Interact (talk / use exit)`, '#aaa');
                log(`F / Z — Attack`, '#aaa');
                log(`I / Tab — Inventory`, '#aaa');
                log(`Escape — Back / Cancel`, '#aaa');
                log(`\` (backtick) — Toggle radar view`, '#aaa');
                log(`~ (tilde) — Toggle log panel`, '#aaa');
                log(`--------------------------\n`, '#aaa');
            });
            addButton('Back ⬅️', ACTION.CANCEL);
        }
    } catch (err) {
        console.error('[UI] renderActionButtons crash:', err);
    }
};

export const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Season: ${worldState.season.toUpperCase()} ${worldState.seasonNumber} 🍂`, '#ffa500');
    log(`Day: ${worldState.day} ☀️`, '#ffa500');
    log(`Mood: ${worldState.mood.toUpperCase()} 🕯️`, '#ffa500');
    if (worldState.scarcity.length > 0) {
        log(`Scarcity: ${worldState.scarcity.join(', ')} ⚠️`, '#f55');
    }
    if (worldState.lastTick) {
        const nextTick = worldState.lastTick + (24 * 60 * 60 * 1000);
        const diff = nextTick - Date.now();
        if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            log(`Next day in ${h}h ${m}m ⏳`, '#ffa500');
        }
    }
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};

export const startTicker = (worldState, onTick) => {
    const updateTicker = () => {
        if (!worldState.seed) return;
        const interval = Math.floor(Date.now() / 30000);
        const rng = seededRNG(hashStr(worldState.seed + interval + 'ticker'));
        const msg = generateSentence(CORPORA.ticker, rng);
        if (onTick) onTick(msg);
    };
    updateTicker();
    setInterval(updateTicker, 30000);
};

export const drawRadar = (ctx, onTileClick) => {
    if (!radarEl) return;
    const { localPlayer, world, players, shardEnemies, NPCS, getNPCLocation, worldState } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;
    radarEl.innerHTML = '';
    radarEl.style.gridTemplateColumns = `repeat(${loc.width}, 1fr)`;
    radarEl.style.gridTemplateRows = `repeat(${loc.height}, 1fr)`;
    const grid = Array.from({ length: loc.height }, () => Array(loc.width).fill(null));
    (loc.scenery || []).forEach(s => {
        if (s.x < loc.width && s.y < loc.height) grid[s.y][s.x] = { type: 'scenery', label: s.label || 'B' };
    });
    (loc.exitTiles || []).forEach(p => {
        if (p.x < loc.width && p.y < loc.height) grid[p.y][p.x] = { type: 'exit', label: '▸' };
    });
    const sharedEnemy = shardEnemies.get(localPlayer.location);
    if ((sharedEnemy && sharedEnemy.hp > 0) || (loc.enemy && !sharedEnemy)) {
        const ex = loc.enemyX ?? Math.floor(loc.width / 2);
        const ey = loc.enemyY ?? Math.floor(loc.height / 2);
        if (ex < loc.width && ey < loc.height) grid[ey][ex] = { type: 'enemy', label: 'E' };
    }
    if (worldState.seed) Object.keys(NPCS || {}).forEach(id => {
        if (getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location) {
            const staticNpc = (loc.staticEntities || []).find(e => e.id === id);
            let nx, ny;
            if (staticNpc) { nx = staticNpc.x; ny = staticNpc.y; }
            else {
                const hash = hashStr(id + localPlayer.location);
                nx = (hash % Math.max(1, loc.width - 2)) + 1;
                ny = ((hash >> 4) % Math.max(1, loc.height - 2)) + 1;
            }
            if (nx < loc.width && ny < loc.height) grid[ny][nx] = { type: 'npc', label: 'N' };
        }
    });
    players.forEach((p, _id) => {
        if (!p.ghost && p.location === localPlayer.location && p.x !== undefined) {
            if (p.x < loc.width && p.y < loc.height) grid[p.y][p.x] = { type: 'peer', label: 'P' };
        }
    });
    if (localPlayer.x < loc.width && localPlayer.y < loc.height) grid[localPlayer.y][localPlayer.x] = { type: 'self', label: '@' };
    for (let y = 0; y < loc.height; y++) {
        for (let x = 0; x < loc.width; x++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            const entity = grid[y][x];
            if (entity) {
                tile.textContent = entity.label;
                tile.classList.add(`entity-${entity.type}`);
                if (entity.type === 'scenery') tile.style.opacity = '0.4';
            } else { tile.textContent = '·'; }
            tile.addEventListener('click', () => onTileClick(x, y));
            radarEl.appendChild(tile);
        }
    }
};

bus.on('log', ({ msg, color }) => _injectLog(msg, color));
bus.on('combat:hit', ({ attacker, target, damage, crit, targetHP, targetMaxHP }) => {
    let msg = crit ? `<b>CRITICAL HIT!</b> ${attacker} hit ${target} for ${damage}.` : `${attacker} hit ${target} for ${damage}.`;
    if (targetHP !== undefined) msg += ` ${getHealthBar(targetHP, targetMaxHP)}`;
    _injectLog(msg, attacker === 'You' ? '#0f0' : '#f55');
});
bus.on('combat:dodge', ({ attacker, target }) => _injectLog(`${target} dodged ${attacker}'s attack!`, '#0af'));
bus.on('combat:death', ({ entity }) => _injectLog(`${entity} has been defeated!`, '#ff0'));
bus.on('player:levelup', ({ level }) => _injectLog(`LEVEL UP! You are now level ${level}! ✨`, '#ff0'));
bus.on('npc:speak', ({ npcName, text }) => _injectLog(`[Talk] ${npcName}: "${text}"`, '#0ff'));
bus.on('item:pickup', ({ item }) => _injectLog(`You picked up ${item.name}.`, '#ff0'));
bus.on('quest:progress', ({ name, current, total }) => _injectLog(`[Quest] ${name} progress: ${current}/${total}`, '#ff0'));
bus.on('quest:complete', ({ name, rewards }) => {
    _injectLog(`[Quest] COMPLETED: ${name}!`, '#0f0');
    _injectLog(`[Quest] Reward: ${rewards.xp} XP, ${rewards.gold} Gold`, '#ff0');
});
bus.on('chat:say', ({ name, text }) => _injectLog(`[Chat] ${name}: "${text}"`, '#fff'));
bus.on('world:timeOfDay', ({ day, timeOfDay }) => {
    const label = timeOfDay === 'night' ? 'Night falls' : 'Dawn breaks';
    _injectLog(`[World] ${label} — Day ${day}.`, '#0af');
});
