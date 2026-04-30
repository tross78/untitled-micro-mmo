import { drawTile, generateCharacterSprite, zoneTileType } from './graphics.js';
import { drawRadar } from './ui.js';
import { VIEWPORT_W, VIEWPORT_H, TILE_PX } from './constants.js';
import { getTimeOfDay } from './rules.js';
import { bus } from './eventbus.js';

const ARTICLES = new Set(['the', 'a', 'an']);
const shortName = (name) => {
    const str = name || '';
    const words = str.split(' ');
    const first = words[0].toLowerCase();
    const label = ARTICLES.has(first) ? words.slice(1).join(' ') : str;
    return label.slice(0, 10);
};

// Logical tile size on screen — 3× pixel-art upscale
const SCALE = 3;
const S = TILE_PX * SCALE;           // pixels per tile on canvas (48)
const CW = VIEWPORT_W * S;           // canvas width  (720)
const CH = VIEWPORT_H * S;           // canvas height (528)

let _canvas = null;
let _radarEl = null;
let _devMode = false;                 // backtick toggles this
let _dpr = 1;

// --- RAF LOOP ---
let _rafId = null;
let _lastState = null;
let _lastCb = null;

function scheduleFrame() {
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => {
        _rafId = null;
        if (_lastState) renderWorld(_lastState, _lastCb);
        if (_isAnimating) scheduleFrame();
    });
}

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
    _dpr = window.devicePixelRatio || 1;

    _canvas = document.createElement('canvas');
    _canvas.id = 'game-canvas';
    // Use logical dimensions for the canvas element internal size
    // High-DPI is handled by CSS aspect-ratio and image-rendering
    _canvas.width = CW;
    _canvas.height = CH;
    _canvas.style.cssText = `
        display:block; width:100%; max-width:${CW}px; max-height:45vh; aspect-ratio:${CW}/${CH};
        image-rendering:pixelated; image-rendering:crisp-edges; margin: 0 auto;
        cursor:pointer; background:#000; border-bottom:1px solid #111;
    `;

    const ctx = _canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    if (_radarEl) _radarEl.insertAdjacentElement('beforebegin', _canvas);
    if (_radarEl) _radarEl.style.display = 'none';

    // Backtick dev toggle
    window.addEventListener('keydown', (e) => {
        if (e.key === '`' && !e.target.matches('input,textarea')) {
            toggleDevRadar();
        }
    });

    // Tab blur/focus pause
    window.addEventListener('blur', () => { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } });
    window.addEventListener('focus', () => { if (_isAnimating) scheduleFrame(); });
}

export function toggleDevRadar() {
    _devMode = !_devMode;
    if (_canvas) _canvas.style.display = _devMode ? 'none' : 'block';
    if (_radarEl) _radarEl.style.display = _devMode ? 'grid' : 'none';
    console.log(`[Dev] ${_devMode ? 'Radar' : 'Canvas'} view active. Press \` to toggle.`);
}

// --- LERP & ANIMATION STATE ---
const _moveStates = new Map(); // id -> { x, y, prevX, prevY, moveStart, loc }
let _isAnimating = false;

function getDrawPos(id, x, y, location, duration = 120) {
    let state = _moveStates.get(id);
    const now = Date.now();
    if (!state || state.loc !== location) {
        state = { x, y, prevX: x, prevY: y, moveStart: 0, loc: location };
        _moveStates.set(id, state);
    }
    if (state.x !== x || state.y !== y) {
        // Only lerp if it's a 1-tile move within the same room
        const dist = Math.abs(x - state.x) + Math.abs(y - state.y);
        if (dist === 1 && state.loc === location) {
            state.prevX = state.x;
            state.prevY = state.y;
            state.moveStart = now;
        } else {
            state.prevX = x;
            state.prevY = y;
            state.moveStart = 0;
        }
        state.x = x;
        state.y = y;
    }
    const elapsed = now - state.moveStart;
    if (elapsed < duration && state.moveStart > 0) {
        _isAnimating = true;
        const t = elapsed / duration;
        return {
            x: state.prevX + (state.x - state.prevX) * t,
            y: state.prevY + (state.y - state.prevY) * t
        };
    }
    return { x, y };
}

function npcWanderOffset(id, seed, day) {
    // Deterministic but time-varying wander
    const phase = (Date.now() / 2500) + (hashStr(id) % 100);
    _isAnimating = true;
    return {
        x: Math.sin(phase) * 0.35,
        y: Math.cos(phase * 0.7) * 0.35
    };
}

