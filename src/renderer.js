import { drawTile, generateCharacterSprite, zoneTileType } from './graphics.js';
import { drawRadar } from './ui.js';
import { VIEWPORT_W, VIEWPORT_H, TILE_PX } from './constants.js';

// Logical tile size on screen — 3× pixel-art upscale
const SCALE = 3;
const S = TILE_PX * SCALE;           // pixels per tile on canvas (48)
const CW = VIEWPORT_W * S;           // canvas width  (720)
const CH = VIEWPORT_H * S;           // canvas height (528)

let _canvas = null;
let _radarEl = null;
let _devMode = false;                 // backtick toggles this

// Sprite cache — avoid re-generating per frame
const _spriteCache = new Map();
function getSprite(seed, type) {
    const key = `${seed}:${type}`;
    if (!_spriteCache.has(key)) _spriteCache.set(key, generateCharacterSprite(seed, type));
    return _spriteCache.get(key);
}

function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9) >>> 0; }
    return h;
}

function initCanvas() {
    if (_canvas) return;
    _radarEl = document.getElementById('radar-container');

    _canvas = document.createElement('canvas');
    _canvas.id = 'game-canvas';
    _canvas.width = CW;
    _canvas.height = CH;
    _canvas.style.cssText = `
        display:block; width:100%; max-height:45vh;
        image-rendering:pixelated; image-rendering:crisp-edges;
        cursor:pointer; background:#000; border-bottom:1px solid #111;
    `;

    if (_radarEl) _radarEl.insertAdjacentElement('beforebegin', _canvas);
    if (_radarEl) _radarEl.style.display = 'none';

    // Backtick dev toggle
    window.addEventListener('keydown', (e) => {
        if (e.key === '`' && !e.target.matches('input,textarea')) {
            toggleDevRadar();
        }
    });
}

export function toggleDevRadar() {
    _devMode = !_devMode;
    if (_canvas) _canvas.style.display = _devMode ? 'none' : 'block';
    if (_radarEl) _radarEl.style.display = _devMode ? 'grid' : 'none';
    console.log(`[Dev] ${_devMode ? 'Radar' : 'Canvas'} view active. Press \` to toggle.`);
}

