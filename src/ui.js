import { worldState, players } from './store.js';
import { levelBonus, seededRNG, hashStr } from './rules.js';
import { GAME_NAME, CORPORA } from './data.js';
import { generateSentence } from './markov.js';
import { EventBus } from './events.js';

const output = document.getElementById('output');
const radarEl = document.getElementById('radar-container');

let lastLogMsg = '';
let lastLogColor = '';
let lastLogCount = 1;
let lastLogEl = null;

/**
 * Juiced logging: creates a new div for each line with a fade-in animation.
 * Consolidates consecutive duplicates (e.g. combat hits).
 */
const _injectLog = (msg, color = '#0f0') => {
    if (!output) {
        console.log(`[LOG] ${msg}`);
        return;
    }

    if (msg === lastLogMsg && color === lastLogColor && lastLogEl) {
        lastLogCount++;
        // Strip the existing counter if present to avoid (x2)(x3)
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

    // Auto-scroll to bottom
    output.scrollTop = output.scrollHeight;

    // Prune very old lines for performance
    if (output.childNodes.length > 500) {
        output.removeChild(output.firstChild);
    }
};

export const log = (msg, color = '#0f0') => {
    EventBus.emit('log', { msg, color });
};

/**
 * Returns an ASCII health bar.
 */
export const getHealthBar = (current, max, length = 10) => {
    const filledLength = Math.max(0, Math.min(length, Math.round((current / max) * length)));
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

const actionButtonsEl = document.getElementById('action-buttons');

let uiState = 'root'; // 'root', 'move', 'use', 'talk', 'buy', 'settings'
let _lastAction = null;

/**
 * Renders context-aware action buttons for quick mobile play.
 */
export const renderActionButtons = (ctx, onAction) => {
    if (!actionButtonsEl) return;
    actionButtonsEl.innerHTML = '';
    
    const { localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, shardEnemies } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;

    // Refresh Status Bar
    const statusLeft = document.getElementById('status-left');
    const statusCenter = document.getElementById('status-center');
    const statusRight = document.getElementById('status-right');
    if (statusLeft && statusCenter && statusRight) {
        const bonus = (typeof levelBonus === 'function') ? levelBonus(localPlayer.level) : { maxHp: (localPlayer.level-1)*10 };
        const maxHp = localPlayer.maxHp + (bonus.maxHp || 0) + (localPlayer.buffs?.rested ? 5 : 0);
        statusLeft.textContent = `Lvl ${localPlayer.level} HP: ${localPlayer.hp}/${maxHp}`;
        statusCenter.textContent = `${loc.name}`;
        statusRight.textContent = `${localPlayer.gold}g`;
    }

    const addButton = (label, action) => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (typeof action === 'string') {
                _lastAction = action;
                onAction(action);
                uiState = 'root'; // Reset to root after most actions
                renderActionButtons(ctx, onAction);
            } else if (typeof action === 'function') {
                action();
                renderActionButtons(ctx, onAction);
            }
        });
        actionButtonsEl.appendChild(btn);
    };

    if (uiState === 'root') {
        // Action Memory
        if (_lastAction === 'attack' && loc.enemy && localPlayer.currentEnemy) {
            addButton('Attack Again ⚔️', 'attack');
        }

        // 'Look' and 'Stats' removed - info is in status bar or log
        addButton('Move 🧭', () => uiState = 'move');
        
        if (loc.enemy) {
            const enemyDef = ENEMIES[loc.enemy];
            const sharedEnemy = shardEnemies?.get(localPlayer.location);
            const enemyAlive = sharedEnemy && sharedEnemy.hp > 0;
            const enemyDead = sharedEnemy && sharedEnemy.hp <= 0;
            // Hide attack button entirely if enemy is dead and player has no fights left
            if (!(enemyDead && localPlayer.forestFights <= 0)) {
                const label = (localPlayer.currentEnemy && localPlayer.currentEnemy.hp > 0)
                    ? `Strike ${enemyDef.name} ⚔️`
                    : `Attack ${enemyDef.name} ⚔️`;
                addButton(label, 'attack');
            }
            if (localPlayer.currentEnemy) {
                addButton('Flee 🏃', 'flee');
            }
        }

        if (localPlayer.inventory.length > 0) {
            addButton('Use 🎒', () => uiState = 'use');
        }

        const localNpcs = worldState.seed
            ? Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location)
            : [];
        if (localNpcs.length > 0) {
            addButton('Talk 💬', () => uiState = 'talk');
            if (localNpcs.some(id => NPCS[id].role === 'shop')) {
                addButton('Buy 💰', () => uiState = 'buy');
            }
        }

        if (localPlayer.location === 'cellar') {
            addButton('Bank 🏦', () => uiState = 'bank');
        }

        addButton('Say 🗣️', () => {
            const msg = window.prompt("What do you want to say?");
            if (msg) onAction(`say ${msg}`);
        });

        if (!localPlayer.currentEnemy) {
            addButton('Rest 💤', 'rest');
        }

        if (localPlayer.location === 'tavern' && localPlayer.forestFights <= 0) {
            addButton('Vision 🔮', 'vision');
        }

        const localPeers = Array.from(players.keys()).filter(id => players.get(id).location === localPlayer.location);
        if (localPeers.length > 0) {
            addButton('Trade 🤝', () => uiState = 'trade_select');
        }

        addButton('Quests 📜', () => uiState = 'quests');
        addButton('Config ⚙️', () => uiState = 'settings');

    } else if (uiState === 'trade_select') {
        const localPeers = Array.from(players.keys()).filter(id => players.get(id).location === localPlayer.location);
        localPeers.forEach(id => {
            const name = players.get(id).name || `Peer-${id.slice(0, 4)}`;
            addButton(`${name}`, () => {
                onAction(`trade ${id}`);
                uiState = 'trade_session';
            });
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'trade_session') {
        const { pendingTrade } = ctx;
        if (!pendingTrade) {
            addButton('Waiting for partner...', () => uiState = 'root');
            addButton('Cancel', () => uiState = 'root');
        } else {
            const partnerName = pendingTrade.partnerName;
            addButton(`Offer Gold (${pendingTrade.myOffer.gold})`, () => uiState = 'trade_offer_gold');
            addButton(`Offer Items (${pendingTrade.myOffer.items.length})`, () => uiState = 'trade_offer_items');
            
            const canSign = pendingTrade.myOffer.gold > 0 || pendingTrade.myOffer.items.length > 0 || pendingTrade.partnerOffer.gold > 0 || pendingTrade.partnerOffer.items.length > 0;
            if (canSign) {
                addButton(pendingTrade.signatures.me ? '✅ Signed' : 'Sign Trade 📝', () => {
                    onAction('trade commit');
                });
            }
            addButton('Cancel Trade', () => {
                onAction('trade cancel');
                uiState = 'root';
            });
        }

    } else if (uiState === 'trade_offer_gold') {
        [10, 50, 100].forEach(amt => {
            if (localPlayer.gold >= amt) addButton(`${amt} Gold`, () => {
                onAction(`trade offer gold ${amt}`);
                uiState = 'trade_session';
            });
        });
        addButton('Back ⬅️', () => uiState = 'trade_session');

    } else if (uiState === 'trade_offer_items') {
        const { pendingTrade } = ctx;
        localPlayer.inventory.forEach((id, idx) => {
            const item = ITEMS[id];
            if (item && !pendingTrade.myOffer.items.includes(id)) {
                addButton(item.name, () => {
                    onAction(`trade offer item ${id}`);
                    uiState = 'trade_session';
                });
            }
        });
        addButton('Back ⬅️', () => uiState = 'trade_session');

    } else if (uiState === 'move') {
        Object.keys(loc.exits).forEach(dir => {
            const dirEmoji = { north: '⬆️', south: '⬇️', east: '➡️', west: '⬅️', up: '⤴️', down: '⤵️' }[dir] || '➡️';
            addButton(`${dir.charAt(0).toUpperCase() + dir.slice(1)} ${dirEmoji}`, `move ${dir}`);
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'use') {
        const uniqueItems = Array.from(new Set(localPlayer.inventory));
        uniqueItems.forEach(id => {
            const item = ITEMS[id];
            if (item && (item.type === 'consumable' || item.type === 'buff')) {
                let label = `${item.name}`;
                if (item.heal) label += ` (+${item.heal}hp)`;
                if (item.atkBonus) label += ` (+${item.atkBonus}atk)`;
                addButton(label, `use ${item.name.toLowerCase()}`);
            }
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'talk') {
        const localNpcs = worldState.seed
            ? Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location)
            : [];
        localNpcs.forEach(id => {
            addButton(`${NPCS[id].name}`, `talk ${id}`);
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'buy') {
        const localNpcs = worldState.seed
            ? Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location)
            : [];
        const shopNpc = localNpcs.find(id => NPCS[id].role === 'shop');
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
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'bank') {
        addButton('Deposit 📥', () => uiState = 'bank_deposit');
        addButton('Withdraw 📤', () => uiState = 'bank_withdraw');
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'bank_deposit') {
        if (localPlayer.gold >= 10) addButton('10 Gold', 'bank deposit 10');
        if (localPlayer.gold >= 50) addButton('50 Gold', 'bank deposit 50');
        if (localPlayer.gold > 0) addButton('All Gold', `bank deposit ${localPlayer.gold}`);
        addButton('Back ⬅️', () => uiState = 'bank');

    } else if (uiState === 'bank_withdraw') {
        if (localPlayer.bankedGold >= 10) addButton('10 Gold', 'bank withdraw 10');
        if (localPlayer.bankedGold >= 50) addButton('50 Gold', 'bank withdraw 50');
        if (localPlayer.bankedGold > 0) addButton('All Gold', `bank withdraw ${localPlayer.bankedGold}`);
        addButton('Back ⬅️', () => uiState = 'bank');

    } else if (uiState === 'quests') {
        const active = Object.entries(localPlayer.quests).filter(([, q]) => !q.completed);
        const localNpcs = worldState.seed
            ? Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location)
            : [];
        
        // 1. Quests available to Accept here
        localNpcs.forEach(nid => {
            const qid = NPCS[nid].questId;
            if (qid && !localPlayer.quests[qid]) {
                addButton(`Accept ${QUESTS[qid].name}`, `quest accept ${qid}`);
            }
        });

        // 2. Active Quests (Complete if possible)
        active.forEach(([qid, data]) => {
            const qDef = QUESTS[qid];
            const canComplete = data.progress >= qDef.count && localNpcs.some(nid => NPCS[nid].questId === qid);
            const label = canComplete ? `Complete ${qDef.name} ✅` : `${qDef.name} (${data.progress}/${qDef.count})`;
            addButton(label, canComplete ? `quest complete ${qid}` : 'quest list');
        });

        if (active.length === 0 && !localNpcs.some(nid => NPCS[nid].questId && !localPlayer.quests[NPCS[nid].questId])) {
            addButton('No Quests Available', () => uiState = 'root');
        }
        addButton('Back ⬅️', () => uiState = 'root');

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
        addButton(debug ? 'Disable Net Debug' : 'Enable Net Debug', () => {
            localStorage.setItem(`${GAME_NAME}_debug`, debug ? 'false' : 'true');
        });

        addButton('Rename Character 👤', () => {
            const name = window.prompt("Enter new name (max 14 chars):", localPlayer.name);
            if (name) onAction(`rename ${name}`);
        });
        
        addButton('Score 🏆', 'score');
        addButton('Net Status 📡', 'net');
        addButton('Map 🗺️', 'map');
        addButton('Back ⬅️', () => uiState = 'root');
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

/**
 * Starts the ambient lore ticker.
 */
export const startTicker = (worldState) => {
    const tickerEl = document.getElementById('ticker');
    if (!tickerEl) return;

    const updateTicker = () => {
        if (!worldState.seed) return;
        
        tickerEl.style.opacity = '0';
        
        setTimeout(() => {
            // Seeded by seed + current 30s interval for stability
            const interval = Math.floor(Date.now() / 30000);
            const rng = seededRNG(hashStr(worldState.seed + interval + 'ticker'));
            const msg = generateSentence(CORPORA.ticker, rng);
            
            tickerEl.textContent = msg;
            tickerEl.style.opacity = '1';
        }, 500);
    };

    updateTicker();
    setInterval(updateTicker, 30000);
};

/**
 * Renders the 2D Spatial Radar.
 */
export const renderRadar = (ctx, onTileClick) => {
    if (!radarEl) return;
    const { localPlayer, world, players, shardEnemies, NPCS, getNPCLocation, worldState } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;

    radarEl.innerHTML = '';
    radarEl.style.gridTemplateColumns = `repeat(${loc.width}, 1fr)`;
    radarEl.style.gridTemplateRows = `repeat(${loc.height}, 1fr)`;

    const grid = Array.from({ length: loc.height }, () => Array(loc.width).fill(null));

    // 1. Scenery (Obstacles/Buildings)
    (loc.scenery || []).forEach(s => {
        if (s.x < loc.width && s.y < loc.height) {
            grid[s.y][s.x] = { type: 'scenery', label: s.label || 'B' };
        }
    });

    // 2. Portals
    (loc.portals || []).forEach(p => {
        if (p.x < loc.width && p.y < loc.height) {
            grid[p.y][p.x] = { type: 'portal', label: '∏' };
        }
    });

    // 3. Shard Enemies
    const sharedEnemy = shardEnemies.get(localPlayer.location);
    if ((sharedEnemy && sharedEnemy.hp > 0) || (loc.enemy && !sharedEnemy)) {
        const ex = loc.enemyX ?? Math.floor(loc.width / 2);
        const ey = loc.enemyY ?? Math.floor(loc.height / 2);
        if (ex < loc.width && ey < loc.height) {
            grid[ey][ex] = { type: 'enemy', label: 'E' };
        }
    }

    // 4. NPCs (Static + Patrolling) — skip if seed not yet synced from arbiter
    if (worldState.seed) Object.keys(NPCS).forEach(id => {
        const npcLoc = getNPCLocation(id, worldState.seed, worldState.day);
        if (npcLoc === localPlayer.location) {
            // Find static coords if they exist
            const staticNpc = (loc.staticEntities || []).find(e => e.id === id);
            let nx, ny;
            if (staticNpc) {
                nx = staticNpc.x;
                ny = staticNpc.y;
            } else {
                // Deterministic patrol position based on ID string
                const hash = hashStr(id + localPlayer.location);
                const wRange = Math.max(1, loc.width - 2);
                const hRange = Math.max(1, loc.height - 2);
                nx = (hash % wRange) + 1;
                ny = ((hash >> 4) % hRange) + 1;
            }
            if (nx < loc.width && ny < loc.height) {
                grid[ny][nx] = { type: 'npc', label: 'N' };
            }
        }
    });

    // 5. Peers (alive only)
    players.forEach((p, id) => {
        if (p.location === localPlayer.location && p.x !== undefined && p.hp > 0) {
            if (p.x < loc.width && p.y < loc.height) {
                grid[p.y][p.x] = { type: 'peer', label: 'P' };
            }
        }
    });

    // 6. Local Player (Always Top Layer)
    if (localPlayer.x < loc.width && localPlayer.y < loc.height) {
        grid[localPlayer.y][localPlayer.x] = { type: 'self', label: '@' };
    }

    // Draw Grid
    for (let y = 0; y < loc.height; y++) {
        for (let x = 0; x < loc.width; x++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            const entity = grid[y][x];
            if (entity) {
                tile.textContent = entity.label;
                tile.classList.add(`entity-${entity.type}`);
                if (entity.type === 'scenery') tile.style.opacity = '0.4';
            } else {
                tile.textContent = '·';
            }
            tile.addEventListener('click', () => onTileClick(x, y));
            radarEl.appendChild(tile);
        }
    }
};

// --- EVENT SUBSCRIPTIONS ---
EventBus.on('log', ({ msg, color }) => _injectLog(msg, color));