// --- TILE CACHE ---
let _tileCache = null; // { loc: string, camX: number, camY: number, canvas: OffscreenCanvas }

function getTileLayer(ctx, loc, camX, camY, tileType) {
    const floorX = Math.floor(camX);
    const floorY = Math.floor(camY);
    const locKey = loc.name + loc.width + loc.height; // Simple stable key
    
    if (_tileCache && _tileCache.loc === locKey && _tileCache.camX === floorX && _tileCache.camY === floorY) {
        return _tileCache.canvas;
    }

    const off = new OffscreenCanvas(CW + S, CH + S);
    const octx = off.getContext('2d');
    octx.imageSmoothingEnabled = false;
    
    for (let ty = 0; ty <= VIEWPORT_H; ty++) {
        for (let tx = 0; tx <= VIEWPORT_W; tx++) {
            const wx = floorX + tx;
            const wy = floorY + ty;
            if (wx >= loc.width || wy >= loc.height || wx < 0 || wy < 0) {
                octx.fillStyle = '#0a0a0a';
                octx.fillRect(tx * S, ty * S, S, S);
                continue;
            }
            const override = (loc.tileOverrides || []).find(o => o.x === wx && o.y === wy);
            const seed = hashStr(locKey) ^ (wx * 7919) ^ (wy * 6271);
            drawTile(octx, override?.type || tileType, tx * S, ty * S, seed, S);
        }
    }
    _tileCache = { loc: locKey, camX: floorX, camY: floorY, canvas: off };
    return off;
}