export function renderWorld(state, onTileClick) {
    if (_devMode) {
        drawRadar(state, onTileClick);
        return;
    }

    initCanvas();
    const ctx = _canvas.getContext('2d');
    const { localPlayer, world, players, shardEnemies, NPCS, getNPCLocation, worldState, ENEMIES } = state;
    const loc = world[localPlayer.location];
    if (!loc) return;

    const tileType = zoneTileType(localPlayer.location);

    // Camera: center on player, clamped so we never show out-of-bounds tiles
    const camX = Math.max(0, Math.min(loc.width  - VIEWPORT_W, localPlayer.x - Math.floor(VIEWPORT_W / 2)));
    const camY = Math.max(0, Math.min(loc.height - VIEWPORT_H, localPlayer.y - Math.floor(VIEWPORT_H / 2)));

    // --- TILES ---
    for (let ty = 0; ty < VIEWPORT_H; ty++) {
        for (let tx = 0; tx < VIEWPORT_W; tx++) {
            const wx = camX + tx;
            const wy = camY + ty;
            const seed = hashStr(localPlayer.location) ^ (wx * 7919) ^ (wy * 6271);
            drawTile(ctx, tileType, tx * S, ty * S, seed, S);
        }
    }

    // --- EXITS ---
    ( loc.exitTiles || []).forEach(p => {
        const sx = p.x - camX;
        const sy = p.y - camY;
        if (sx < 0 || sx >= VIEWPORT_W || sy < 0 || sy >= VIEWPORT_H) return;
        drawTile(ctx, 'exit', sx * S, sy * S, 0, S);
        const destName = world[p.dest]?.name || p.dest;
        ctx.fillStyle = '#cc88ff';
        ctx.font = `bold ${Math.floor(S * 0.3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(destName.split(' ')[0], sx * S + S / 2, sy * S + 1);
    });

    // --- SCENERY ---
    (loc.scenery || []).forEach(sc => {
        const sx = sc.x - camX;
        const sy = sc.y - camY;
        if (sx < 0 || sx >= VIEWPORT_W || sy < 0 || sy >= VIEWPORT_H) return;
        ctx.fillStyle = '#2a3a2a';
        ctx.fillRect(sx * S + 2, sy * S + 2, S - 4, S - 4);
        ctx.fillStyle = '#668855';
        ctx.font = `${Math.floor(S * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sc.label || '■', sx * S + S / 2, sy * S + S / 2);
    });

    // --- STATIC ENTITIES (NPCs) ---
    const localNpcs = worldState.seed
        ? Object.keys(NPCS || {}).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location)
        : [];
    localNpcs.forEach(id => {
        const npc = NPCS[id];
        const se = (loc.staticEntities || []).find(e => e.id === id);
        if (!se) return;
        const sx = se.x - camX;
        const sy = se.y - camY;
        if (sx < 0 || sx >= VIEWPORT_W || sy < 0 || sy >= VIEWPORT_H) return;
        const sprite = getSprite(hashStr(id), 'npc');
        ctx.drawImage(sprite, sx * S + Math.floor(S * 0.15), sy * S, Math.floor(S * 0.7), S);
        ctx.fillStyle = '#ffdd00';
        ctx.font = `${Math.floor(S * 0.28)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(npc.name.split(' ')[0], sx * S + S / 2, sy * S);
    });

    // --- ENEMY ---
    const sharedEnemy = shardEnemies.get(localPlayer.location);
    if (loc.enemy && (!sharedEnemy || sharedEnemy.hp > 0)) {
        const ex = (loc.enemyX ?? Math.floor(loc.width / 2)) - camX;
        const ey = (loc.enemyY ?? Math.floor(loc.height / 2)) - camY;
        if (ex >= 0 && ex < VIEWPORT_W && ey >= 0 && ey < VIEWPORT_H) {
            const edef = ENEMIES?.[loc.enemy];
            const sprite = getSprite(hashStr(loc.enemy), 'enemy');
            ctx.drawImage(sprite, ex * S + Math.floor(S * 0.1), ey * S, Math.floor(S * 0.8), S);
            // HP bar above enemy if damaged
            if (sharedEnemy && sharedEnemy.hp < sharedEnemy.maxHp) {
                const pct = sharedEnemy.hp / sharedEnemy.maxHp;
                const bw = S - 4;
                ctx.fillStyle = '#440000';
                ctx.fillRect(ex * S + 2, ey * S - 5, bw, 3);
                ctx.fillStyle = pct > 0.5 ? '#00cc00' : pct > 0.25 ? '#aaaa00' : '#cc0000';
                ctx.fillRect(ex * S + 2, ey * S - 5, Math.round(bw * pct), 3);
            }
            // Name label
            if (edef) {
                ctx.fillStyle = edef.color || '#ff4444';
                ctx.font = `${Math.floor(S * 0.28)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(edef.name.split(' ')[0], ex * S + S / 2, ey * S);
            }
        }
    }

    // --- OTHER PLAYERS ---
    if (players) {
        players.forEach((p, id) => {
            if (p.location !== localPlayer.location) return;
            const px = (p.x ?? 0) - camX;
            const py = (p.y ?? 0) - camY;
            if (px < 0 || px >= VIEWPORT_W || py < 0 || py >= VIEWPORT_H) return;
            const sprite = getSprite(hashStr(id), 'peer');
            ctx.drawImage(sprite, px * S + Math.floor(S * 0.15), py * S, Math.floor(S * 0.7), S);
            ctx.fillStyle = '#00aaff';
            ctx.font = `${Math.floor(S * 0.28)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText((p.name || id).split('').slice(0, 8).join(''), px * S + S / 2, py * S);
        });
    }

    // --- LOCAL PLAYER ---
    const plx = localPlayer.x - camX;
    const ply = localPlayer.y - camY;
    if (plx >= 0 && plx < VIEWPORT_W && ply >= 0 && ply < VIEWPORT_H) {
        const sprite = getSprite(hashStr(localPlayer.name || 'self'), 'self');
        ctx.drawImage(sprite, plx * S + Math.floor(S * 0.15), ply * S, Math.floor(S * 0.7), S);
        // Selection glow
        ctx.strokeStyle = '#00ff44';
        ctx.lineWidth = 2;
        ctx.strokeRect(plx * S + 1, ply * S + 1, S - 2, S - 2);
        // Name above
        ctx.fillStyle = '#00ff44';
        ctx.font = `bold ${Math.floor(S * 0.28)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(localPlayer.name || 'You', plx * S + S / 2, ply * S);
    }

    // --- EDGE TRANSITION INDICATORS ---
    // Show arrows at zone edges where exits exist
    const exits = loc.exits || {};
    const edgeArrows = [
        { dir: 'north', x: Math.floor(VIEWPORT_W / 2), y: 0,            label: '▲' },
        { dir: 'south', x: Math.floor(VIEWPORT_W / 2), y: VIEWPORT_H-1, label: '▼' },
        { dir: 'west',  x: 0,            y: Math.floor(VIEWPORT_H / 2), label: '◀' },
        { dir: 'east',  x: VIEWPORT_W-1, y: Math.floor(VIEWPORT_H / 2), label: '▶' },
    ];
    edgeArrows.forEach(({ dir, x, y, label }) => {
        if (!exits[dir]) return;
        const destName = world[exits[dir]]?.name?.split(' ')[0] || dir;
        ctx.fillStyle = 'rgba(0,255,180,0.7)';
        ctx.font = `bold ${Math.floor(S * 0.5)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x * S + S / 2, y * S + S / 2);
        ctx.fillStyle = 'rgba(0,200,140,0.6)';
        ctx.font = `${Math.floor(S * 0.25)}px monospace`;
        ctx.fillText(destName, x * S + S / 2, dir === 'north' ? y * S + S - 4 : y * S + 4);
    });

    // --- CLICK HANDLER ---
    _canvas.onclick = (e) => {
        const rect = _canvas.getBoundingClientRect();
        const scaleX = CW / rect.width;
        const scaleY = CH / rect.height;
        const tx = Math.floor((e.clientX - rect.left) * scaleX / S) + camX;
        const ty = Math.floor((e.clientY - rect.top)  * scaleY / S) + camY;
        onTileClick(tx, ty);
    };
}

// --- Phase 8 interface stubs ---
export function showFloatingText(x, y, text, style) {}
export function showToast(message, style) {}
export function showSpeechBubble(entityId, text) {}
export function showDialogue(npcId, text, mood) {}
export function showInventoryPanel(items, equipped) {}
export function showQuestPanel(quests) {}
export function showShopPanel(npcId, inventory) {}
export function updateHUD(player, world) {}
export function renderMinimap(state) {}
