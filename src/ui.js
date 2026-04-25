import { worldState } from './store.js';

const output = document.getElementById('output');

/**
 * Juiced logging: creates a new div for each line with a fade-in animation.
 */
export const log = (msg, color = '#0f0') => {
    if (!output) {
        console.log(`[LOG] ${msg}`);
        return;
    }

    const line = document.createElement('div');
    line.className = 'log-line';
    line.style.color = color;
    line.textContent = msg;
    
    output.appendChild(line);
    
    // Auto-scroll to bottom
    output.scrollTop = output.scrollHeight;

    // Prune very old lines for performance if needed
    if (output.childNodes.length > 500) {
        output.removeChild(output.firstChild);
    }
};

/**
 * Triggers a screen shake effect by adding a CSS class to the body.
 */
export const triggerShake = () => {
    document.body.classList.add('shake');
    setTimeout(() => {
        document.body.classList.remove('shake');
    }, 200);
};

const actionButtonsEl = document.getElementById('action-buttons');

let uiState = 'root'; // 'root', 'move', 'use', 'talk', 'buy', 'settings'

/**
 * Renders context-aware action buttons for quick mobile play.
 */
export const renderActionButtons = (ctx, onAction) => {
    if (!actionButtonsEl) return;
    actionButtonsEl.innerHTML = '';
    
    const { localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;

    const addButton = (label, action) => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (typeof action === 'string') {
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
        addButton('Look 👁️', 'look');
        addButton('Move 🧭', () => uiState = 'move');
        
        if (loc.enemy) {
            const enemyDef = ENEMIES[loc.enemy];
            const label = (localPlayer.currentEnemy && localPlayer.currentEnemy.hp > 0) 
                ? `Strike ${enemyDef.name} ⚔️` 
                : `Attack ${enemyDef.name} ⚔️`;
            addButton(label, 'attack');
        }

        if (localPlayer.inventory.length > 0) {
            addButton('Use 🎒', () => uiState = 'use');
        }

        const localNpcs = Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);
        if (localNpcs.length > 0) {
            addButton('Talk 💬', () => uiState = 'talk');
            if (localNpcs.some(id => NPCS[id].role === 'shop')) {
                addButton('Buy 💰', () => uiState = 'buy');
            }
        }

        addButton('Say 🗣️', 'say');
        
        if (!localPlayer.currentEnemy) {
            addButton('Rest 💤', 'rest');
        }

        addButton('Stats 📊', 'stats');
        addButton('Quests 📜', () => uiState = 'quests');
        addButton('Config ⚙️', () => uiState = 'settings');

    } else if (uiState === 'quests') {
        const { QUESTS } = ctx;
        const active = Object.entries(localPlayer.quests).filter(([, q]) => !q.completed);
        if (active.length === 0) {
            addButton('No Active Quests', () => uiState = 'root');
        } else {
            active.forEach(([qid]) => {
                const qDef = QUESTS[qid];
                addButton(`${qDef ? qDef.name : qid}`, `quest list`);
            });
        }
        addButton('Back ⬅️', () => uiState = 'root');

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
            if (item && item.type === 'consumable') {
                addButton(`${item.name}`, `use ${item.name.toLowerCase()}`);
            }
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'talk') {
        const localNpcs = Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);
        localNpcs.forEach(id => {
            addButton(`${NPCS[id].name}`, `talk ${id}`);
        });
        addButton('Back ⬅️', () => uiState = 'root');

    } else if (uiState === 'buy') {
        const localNpcs = Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);
        const shopNpc = localNpcs.find(id => NPCS[id].role === 'shop');
        if (shopNpc && NPCS[shopNpc].shop) {
            NPCS[shopNpc].shop.forEach(itemId => {
                const item = ITEMS[itemId];
                if (item) addButton(`${item.name} (${item.price}g)`, `buy ${item.name.toLowerCase()}`);
            });
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