export function renderWorld(state, onTileClick) {
    if (_devMode) {
        drawRadar(state, onTileClick);
        return;
    }

    initCanvas();
    _lastState = state;
    _lastCb = onTileClick;
    _isAnimating = false; // Reset; helpers will set true if they need another frame
    const ctx = _canvas.getContext('2d');
    const { localPlayer, world, players, shardEnemies, NPCS, getNPCLocation, worldState, ENEMIES } = state;
    const loc = world[localPlayer.location];
    if (!loc) return;

    const tileType = zoneTileType(localPlayer.location);

    // Camera: follows player draw position for smoothness
    const dPlayer = getDrawPos('self', localPlayer.x, localPlayer.y, localPlayer.location);
    const camX = loc.width <= VIEWPORT_W ? -(VIEWPORT_W - loc.width) / 2 : Math.max(0, Math.min(loc.width - VIEWPORT_W, dPlayer.x - Math.floor(VIEWPORT_W / 2)));
    const camY = loc.height <= VIEWPORT_H ? -(VIEWPORT_H - loc.height) / 2 : Math.max(0, Math.min(loc.height - VIEWPORT_H, dPlayer.y - Math.floor(VIEWPORT_H / 2)));

    // --- TILES ---
    const offsetX = (camX - Math.floor(camX)) * S;
    const offsetY = (camY - Math.floor(camY)) * S;
    ctx.drawImage(getTileLayer(ctx, loc, camX, camY, tileType), -offsetX, -offsetY);

    // --- EXITS ---
    ( loc.exitTiles || []).forEach(p => {
        // Portal bleed fix: clip to room bounds
        if (p.x < 0 || p.x >= loc.width || p.y < 0 || p.y >= loc.height) return;

        const sx = p.x - camX;
        const sy = p.y - camY;
        if (sx < -1 || sx >= VIEWPORT_W || sy < -1 || sy >= VIEWPORT_H) return;
        drawTile(ctx, 'exit', sx * S, sy * S, 0, S);
        const destName = world[p.dest]?.name || p.dest;
        ctx.fillStyle = '#cc88ff';
        ctx.font = `bold ${Math.floor(S * 0.3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(shortName(destName), sx * S + S / 2, sy * S + 1);
    });

    // --- SCENERY ---
    (loc.scenery || []).forEach(sc => {
        const sx = sc.x - camX;
        const sy = sc.y - camY;
        if (sx < -1 || sx >= VIEWPORT_W || sy < -1 || sy >= VIEWPORT_H) return;
        ctx.fillStyle = '#2a3a2a';
        ctx.fillRect(sx * S + 2, sy * S + 2, S - 4, S - 4);
        ctx.fillStyle = '#668855';
        ctx.font = `${Math.floor(S * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sc.label || '■', sx * S + S / 2, sy * S + S / 2);
    });

    // --- STATIC ENTITIES (NPCs) ---
    const localNpcs = Object.keys(NPCS || {}).filter(id => getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location);
    localNpcs.forEach(id => {
        const npc = NPCS[id];
        const se = (loc.staticEntities || []).find(e => e.id === id);
        if (!se) return;
        
        const wander = npcWanderOffset(id, worldState.seed, worldState.day);
        const sx = se.x + wander.x - camX;
        const sy = se.y + wander.y - camY;

        if (sx < -1 || sx >= VIEWPORT_W || sy < -1 || sy >= VIEWPORT_H) return;
        const sprite = getSprite(hashStr(id), 'npc');
        ctx.drawImage(sprite, sx * S + Math.floor(S * 0.15), sy * S, Math.floor(S * 0.7), S);
        ctx.fillStyle = '#ffdd00';
        ctx.font = `${Math.floor(S * 0.28)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(shortName(npc.name), sx * S + S / 2, sy * S);
    });

    // --- ENEMY ---
    const sharedEnemy = shardEnemies.get(localPlayer.location);
    const timeOfDay = getTimeOfDay();
    const locEnemy = loc.enemy && (!loc.nightOnly || timeOfDay === 'night') ? loc.enemy : null;
    const hasEnemy = locEnemy && (!sharedEnemy || sharedEnemy.hp > 0);
    if (hasEnemy) {
        const lex = loc.enemyX ?? Math.floor(loc.width / 2);
        const ley = loc.enemyY ?? Math.floor(loc.height / 2);
        const de = getDrawPos('enemy', lex, ley, localPlayer.location);
        const ex = de.x - camX;
        const ey = de.y - camY;

        if (ex >= -1 && ex < VIEWPORT_W && ey >= -1 && ey < VIEWPORT_H) {
            const edef = ENEMIES?.[locEnemy];
            const sprite = getSprite(hashStr(locEnemy), 'enemy');
            
            // Hit Flash: tint red if recently hit
            if (_hitFlash && Date.now() <= _hitFlash) {
                ctx.save();
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#f00';
                ctx.drawImage(sprite, ex * S + Math.floor(S * 0.1), ey * S, Math.floor(S * 0.8), S);
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
                ctx.fillRect(ex * S, ey * S, S, S);
                ctx.restore();
            } else {
                ctx.drawImage(sprite, ex * S + Math.floor(S * 0.1), ey * S, Math.floor(S * 0.8), S);
            }

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
                ctx.fillText(shortName(edef.name), ex * S + S / 2, ey * S);
            }
        }
    }

    // --- OTHER PLAYERS ---
    if (players) {
        players.forEach((p, id) => {
            if (p.location !== localPlayer.location) return;
            const dp = getDrawPos(id, p.x ?? 0, p.y ?? 0, localPlayer.location);
            const px = dp.x - camX;
            const py = dp.y - camY;
            if (px < -1 || px >= VIEWPORT_W || py < -1 || py >= VIEWPORT_H) return;
            
            if (p.ghost) ctx.globalAlpha = 0.5;
            const sprite = getSprite(hashStr(id), 'peer');
            ctx.drawImage(sprite, px * S + Math.floor(S * 0.15), py * S, Math.floor(S * 0.7), S);
            ctx.fillStyle = '#00aaff';
            ctx.font = `${Math.floor(S * 0.28)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText((p.name || id).split('').slice(0, 8).join(''), px * S + S / 2, py * S);
            ctx.globalAlpha = 1.0;
        });
    }

    // --- LOCAL PLAYER ---
    const plx = dPlayer.x - camX;
    const ply = dPlayer.y - camY;
    if (plx >= -1 && plx < VIEWPORT_W && ply >= -1 && ply < VIEWPORT_H) {
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
        const destName = shortName(world[exits[dir]]?.name || dir);
        const sx = x - camX;
        const sy = y - camY;
        if (sx < 0 || sx >= VIEWPORT_W || sy < 0 || sy >= VIEWPORT_H) return;

        ctx.fillStyle = 'rgba(0,255,180,0.7)';
        ctx.font = `bold ${Math.floor(S * 0.5)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sx * S + S / 2, sy * S + S / 2);
        ctx.fillStyle = 'rgba(0,200,140,0.6)';
        ctx.font = `${Math.floor(S * 0.25)}px monospace`;
        ctx.fillText(destName, sx * S + S / 2, dir === 'north' ? sy * S + S - 4 : sy * S + 4);
    });

    // --- NIGHT OVERLAY ---
    if (timeOfDay === 'night') {
        ctx.fillStyle = 'rgba(0, 0, 40, 0.45)';
        ctx.fillRect(0, 0, CW, CH);
    } else if (timeOfDay === 'dusk' || timeOfDay === 'dawn') {
        ctx.fillStyle = 'rgba(60, 20, 0, 0.25)';
        ctx.fillRect(0, 0, CW, CH);
    }

    // --- TIME OF DAY BADGE ---
    const timeIcon = { day: '☀️', night: '🌙', dusk: '🌆', dawn: '🌅' }[timeOfDay] || '☀️';
    ctx.font = `${Math.floor(S * 0.4)}px monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(timeIcon, CW - 4, 4);

    // --- OVERLAYS ---
    drawHUD(ctx, localPlayer);
    drawBanner(ctx);
    drawToasts(ctx);
    drawFanfare(ctx);
    drawFloatingTexts(ctx, camX, camY);
    if (_dialogue) drawDialogueBox(ctx, _dialogue.name);

    // If we are animating, schedule another redraw immediately
    if (_isAnimating) scheduleRedraw(16);

    // --- CLICK HANDLER ---
    // Build a lookup of what's on each tile so clicks can resolve intent
    const npcTiles = new Map(); // "wx,wy" -> npcId
    localNpcs.forEach(id => {
        const se = (loc.staticEntities || []).find(e => e.id === id);
        if (se) npcTiles.set(`${se.x},${se.y}`, id);
    });
    const enemyTileKey = loc.enemy ? `${loc.enemyX ?? Math.floor(loc.width / 2)},${loc.enemyY ?? Math.floor(loc.height / 2)}` : null;

    _canvas.onclick = (e) => {
        // Dialogue intercepts all clicks
        if (_dialogue) { advanceDialogue(); return; }

        const rect = _canvas.getBoundingClientRect();
        // COMPENSATE FOR CSS SCALING: 
        // CW/rect.width gives the ratio of logical width to displayed width
        const scaleX = CW / rect.width;
        const scaleY = CH / rect.height;
        const tx = Math.floor((e.clientX - rect.left) * scaleX / S + camX);
        const ty = Math.floor((e.clientY - rect.top)  * scaleY / S + camY);

        const key = `${tx},${ty}`;
        if (npcTiles.has(key)) {
            onTileClick(tx, ty, { type: 'npc', id: npcTiles.get(key) });
        } else if (enemyTileKey && key === enemyTileKey) {
            onTileClick(tx, ty, { type: 'enemy' });
        } else {
            onTileClick(tx, ty, null);
        }
    };
}


// ─── Overlay state ────────────────────────────────────────────────────────────

let _dialogue = null;      // { name, lines, page }
let _fanfare  = null;      // { text, expires }
let _banner   = null;      // { text, expires }
let _hitFlash = 0;         // timestamp when flash expires
let _toasts   = [];        // [{ text, expires }]
let _floatingTexts = [];   // [{ x, y, text, color, expires, startY }]
let _tickerText = '';
let _triggerVisualRefresh = null;
let _triggerLogicalRefresh = null;

export function setVisualRefreshCallback(fn) { _triggerVisualRefresh = fn; }
export function setLogicalRefreshCallback(fn) { _triggerLogicalRefresh = fn; }

function scheduleRedraw(ms) {
    if (_triggerVisualRefresh) setTimeout(_triggerVisualRefresh, ms);
}

// ─── Public overlay API ───────────────────────────────────────────────────────

export function setTicker(text) {
    _tickerText = text;
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showFloatingText(x, y, text, color = '#fff') {
    _floatingTexts.push({ x, y, text, color, expires: Date.now() + 1000, startY: y });
    scheduleRedraw(1100);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showToast(message) {
    const expires = Date.now() + 2500;
    _toasts.push({ text: message, expires });
    if (_toasts.length > 3) _toasts.shift();
    scheduleRedraw(2600);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showRoomBanner(roomName) {
    _banner = { text: roomName, expires: Date.now() + 2000 };
    scheduleRedraw(2100);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showItemFanfare(itemName) {
    _fanfare = { text: `You got\n${itemName}!`, expires: Date.now() + 1500 };
    scheduleRedraw(1600);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showLevelUp(level) {
    _fanfare = { text: `⬆ Level ${level}!`, expires: Date.now() + 2000 };
    scheduleRedraw(2100);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function triggerHitFlash() {
    _hitFlash = Date.now() + 200;
    scheduleRedraw(250);
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

export function showDialogue(npcName, text) {
    if (!text) return; // don't open dialogue with no text

    const CHARS_PER_LINE = 38;
    const LINES_PER_PAGE = 3;
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if ((cur + (cur ? ' ' : '') + w).length > CHARS_PER_LINE) {
            if (cur) lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + ' ' + w : w;
        }
    }
    if (cur) lines.push(cur);

    const pages = [];
    for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
        pages.push(lines.slice(i, i + LINES_PER_PAGE));
    }
    if (!pages.length) return; // don't open dialogue with no text
    _dialogue = { name: npcName, pages, page: 0 };
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    if (_triggerLogicalRefresh) _triggerLogicalRefresh();
}

export function advanceDialogue() {
    if (!_dialogue) return false;
    if (_dialogue.page < _dialogue.pages.length - 1) {
        _dialogue.page++;
        if (_triggerVisualRefresh) _triggerVisualRefresh();
        return true; // still open
    }
    _dialogue = null;
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    if (_triggerLogicalRefresh) _triggerLogicalRefresh();
    return false; // closed
}

export function isDialogueOpen() { 
    return _dialogue !== null && !!_dialogue.pages && !!_dialogue.pages.length; 
}

// stubs for future phases
export function showSpeechBubble(entityId, text) {}
export function showInventoryPanel(items, equipped) {}
export function showQuestPanel(quests) {}
export function showShopPanel(npcId, inventory) {}
export function updateHUD(player, world) {}
export function renderMinimap(state) {}

// ─── Overlay rendering helpers ────────────────────────────────────────────────

function drawHUD(ctx, localPlayer) {
    const PAD = 6;
    const STRIP = Math.floor(S * 0.55);
    const y = CH - STRIP;

    // semi-transparent strip
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, y, CW, STRIP);

    ctx.textBaseline = 'middle';
    const mid = y + STRIP / 2;
    const fs = Math.floor(STRIP * 0.6);
    ctx.font = `bold ${fs}px monospace`;

    // HP
    const hp = localPlayer.hp ?? localPlayer.maxHp ?? 10;
    const maxHp = localPlayer.maxHp ?? 10;
    ctx.fillStyle = hp < maxHp * 0.3 ? '#ff4444' : '#ff8888';
    ctx.textAlign = 'left';
    ctx.fillText(`♥ ${hp}/${maxHp}`, PAD, mid);

    // Gold
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.fillText(`💰 ${localPlayer.gold ?? 0}`, CW / 2, mid);

    // Fights
    const fights = localPlayer.forestFights ?? 0;
    ctx.fillStyle = fights > 0 ? '#aaffaa' : '#555';
    ctx.textAlign = 'right';
    ctx.fillText(`⚡ ${fights}`, CW - PAD, mid);

    // Ticker (centered above HUD strip)
    if (_tickerText) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, CW, Math.floor(S * 0.45));
        ctx.fillStyle = '#aaa';
        ctx.font = `italic ${Math.floor(S * 0.28)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(_tickerText, CW / 2, 4);
    }
}

function drawFloatingTexts(ctx, camX, camY) {
    const now = Date.now();
    _floatingTexts = _floatingTexts.filter(t => now < t.expires);
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    _floatingTexts.forEach(t => {
        const elapsed = now - (t.expires - 1000);
        const alpha = 1 - (elapsed / 1000);
        const floatY = (t.startY - camY) * S - (elapsed / 1000) * S;
        const screenX = (t.x - camX) * S + S / 2;
        
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.font = `bold ${Math.floor(S * 0.3)}px monospace`;
        ctx.fillText(t.text, screenX + 1, floatY + 1); // drop shadow
        
        const [r, g, b] = t.color === '#fff' ? [255, 255, 255] : [0, 255, 170]; // simplified color support
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillText(t.text, screenX, floatY);
    });
}

function drawDialogueBox(ctx, npcName) {
    if (!_dialogue) return;
    // Safety valve: if dialogue is broken, clear it
    if (!_dialogue.pages || !_dialogue.pages.length || _dialogue.page >= _dialogue.pages.length) {
        _dialogue = null;
        return;
    }
    const BOX_H = Math.floor(CH * 0.28);
    const BOX_Y = CH - BOX_H;
    const PAD = Math.floor(S * 0.4);

    // Dark panel with border
    ctx.fillStyle = 'rgba(10,10,30,0.94)';
    ctx.fillRect(0, BOX_Y, CW, BOX_H);
    ctx.strokeStyle = '#8866cc';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, BOX_Y + 2, CW - 4, BOX_H - 4);

    // NPC name tag
    const nameFs = Math.floor(S * 0.32);
    ctx.font = `bold ${nameFs}px monospace`;
    ctx.fillStyle = '#ffdd55';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText((_dialogue.name || '???').toUpperCase(), PAD, BOX_Y + PAD * 0.6);

    // Text lines
    const lineFs = Math.floor(S * 0.27);
    ctx.font = `${lineFs}px monospace`;
    ctx.fillStyle = '#ddeeff';
    const lineH = lineFs * 1.5;
    const textY = BOX_Y + PAD * 0.6 + nameFs + PAD * 0.4;
    (_dialogue.pages[_dialogue.page] || []).forEach((line, i) => {
        ctx.fillText(line, PAD, textY + i * lineH);
    });

    // Advance prompt
    const more = _dialogue.page < _dialogue.pages.length - 1;
    ctx.fillStyle = more ? '#cc88ff' : '#666688';
    ctx.font = `bold ${lineFs}px monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(more ? '▼ continue' : '▼ dismiss', CW - PAD, BOX_Y + BOX_H - PAD * 0.5);
}

function drawFanfare(ctx) {
    if (!_fanfare || Date.now() > _fanfare.expires) { _fanfare = null; return; }
    const alpha = Math.min(1, (_fanfare.expires - Date.now()) / 300);
    ctx.fillStyle = `rgba(0,0,0,${0.75 * alpha})`;
    const bh = Math.floor(CH * 0.35);
    const by = (CH - bh) / 2;
    ctx.fillRect(0, by, CW, bh);
    ctx.strokeStyle = `rgba(255,215,0,${alpha})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(4, by + 4, CW - 8, bh - 8);

    ctx.fillStyle = `rgba(255,230,100,${alpha})`;
    ctx.font = `bold ${Math.floor(S * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = _fanfare.text.split('\n');
    const lineH = Math.floor(S * 0.6);
    const startY = CH / 2 - (lines.length - 1) * lineH / 2;
    lines.forEach((l, i) => ctx.fillText(l, CW / 2, startY + i * lineH));
}

function drawBanner(ctx) {
    if (!_banner || Date.now() > _banner.expires) { _banner = null; return; }
    const age = Date.now() - (_banner.expires - 2000);
    const fadeIn = Math.min(1, age / 400);
    const fadeOut = Math.min(1, (_banner.expires - Date.now()) / 400);
    const alpha = Math.min(fadeIn, fadeOut);

    ctx.fillStyle = `rgba(0,0,0,${0.7 * alpha})`;
    const bh = Math.floor(S * 0.7);
    ctx.fillRect(0, 2, CW, bh);

    ctx.fillStyle = `rgba(255,255,200,${alpha})`;
    ctx.font = `bold ${Math.floor(S * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(_banner.text, CW / 2, 2 + bh / 2);
}

function drawToasts(ctx) {
    const now = Date.now();
    _toasts = _toasts.filter(t => now < t.expires);
    const fs = Math.floor(S * 0.28);
    ctx.font = `${fs}px monospace`;
    const PILL_H = fs + 10;
    const PILL_PAD = 12;
    _toasts.forEach((t, i) => {
        const alpha = Math.min(1, (t.expires - now) / 400);
        const tw = ctx.measureText(t.text).width + PILL_PAD * 2;
        const px = (CW - tw) / 2;
        const py = Math.floor(S * 0.8) + i * (PILL_H + 4);
        ctx.fillStyle = `rgba(20,20,40,${0.85 * alpha})`;
        ctx.beginPath();
        ctx.roundRect?.(px, py, tw, PILL_H, 6) ?? ctx.fillRect(px, py, tw, PILL_H);
        ctx.fill();
        ctx.strokeStyle = `rgba(100,160,255,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = `rgba(200,230,255,${alpha})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.text, CW / 2, py + PILL_H / 2);
    });
}
