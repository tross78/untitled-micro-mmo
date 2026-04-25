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

/**
 * Renders context-aware action buttons for quick mobile play.
 */
export const renderActionButtons = (ctx, onAction) => {
    if (!actionButtonsEl) return;
    actionButtonsEl.innerHTML = '';
    
    const { localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;

    const addButton = (label, cmd) => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => onAction(cmd));
        actionButtonsEl.appendChild(btn);
    };

    // 1. Exploration
    addButton('Look 👁️', 'look');
    Object.keys(loc.exits).forEach(dir => {
        const dirEmoji = { north: '⬆️', south: '⬇️', east: '➡️', west: '⬅️' }[dir] || '';
        addButton(`${dir.charAt(0).toUpperCase() + dir.slice(1)} ${dirEmoji}`, `move ${dir}`);
    });

    // 2. Combat
    if (loc.enemy) {
        const enemyName = ENEMIES[loc.enemy]?.name || 'Enemy';
        addButton(`Attack ${enemyName} ⚔️`, 'attack');
    }
    
    // 3. Social / NPCs
    const npcs = Object.keys(NPCS).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);
    npcs.forEach(id => {
        const npc = NPCS[id];
        addButton(`Talk ${npc.name} 💬`, `talk ${id}`);
        if (npc.role === 'shop') addButton(`Shop 💰`, 'buy');
    });

    // 4. Recovery
    if (!localPlayer.currentEnemy) {
        addButton('Rest 💤', 'rest');
    }

    // 5. Utility
    addButton('Inv 🎒', 'inventory');
    addButton('Stats 📊', 'stats');
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
