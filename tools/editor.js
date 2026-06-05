/**
 * Hearthwick Map Editor (Phase 8.2B)
 * Standalone browser tool — zero dependencies, no server needed.
 * Open tools/editor.html directly in browser (file:// or local server).
 */

import { drawTile, zoneTileType, getGrayscaleTemplate, applyPalette, getSceneryPalette } from '../src/graphics/graphics.js';
import { rooms } from '../src/content/data/rooms.js';
import { SCENERY_DIMENSIONS } from '../src/infra/graphics-constants.js';

// ── Constants ────────────────────────────────────────────────────────────────

const S = 24; // tile display size in editor (pixels)

const TILE_TYPES = [
    { char: '.', label: 'Default', color: null },
    { char: 'G', label: 'Grass',   color: '#3d6b2a' },
    { char: 'S', label: 'Stone',   color: '#6e6458' },
    { char: 'W', label: 'Wall',    color: '#4a5248' },
    { char: 'I', label: 'Interior',color: '#8a5a28' },
    { char: 'V', label: 'Water',   color: '#1a3f6a' },
    { char: 'D', label: 'Dungeon', color: '#5a6878' },
    { char: 'C', label: 'Cave',    color: '#6a5038' },
    { char: 'Z', label: 'Ice',     color: '#b8d8e8' },
];

const CHAR_TO_TYPE = { '.': null, G:'grass', S:'stone_floor', W:'wall', I:'interior', V:'water', D:'dungeon', C:'cave', Z:'ice' };
const TYPE_TO_CHAR = Object.fromEntries(Object.entries(CHAR_TO_TYPE).map(([c,t])=>[t,c]));

const SCENERY_SHAPES = [
    'tree','shrub','rock','crate','barrel','stall','sign','wheel',
    'torch','bones','anchor','snowflake','crown','ladder','shell',
    'scroll','altar','grave','mushroom','door_arch','candle',
];

// Placement metadata (mirrors src/content/validate.js so the editor warns the same way the engine does).
const FOOT = (label) => SCENERY_DIMENSIONS[label] || [1, 1];
const WALL_MOUNTABLE = new Set(['torch', 'candle', 'sign', 'ladder', 'fireplace']);
const TALL_SCENERY = new Set(['tree', 'bookshelf', 'fireplace', 'door_arch', 'pillar']);
const WALL_ANCHORED = new Set(['torch', 'crate', 'barrel', 'counter', 'bed', 'door_arch', 'stall', 'ladder', 'stairs', 'bookshelf', 'fireplace']);
const CLUTTER_WARN = 0.25; // scenery footprint over 25% of open floor reads as cramped

// ── State ────────────────────────────────────────────────────────────────────

const state = {
    roomId: Object.keys(rooms)[0],
    grid: [],          // 2D array of chars (tile type chars)
    scenery: [],       // [{x,y,label}]
    exits: {},         // logical exits {north: 'id'}
    exitTiles: [],     // parsed exit objects [{x,y,dest,...}]
    activeTile: '.',   // currently selected tile char
    exitPlaceMode: false, // when true, click fills exit x/y instead of painting
    graphOffset: { x: 0, y: 0 },
    graphZoom: 1,
    graphDrag: null,
    nodeDrag: null,    // {id, startX, startY, initPos}
    roomPositions: {}, // {roomId: {x,y}} for graph layout
    pendingSceneryPos: null,
};

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
    buildRoomSelect();
    buildDestSelect();
    buildPalette();
    buildSceneryModal();
    loadEditorState(); // must come before computeGraphLayout to use saved positions
    computeGraphLayout();
    setupGraphCanvas();
    setupTileCanvas();
    setupToolbar();
    setupExitHandlers();
    setupExitPlaceMode();
    setupScatter();
}

function buildDestSelect() {
    const sel = document.getElementById('new-exit-dest');
    for (const id of Object.keys(rooms)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = rooms[id].name || id;
        sel.appendChild(opt);
    }
}

const REVERSE_DIR = {
    north: 'south', south: 'north', east: 'west', west: 'east',
    north_east: 'south_west', south_west: 'north_east',
    north_west: 'south_east', south_east: 'north_west',
    up: 'down', down: 'up'
};

// ── Smart exit position helpers ───────────────────────────────────────────────

const INSET = 1; // tiles inward from wall for landing positions

function wallCenter(dir, room) {
    // Returns the wall-center tile for a given direction in a room
    const W = room.width, H = room.height;
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    switch (dir) {
        case 'north': return { x: cx, y: 0 };
        case 'south': return { x: cx, y: H - 1 };
        case 'east':  return { x: W - 1, y: cy };
        case 'west':  return { x: 0, y: cy };
        default:      return { x: cx, y: cy }; // up/down/custom: center
    }
}

function inwardLanding(dir, room) {
    // Returns a landing position inward from the wall for a given direction
    const W = room.width, H = room.height;
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    switch (dir) {
        case 'north': return { x: cx, y: INSET };
        case 'south': return { x: cx, y: H - 1 - INSET };
        case 'east':  return { x: W - 1 - INSET, y: cy };
        case 'west':  return { x: INSET, y: cy };
        default:      return { x: cx, y: cy };
    }
}

function smartFillExitForm() {
    const dir = document.getElementById('new-exit-dir').value;
    const destId = document.getElementById('new-exit-dest').value;
    const srcRoom = rooms[state.roomId];
    const destRoom = rooms[destId];
    if (!srcRoom || !destRoom || destId === state.roomId) return;

    const revDir = REVERSE_DIR[dir];
    const tile = wallCenter(dir, srcRoom);
    const landing = inwardLanding(revDir, destRoom); // where we land in dest (inward from the wall that faces us)

    document.getElementById('new-exit-x').value = tile.x;
    document.getElementById('new-exit-y').value = tile.y;
    document.getElementById('new-exit-dx').value = landing.x;
    document.getElementById('new-exit-dy').value = landing.y;
}

function setupExitHandlers() {
    document.getElementById('btn-smart-fill')?.addEventListener('click', smartFillExitForm);

    // Auto-fill when direction or destination changes
    document.getElementById('new-exit-dir').addEventListener('change', smartFillExitForm);
    document.getElementById('new-exit-dest').addEventListener('change', smartFillExitForm);

    document.getElementById('btn-add-exit').addEventListener('click', () => {
        const dir = document.getElementById('new-exit-dir').value;
        const dest = document.getElementById('new-exit-dest').value;
        const type = document.getElementById('new-exit-type').value;
        const x = parseInt(document.getElementById('new-exit-x').value) || 0;
        const y = parseInt(document.getElementById('new-exit-y').value) || 0;
        const dx = parseInt(document.getElementById('new-exit-dx').value) || 5;
        const dy = parseInt(document.getElementById('new-exit-dy').value) || 5;
        const reciprocal = document.getElementById('chk-reciprocal').checked;

        if (dest === state.roomId) return;

        // 1. Update this room
        state.exits[dir] = dest;
        const existing = state.exitTiles.find(e => e.dest === dest);
        if (existing) {
            existing.x = x; existing.y = y; existing.type = type;
            existing.destX = dx; existing.destY = dy;
        } else {
            state.exitTiles.push({ x, y, dest, destX: dx, destY: dy, type, w: 1, h: 1 });
        }

        // 2. Handle reciprocal — place return exit on the opposite wall of dest,
        //    with landing inward from the source exit tile (not on it)
        if (reciprocal) {
            const revDir = REVERSE_DIR[dir];
            if (revDir && rooms[dest]) {
                const destRoom = rooms[dest];
                const srcRoom = rooms[state.roomId];
                const retTile = wallCenter(revDir, destRoom);
                const retLanding = inwardLanding(dir, srcRoom); // land inward from source wall

                const destSavedExits = state._savedExits[dest] || { ...(destRoom.exits || {}) };
                destSavedExits[revDir] = state.roomId;
                state._savedExits[dest] = destSavedExits;

                const destSavedTiles = state._savedExitTiles[dest] || (Array.isArray(destRoom.exitTiles) ? [...destRoom.exitTiles] : []);
                const existingReturn = destSavedTiles.find(e => e.dest === state.roomId);
                if (existingReturn) {
                    existingReturn.x = retTile.x; existingReturn.y = retTile.y;
                    existingReturn.destX = retLanding.x; existingReturn.destY = retLanding.y;
                } else {
                    destSavedTiles.push({ x: retTile.x, y: retTile.y, dest: state.roomId, destX: retLanding.x, destY: retLanding.y, type, w: 1, h: 1 });
                }
                state._savedExitTiles[dest] = destSavedTiles;
            }
        }

        renderExitsUI();
        renderGraph();
        renderDSL();
        renderValidation();
        saveEditorState();
    });

    document.getElementById('btn-revert').addEventListener('click', () => {
        if (!confirm(`Revert ${state.roomId} to original data? All local changes will be lost.`)) return;
        delete state._savedGrids[state.roomId];
        delete state._savedScenery[state.roomId];
        delete state._savedExits[state.roomId];
        delete state._savedExitTiles[state.roomId];
        loadRoom(state.roomId);
    });
}
function renderExitsUI() {
    const list = document.getElementById('exits-list');
    list.innerHTML = '';
    Object.entries(state.exits).forEach(([dir, destId]) => {
        const row = document.createElement('div');
        row.className = 'exit-row';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.marginBottom = '4px';
        row.style.padding = '4px 8px';
        row.style.fontSize = '11px';
        row.style.background = '#2a2a2a';
        row.style.cursor = 'pointer';

        // Check if destination exists back to us
        const otherExits = state._savedExits[destId] || rooms[destId]?.exits || {};
        const isReciprocal = Object.values(otherExits).includes(state.roomId);
        row.style.borderLeft = isReciprocal ? '3px solid #33aa55' : '3px solid #aa3333';

        const label = document.createElement('span');
        label.textContent = `${dir.toUpperCase()}: ${destId}`;
        label.addEventListener('click', () => {
            document.getElementById('new-exit-dir').value = dir;
            document.getElementById('new-exit-dest').value = destId;
            const tile = state.exitTiles.find(e => e.dest === destId);
            if (tile) {
                document.getElementById('new-exit-x').value = tile.x;
                document.getElementById('new-exit-y').value = tile.y;
                document.getElementById('new-exit-dx').value = tile.destX;
                document.getElementById('new-exit-dy').value = tile.destY;
                document.getElementById('new-exit-type').value = tile.type;
            }
        });

        const btn = document.createElement('button');
        btn.textContent = '×';
        btn.style.background = '#aa3333';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.padding = '0 6px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (wouldDisconnect(state.roomId, destId)) {
                if (!confirm(`Removing this exit would disconnect the world graph (some rooms become unreachable). Remove anyway?`)) return;
            }
            delete state.exits[dir];
            state.exitTiles = state.exitTiles.filter(e => e.dest !== destId);
            renderExitsUI();
            renderGraph();
            renderDSL();
            renderValidation();
            saveEditorState();
        });

        row.appendChild(label);
        row.appendChild(btn);
        list.appendChild(row);
    });

    // Handle Inbound
    const inboundList = document.getElementById('inbound-list');
    inboundList.innerHTML = '';
    Object.keys(rooms).forEach(id => {
        if (id === state.roomId) return;
        const exits = state._savedExits[id] || rooms[id]?.exits || {};
        Object.entries(exits).forEach(([dir, destId]) => {
            if (destId === state.roomId) {
                const div = document.createElement('div');
                div.textContent = `← ${id} (${dir})`;
                div.style.padding = '2px 0';
                inboundList.appendChild(div);
            }
        });
    });
}

function drawArrow(ctx, x1, y1, x2, y2, color, isDashed) {
    const headlen = 8;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    
    // Offset ends slightly to not touch node center
    const off = 10;
    const sx = x1 + off * Math.cos(angle);
    const sy = y1 + off * Math.sin(angle);
    const ex = x2 - off * Math.cos(angle);
    const ey = y2 - off * Math.sin(angle);

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = color;
    if (isDashed) ctx.setLineDash([4, 3]);
    else ctx.setLineDash([]);
    ctx.stroke();
    
    // Arrow head
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headlen * Math.cos(angle - Math.PI / 6), ey - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(ex - headlen * Math.cos(angle + Math.PI / 6), ey - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

// ── Room Select ──────────────────────────────────────────────────────────────

function buildRoomSelect() {
    const sel = document.getElementById('room-select');
    for (const id of Object.keys(rooms)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = rooms[id].name || id;
        sel.appendChild(opt);
    }
    sel.addEventListener('change', () => loadRoom(sel.value));
}

// ── Load Room ────────────────────────────────────────────────────────────────

function loadRoom(id) {
    state.roomId = id;
    const room = rooms[id];
    if (!room) return;

    const w = room.width;
    const h = room.height;

    // Use saved grid if available, otherwise build from tileOverrides
    if (state._savedGrids?.[id]) {
        state.grid = state._savedGrids[id];
        while (state.grid.length < h) state.grid.push(Array(w).fill('.'));
        state.grid = state.grid.slice(0, h).map(row => {
            while (row.length < w) row.push('.');
            return row.slice(0, w);
        });
    } else {
        state.grid = Array.from({ length: h }, () => Array(w).fill('.'));
        (room.tileOverrides || []).forEach(({ x, y, type }) => {
            const c = TYPE_TO_CHAR[type];
            if (c && x >= 0 && x < w && y >= 0 && y < h) state.grid[y][x] = c;
        });
    }

    state.scenery = state._savedScenery?.[id]
        ? state._savedScenery[id]
        : (Array.isArray(room.scenery) ? room.scenery.map(s => ({ ...s })) : []);

    state.exits = state._savedExits?.[id]
        ? state._savedExits[id]
        : { ...(room.exits || {}) };

    state.exitTiles = state._savedExitTiles?.[id]
        ? state._savedExitTiles[id]
        : (Array.isArray(room.exitTiles) ? room.exitTiles.map(e => ({ ...e })) : []);

    document.getElementById('room-select').value = id;
    document.getElementById('inp-width').value = w;
    document.getElementById('inp-height').value = h;

    renderTileCanvas();
    renderExitsUI();
    renderDSL();
    renderGraph();
    renderValidation();
    saveEditorState();
}

// ── Palette ──────────────────────────────────────────────────────────────────

function buildPalette() {
    const bar = document.getElementById('palette-bar');
    TILE_TYPES.forEach(({ char, label, color }) => {
        const btn = document.createElement('canvas');
        btn.className = 'tile-btn';
        btn.width = 24;
        btn.height = 24;
        btn.title = label;
        btn.style.cursor = 'pointer';
        btn.style.border = char === state.activeTile ? '2px solid #88ccaa' : '2px solid #555';

        if (color) {
            const off = new OffscreenCanvas(S, S);
            const oct = off.getContext('2d');
            // Draw a sample tile at size 24
            const roomId = state.roomId;
            const type = CHAR_TO_TYPE[char] || zoneTileType(roomId);
            if (type) drawTile(oct, type, 0, 0, 12345, S);
            const bctx = btn.getContext('2d');
            bctx.drawImage(off, 0, 0);
        } else {
            // Default: show current zone color
            const bctx = btn.getContext('2d');
            bctx.fillStyle = '#2a2a2a';
            bctx.fillRect(0, 0, 24, 24);
            bctx.fillStyle = '#666';
            bctx.font = '10px monospace';
            bctx.textAlign = 'center';
            bctx.textBaseline = 'middle';
            bctx.fillText('?', 12, 12);
        }

        btn.addEventListener('click', () => {
            state.activeTile = char;
            document.querySelectorAll('.tile-btn').forEach(b => b.style.border = '2px solid #555');
            btn.style.border = '2px solid #88ccaa';
        });
        bar.appendChild(btn);
    });
}

// ── Tile Canvas ──────────────────────────────────────────────────────────────

function renderTileCanvas() {
    const room = rooms[state.roomId];
    if (!room) return;
    const w = room.width;
    const h = room.height;
    const canvas = document.getElementById('tile-canvas');
    canvas.width = w * S;
    canvas.height = h * S;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const zoneType = zoneTileType(state.roomId);

    // Draw tiles
    for (let ty = 0; ty < h; ty++) {
        for (let tx = 0; tx < w; tx++) {
            const char = state.grid[ty]?.[tx] || '.';
            const type = CHAR_TO_TYPE[char] || zoneType;
            const seed = (tx * 7919) ^ (ty * 6271) ^ 0x1234;
            drawTile(ctx, type, tx * S, ty * S, seed, S);
        }
    }

    // Draw exit overlays with destination labels
    (state.exitTiles || []).forEach(ex => {
        if (ex.x < 0 || ex.y < 0) return;
        const exW = (ex.w || 1) * S;
        const exH = (ex.h || 1) * S;
        const px = ex.x * S;
        const py = ex.y * S;

        // Check reciprocal validity
        const otherExits = state._savedExits[ex.dest] || rooms[ex.dest]?.exits || {};
        const isReciprocal = Object.values(otherExits).includes(state.roomId);

        ctx.fillStyle = isReciprocal ? 'rgba(80,200,120,0.32)' : 'rgba(220,80,80,0.32)';
        ctx.fillRect(px, py, exW, exH);
        ctx.strokeStyle = isReciprocal ? '#33aa55' : '#cc3333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 0.5, py + 0.5, exW - 1, exH - 1);

        // Destination label
        const label = (rooms[ex.dest]?.name || ex.dest).replace('The ', '');
        ctx.fillStyle = isReciprocal ? '#88ffaa' : '#ff8888';
        ctx.font = `bold ${Math.min(9, Math.floor(exW / label.length * 1.4))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px + exW / 2, py + exH / 2);
    });

    // Draw scenery
    state.scenery.forEach(({ x, y, label }) => {
        const template = getGrayscaleTemplate(label) || getGrayscaleTemplate('rock');
        const palette = getSceneryPalette(label);
        const colored = applyPalette(template, palette);
        ctx.drawImage(colored, x * S, y * S, S, S);
    });

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let tx = 0; tx <= w; tx++) {
        ctx.beginPath(); ctx.moveTo(tx * S, 0); ctx.lineTo(tx * S, h * S); ctx.stroke();
    }
    for (let ty = 0; ty <= h; ty++) {
        ctx.beginPath(); ctx.moveTo(0, ty * S); ctx.lineTo(w * S, ty * S); ctx.stroke();
    }
}

// ── Graph Connectivity Algorithms ─────────────────────────────────────────────

function buildAdjacency(overrides = {}) {
    // Build undirected adjacency from all rooms, merging any in-editor overrides.
    // overrides: { roomId: { exits: {...} } }
    const adj = {};
    for (const id of Object.keys(rooms)) {
        const exits = overrides[id]?.exits ?? (state._savedExits[id] || rooms[id]?.exits || {});
        adj[id] = new Set(Object.values(exits).filter(d => rooms[d]));
    }
    return adj;
}

function reachableFrom(startId, adj) {
    const visited = new Set();
    const queue = [startId];
    visited.add(startId);
    while (queue.length) {
        const id = queue.shift();
        for (const nb of (adj[id] || [])) {
            if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
        }
    }
    return visited;
}

function graphIsConnected(adj) {
    const ids = Object.keys(adj).filter(id => rooms[id]);
    if (ids.length === 0) return true;
    return reachableFrom(ids[0], adj).size === ids.length;
}

function wouldDisconnect(roomId, destId) {
    // Simulate removing the exit from roomId → destId AND destId → roomId
    const adj = buildAdjacency();
    adj[roomId]?.delete(destId);
    adj[destId]?.delete(roomId);
    return !graphIsConnected(adj);
}

function orphanedRooms() {
    const adj = buildAdjacency();
    const ids = Object.keys(rooms);
    const reachable = reachableFrom(ids[0], adj);
    return ids.filter(id => !reachable.has(id));
}

function getExitAtTile(tx, ty) {
    return (state.exitTiles || []).find(ex =>
        tx >= ex.x && tx < ex.x + (ex.w || 1) &&
        ty >= ex.y && ty < ex.y + (ex.h || 1)
    ) || null;
}

function setupTileCanvas() {
    const canvas = document.getElementById('tile-canvas');
    let painting = false;

    const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const scaleX = canvas.width / r.width;
        const scaleY = canvas.height / r.height;
        return {
            tx: Math.floor(((e.clientX - r.left) * scaleX) / S),
            ty: Math.floor(((e.clientY - r.top) * scaleY) / S),
        };
    };

    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const { tx, ty } = getPos(e);
        const room = rooms[state.roomId];
        if (!room || tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return;

        if (e.button === 2) {
            // Right-click: scenery modal
            state.pendingSceneryPos = { tx, ty };
            const modal = document.getElementById('scenery-modal');
            modal.style.display = 'block';
            modal.style.left = (e.clientX + 4) + 'px';
            modal.style.top = (e.clientY + 4) + 'px';
            return;
        }

        // Shift+click on exit tile → navigate to that room
        if (e.shiftKey) {
            const ex = getExitAtTile(tx, ty);
            if (ex && rooms[ex.dest]) { loadRoom(ex.dest); return; }
        }

        // Exit-place mode: click fills exit x/y coordinates
        if (state.exitPlaceMode) {
            document.getElementById('new-exit-x').value = tx;
            document.getElementById('new-exit-y').value = ty;
            document.getElementById('status').textContent = `Exit tile set to (${tx},${ty}) — adjust DX/DY then click +`;
            return;
        }

        painting = true;
        paintTile(tx, ty);
    });

    canvas.addEventListener('mousemove', (e) => {
        const { tx, ty } = getPos(e);
        const room = rooms[state.roomId];
        if (!room || tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) {
            if (!painting) return;
        }

        // Always show exit info on hover
        const ex = getExitAtTile(tx, ty);
        if (ex) {
            const destName = rooms[ex.dest]?.name || ex.dest;
            document.getElementById('status').textContent =
                `(${tx},${ty}) → ${destName} [${ex.type}] lands at (${ex.destX},${ex.destY}) | Shift+click to visit`;
            if (!painting) return;
        }

        if (!painting) return;
        paintTile(tx, ty);
        if (!ex) {
            const char = state.grid[ty]?.[tx] || '.';
            const type = CHAR_TO_TYPE[char] || zoneTileType(state.roomId);
            document.getElementById('status').textContent = `(${tx},${ty}) ${type}`;
        }
    });

    canvas.addEventListener('mouseleave', () => {
        painting = false;
        document.getElementById('status').textContent = '';
    });
    window.addEventListener('mouseup', () => { painting = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function setupExitPlaceMode() {
    const btn = document.getElementById('btn-exit-place');
    if (!btn) return;
    btn.addEventListener('click', () => {
        state.exitPlaceMode = !state.exitPlaceMode;
        btn.style.background = state.exitPlaceMode ? '#33aa55' : '#444';
        btn.style.color = state.exitPlaceMode ? '#fff' : '#ccc';
        btn.textContent = state.exitPlaceMode ? 'Exit Place: ON' : 'Exit Place';
        const canvas = document.getElementById('tile-canvas');
        canvas.style.cursor = state.exitPlaceMode ? 'cell' : 'crosshair';
        document.getElementById('status').textContent = state.exitPlaceMode
            ? 'Click a tile to set the exit position X/Y'
            : '';
    });
}

function paintTile(tx, ty) {
    const room = rooms[state.roomId];
    if (!room || tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return;
    if (!state.grid[ty]) state.grid[ty] = Array(room.width).fill('.');
    state.grid[ty][tx] = state.activeTile;
    renderTileCanvas();
    renderDSL();
    saveEditorState();
}

// ── Scenery Modal ─────────────────────────────────────────────────────────────

function buildSceneryModal() {
    const grid = document.getElementById('scenery-grid');
    SCENERY_SHAPES.forEach(shape => {
        const btn = document.createElement('div');
        btn.className = 'scenery-btn';

        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const template = getGrayscaleTemplate(shape);
        if (template) {
            const palette = getSceneryPalette(shape);
            const colored = applyPalette(template, palette);
            c.getContext('2d').drawImage(colored, 0, 0, 32, 32);
        }
        btn.appendChild(c);
        const lbl = document.createElement('div');
        lbl.textContent = shape;
        btn.appendChild(lbl);

        btn.addEventListener('click', () => {
            if (!state.pendingSceneryPos) return;
            const { tx, ty } = state.pendingSceneryPos;
            // Remove existing scenery at this tile
            state.scenery = state.scenery.filter(s => !(s.x === tx && s.y === ty));
            state.scenery.push({ x: tx, y: ty, label: shape });
            document.getElementById('scenery-modal').style.display = 'none';
            state.pendingSceneryPos = null;
            renderTileCanvas();
            renderDSL();
            saveEditorState();
        });
        grid.appendChild(btn);
    });

    document.getElementById('btn-scenery-clear').addEventListener('click', () => {
        if (!state.pendingSceneryPos) return;
        const { tx, ty } = state.pendingSceneryPos;
        state.scenery = state.scenery.filter(s => !(s.x === tx && s.y === ty));
        document.getElementById('scenery-modal').style.display = 'none';
        state.pendingSceneryPos = null;
        renderTileCanvas();
        renderDSL();
        saveEditorState();
    });

    document.getElementById('btn-scenery-cancel').addEventListener('click', () => {
        document.getElementById('scenery-modal').style.display = 'none';
        state.pendingSceneryPos = null;
    });

    // Close on outside click
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('scenery-modal');
        if (modal.style.display === 'block' && !modal.contains(e.target)) {
            modal.style.display = 'none';
            state.pendingSceneryPos = null;
        }
    });
}

// ── Scatter tool (blue-noise / best-candidate placement) ──────────────────────

function scatterBlocked(tx, ty) {
    const room = rooms[state.roomId];
    // edge clearance of 1 so props never hug the outer wall band
    if (tx < 1 || ty < 1 || tx >= room.width - 1 || ty >= room.height - 1) return true;
    const ch = state.grid[ty]?.[tx] || '.';
    if (ch === 'W' || ch === 'V') return true; // never on walls or water
    if (state.scenery.some(s => { const [w, h] = FOOT(s.label); return tx >= s.x && tx < s.x + w && ty >= s.y && ty < s.y + h; })) return true;
    if (state.exitTiles.some(e => tx >= e.x && tx < e.x + (e.w || 1) && ty >= e.y && ty < e.y + (e.h || 1))) return true;
    return false;
}

function scatterScenery() {
    const room = rooms[state.roomId];
    if (!room) return;
    const label = document.getElementById('scatter-label').value;
    const gap = Math.max(1, parseInt(document.getElementById('scatter-gap').value, 10) || 3);

    const cands = [];
    for (let y = 1; y < room.height - 1; y++) {
        for (let x = 1; x < room.width - 1; x++) {
            if (!scatterBlocked(x, y)) cands.push([x, y]);
        }
    }
    // Authoring tool — Math.random is fine here (re-roll until it looks good); not simulation code.
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }

    const others = state.scenery.filter(s => s.label !== label);
    const obstacles = others.map(s => [s.x, s.y]);
    const placed = [];
    for (const [x, y] of cands) {
        const clear = [...placed, ...obstacles].every(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) >= gap);
        if (clear) placed.push([x, y]);
    }
    state.scenery = others.concat(placed.map(([x, y]) => ({ x, y, label })));
    renderTileCanvas(); renderDSL(); renderValidation(); saveEditorState();
    document.getElementById('status').textContent = `Scattered ${placed.length} × ${label} (min gap ${gap}). Click again to re-roll.`;
}

function setupScatter() {
    const sel = document.getElementById('scatter-label');
    if (!sel) return;
    SCENERY_SHAPES.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
    document.getElementById('btn-scatter')?.addEventListener('click', scatterScenery);
    document.getElementById('btn-scatter-clear')?.addEventListener('click', () => {
        const label = document.getElementById('scatter-label').value;
        state.scenery = state.scenery.filter(s => s.label !== label);
        renderTileCanvas(); renderDSL(); renderValidation(); saveEditorState();
        document.getElementById('status').textContent = `Cleared all ${label}.`;
    });
}

function getRoomDSL(id) {
    const room = rooms[id];
    if (!room) return '';

    const grid = state._savedGrids[id] || [];
    const scenery = state._savedScenery[id] || (Array.isArray(room.scenery) ? room.scenery : []);
    const exits = state._savedExits[id] || room.exits || {};
    const exitTiles = state._savedExitTiles[id] || (Array.isArray(room.exitTiles) ? room.exitTiles : []);
    const w = room.width;
    const h = room.height;

    // Compute tileOverrides if we don't have a full ASCII grid saved
    const overrides = [];
    if (grid.length === 0) {
        (room.tileOverrides || []).forEach(o => {
            overrides.push(`{ x: ${o.x}, y: ${o.y}, type: '${o.type}' }`);
        });
    } else {
        for (let ty = 0; ty < h; ty++) {
            for (let tx = 0; tx < w; tx++) {
                const char = grid[ty]?.[tx] || '.';
                if (char !== '.') {
                    overrides.push(`{ x: ${tx}, y: ${ty}, type: '${CHAR_TO_TYPE[char]}' }`);
                }
            }
        }
    }

    const sceneryStr = scenery.map(s => `${s.x},${s.y},${s.label}`).join('|');
    const exitStr = exitTiles.map(ex => {
        const parts = [`${ex.x}`, `${ex.y}`, ex.dest, `${ex.destX}`, `${ex.destY}`, ex.type];
        if ((ex.w || 1) !== 1 || (ex.h || 1) !== 1) parts.push(`${ex.w || 1}`, `${ex.h || 1}`);
        return parts.join(',');
    }).join('|');
    const tileRows = grid.map(row => `            '${row.join('')}'`).join(',\n');
    const hasTiles = grid.some(row => row.some(c => c !== '.'));

    const parts = [
        `        name: '${room.name}',`,
        `        description: '${(room.description || '').replace(/'/g, "\\'")}',`,
        `        width: ${w}, height: ${h},`,
        Object.keys(exits).length > 0 ? `        exits: ${JSON.stringify(exits)},` : null,
        exitStr ? `        exitTiles: "${exitStr}",` : null,
        sceneryStr ? `        scenery: "${sceneryStr}",` : null,
        hasTiles ? `        tiles: [\n${tileRows}\n        ],` : null,
        overrides.length > 0 && !hasTiles ? `        tileOverrides: [\n            ${overrides.join(',\n            ')}\n        ],` : null,
    ].filter(Boolean).join('\n');

    return `    ${id}: defineRoom('${id}', {\n${parts}\n    }),`;
}

function renderValidation() {
    const panel = document.getElementById('validation-list');
    if (!panel) return;

    const issues = [];
    const room = rooms[state.roomId];
    const w = room?.width || 0;
    const h = room?.height || 0;

    // Check outbound exits
    for (const [dir, dest] of Object.entries(state.exits)) {
        if (!rooms[dest]) {
            issues.push({ sev: 'error', msg: `exits.${dir} → "${dest}" does not exist` });
        } else {
            const otherExits = state._savedExits[dest] || rooms[dest]?.exits || {};
            if (!Object.values(otherExits).includes(state.roomId)) {
                issues.push({ sev: 'warn', msg: `exits.${dir} → "${dest}" has no return exit` });
            }
        }
    }

    // Check exit tiles
    const tileDestsSeen = new Set();
    for (const ex of state.exitTiles) {
        const x2 = ex.x + (ex.w || 1) - 1;
        const y2 = ex.y + (ex.h || 1) - 1;
        if (ex.x < 0 || ex.y < 0 || x2 >= w || y2 >= h) {
            issues.push({ sev: 'error', msg: `exitTile → "${ex.dest}" at (${ex.x},${ex.y}) out of bounds (${w}×${h})` });
        }
        if (!rooms[ex.dest]) {
            issues.push({ sev: 'error', msg: `exitTile → "${ex.dest}" (room not found)` });
        } else {
            const dest = rooms[ex.dest];
            if (ex.destX < 0 || ex.destY < 0 || ex.destX >= dest.width || ex.destY >= dest.height) {
                issues.push({ sev: 'error', msg: `exitTile → "${ex.dest}" lands at (${ex.destX},${ex.destY}) outside ${dest.width}×${dest.height}` });
            }
        }
        if (tileDestsSeen.has(ex.dest)) {
            issues.push({ sev: 'warn', msg: `duplicate exitTile for "${ex.dest}"` });
        }
        tileDestsSeen.add(ex.dest);
    }

    // Check exits vs exitTiles agreement
    const exitDests = new Set(Object.values(state.exits));
    for (const dest of exitDests) {
        if (!tileDestsSeen.has(dest)) {
            issues.push({ sev: 'warn', msg: `exits includes "${dest}" but no exitTile references it` });
        }
    }
    for (const dest of tileDestsSeen) {
        if (!exitDests.has(dest)) {
            issues.push({ sev: 'warn', msg: `exitTile references "${dest}" but not in exits` });
        }
    }

    // Check exit source tiles are not walled off
    for (const ex of state.exitTiles) {
        const exW = ex.w || 1, exH = ex.h || 1;
        for (let dx = 0; dx < exW; dx++) {
            for (let dy = 0; dy < exH; dy++) {
                const tx = ex.x + dx, ty = ex.y + dy;
                const char = state.grid[ty]?.[tx] || '.';
                if (char === 'W') {
                    issues.push({ sev: 'error', msg: `Exit tile to "${ex.dest}" at (${tx},${ty}) is a wall — player can never step on it` });
                }
            }
        }
    }

    // Check landing tiles in destinations
    for (const ex of state.exitTiles) {
        const dest = rooms[ex.dest];
        if (!dest) continue;
        const savedGrid = state._savedGrids[ex.dest];
        const getChar = (x, y) => {
            if (savedGrid) return savedGrid[y]?.[x] || '.';
            const ov = (state._savedExitTiles[ex.dest] ? [] : dest.tileOverrides || []).find(o => o.x === x && o.y === y);
            return ov?.type === 'wall' ? 'W' : '.';
        };
        const lx = ex.destX, ly = ex.destY;
        const sc = (dest.scenery || []).find(s =>
            lx >= s.x && lx < s.x + (s.w || 1) && ly >= s.y && ly < s.y + (s.h || 1)
        );
        const isWall = (() => {
            if (savedGrid) return savedGrid[ly]?.[lx] === 'W';
            return (dest.tileOverrides || []).some(o => o.x === lx && o.y === ly && o.type === 'wall');
        })();
        if (isWall) issues.push({ sev: 'error', msg: `Exit to "${ex.dest}" lands at (${lx},${ly}) which is a wall in destination` });
        else if (sc) issues.push({ sev: 'warn', msg: `Exit to "${ex.dest}" lands at (${lx},${ly}) on scenery "${sc.label}"` });
    }

    // Check landing coords don't fall on an exit tile in the destination (instant bounce)
    for (const ex of state.exitTiles) {
        const dest = rooms[ex.dest];
        if (!dest) continue;
        const lx = ex.destX, ly = ex.destY;
        for (const dex of dest.exitTiles || []) {
            if (lx >= dex.x && lx <= dex.x + (dex.w || 1) - 1 &&
                ly >= dex.y && ly <= dex.y + (dex.h || 1) - 1) {
                issues.push({ sev: 'error', msg: `Exit to "${ex.dest}" lands at (${lx},${ly}) ON an exit tile to "${dex.dest}" — player bounces immediately` });
            }
        }
    }

    // Check cardinal direction reciprocals match (east↔west, north↔south)
    const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
    for (const [dir, dest] of Object.entries(state.exits)) {
        if (!OPPOSITE[dir] || !rooms[dest]) continue;
        const returnDir = Object.entries(rooms[dest].exits || {}).find(([, v]) => v === state.roomId)?.[0];
        if (returnDir && returnDir !== OPPOSITE[dir]) {
            issues.push({ sev: 'warn', msg: `${state.roomId} goes ${dir} to "${dest}", but "${dest}" returns via ${returnDir} (expected ${OPPOSITE[dir]})` });
        }
    }

    // ── Placement & clutter checks (mirror the engine's validate.js) ──────────
    const charAt = (x, y) => state.grid[y]?.[x] || '.';
    const footAt = new Map();
    let footCells = 0, openCells = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = charAt(x, y); if (c !== 'W' && c !== 'V') openCells++; }
    for (const s of state.scenery) {
        const [sw, sh] = FOOT(s.label);
        for (let oy = 0; oy < sh; oy++) for (let ox = 0; ox < sw; ox++) {
            const cx = s.x + ox, cy = s.y + oy, key = `${cx},${cy}`;
            if (cx < 0 || cy < 0 || cx >= w || cy >= h) { issues.push({ sev: 'error', msg: `scenery "${s.label}" out of bounds at (${cx},${cy})` }); continue; }
            footCells++;
            if (footAt.has(key)) issues.push({ sev: 'error', msg: `overlapping scenery at (${cx},${cy}): "${footAt.get(key)}" & "${s.label}"` });
            else footAt.set(key, s.label);
            const ch = charAt(cx, cy);
            if (ch === 'V') issues.push({ sev: 'error', msg: `"${s.label}" sits on water at (${cx},${cy})` });
            if (ch === 'W' && !WALL_MOUNTABLE.has(s.label)) issues.push({ sev: 'error', msg: `"${s.label}" is buried in a wall at (${cx},${cy})` });
        }
    }
    if (openCells > 0 && footCells / openCells > CLUTTER_WARN) {
        issues.push({ sev: 'warn', msg: `Cramped — props cover ${Math.round(footCells / openCells * 100)}% of the open floor (aim under ${Math.round(CLUTTER_WARN * 100)}%)` });
    }
    for (const s of state.scenery) {
        if (!TALL_SCENERY.has(s.label) || s.y <= 0) continue;
        const [sw] = FOOT(s.label);
        for (let ox = 0; ox < sw; ox++) { const a = footAt.get(`${s.x + ox},${s.y - 1}`); if (a) issues.push({ sev: 'warn', msg: `tall "${s.label}" at (${s.x},${s.y}) is overlapped by "${a}" directly above` }); }
    }
    for (const s of state.scenery) {
        if (!WALL_ANCHORED.has(s.label)) continue;
        const [sw, sh] = FOOT(s.label);
        let anchored = false;
        for (let oy = 0; oy < sh && !anchored; oy++) for (let ox = 0; ox < sw && !anchored; ox++) {
            const cx = s.x + ox, cy = s.y + oy;
            if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) anchored = true;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (charAt(cx + dx, cy + dy) === 'W') anchored = true;
        }
        if (!anchored) issues.push({ sev: 'warn', msg: `"${s.label}" at (${s.x},${s.y}) floats — wall-prop with no adjacent wall` });
    }
    let touching = 0;
    for (let i = 0; i < state.scenery.length; i++) for (let j = i + 1; j < state.scenery.length; j++) {
        const a = state.scenery[i], b = state.scenery[j];
        if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) touching++;
    }
    if (touching >= 8) issues.push({ sev: 'warn', msg: `${touching} prop pairs sit edge-to-edge — space them out` });

    // Global graph health — orphan detection
    const orphans = orphanedRooms();
    if (orphans.length > 0) {
        issues.unshift({ sev: 'error', msg: `Graph disconnected — unreachable rooms: ${orphans.join(', ')}` });
    }

    panel.innerHTML = '';
    if (issues.length === 0) {
        const ok = document.createElement('div');
        ok.style.color = '#33aa55';
        ok.style.fontSize = '10px';
        ok.style.padding = '4px';
        ok.textContent = '✓ No issues';
        panel.appendChild(ok);
        return;
    }
    issues.forEach(({ sev, msg }) => {
        const div = document.createElement('div');
        div.style.padding = '3px 6px';
        div.style.fontSize = '10px';
        div.style.borderLeft = sev === 'error' ? '3px solid #cc3333' : '3px solid #cc9933';
        div.style.color = sev === 'error' ? '#ff8888' : '#ffcc66';
        div.style.marginBottom = '2px';
        div.style.background = '#1a1a1a';
        div.textContent = (sev === 'error' ? '✖ ' : '⚠ ') + msg;
        panel.appendChild(div);
    });
}

function renderDSL() {
    const dsl = getRoomDSL(state.roomId);
    document.getElementById('dsl-out').value = dsl;
    renderValidation(); // keep placement/clutter warnings live on every edit
}

function exportAll() {
    const header = "import { defineRoom } from '../define.js';\n\nexport const rooms = {\n";
    const footer = "};\n";
    const body = Object.keys(rooms).map(id => getRoomDSL(id)).join('\n\n');
    const fullContent = header + body + footer;

    const blob = new Blob([fullContent], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rooms.js';
    a.click();
    URL.revokeObjectURL(url);
    
    document.getElementById('status').textContent = 'Project exported! Replace src/content/data/rooms.js with this file.';
    setTimeout(() => document.getElementById('status').textContent = '', 5000);
}

// ── World Graph ───────────────────────────────────────────────────────────────

function computeGraphLayout(forceReset = false) {
    const ids = Object.keys(rooms);
    const positions = {};

    // Seed positions from direction hints (BFS pass)
    const dirOffsets = {
        north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
        north_east: [0.7, -0.7], south_east: [0.7, 0.7],
        south_west: [-0.7, 0.7], north_west: [-0.7, -0.7],
        up: [-0.3, -0.3], down: [0.3, 0.3],
    };
    const SPACING = 150;
    const visited = new Set();
    const queue = [{ id: ids[0], x: 0, y: 0 }];
    visited.add(ids[0]);
    while (queue.length) {
        const { id, x, y } = queue.shift();
        positions[id] = { x, y };
        for (const [dir, destId] of Object.entries(rooms[id].exits || {})) {
            if (!visited.has(destId) && rooms[destId]) {
                visited.add(destId);
                const [dx, dy] = dirOffsets[dir] || [0, 0];
                queue.push({ id: destId, x: x + dx * SPACING, y: y + dy * SPACING });
            }
        }
    }
    ids.forEach((id, i) => { if (!positions[id]) positions[id] = { x: 600 + (i % 4) * SPACING, y: Math.floor(i / 4) * SPACING }; });

    // If we have stored positions and not forcing reset, use those for already-placed nodes
    if (!forceReset) {
        ids.forEach(id => { if (state.roomPositions[id]) positions[id] = { ...state.roomPositions[id] }; });
    }

    // Force-directed refinement (spring + repulsion, 300 iterations with cooling)
    const edges = [];
    ids.forEach(id => {
        Object.values(rooms[id].exits || {}).forEach(destId => {
            if (rooms[destId] && id < destId) edges.push([id, destId]);
        });
    });

    const K_REPULSE = 12000;
    const K_ATTRACT = 0.04;
    const REST_LEN = 160;
    const vel = {};
    ids.forEach(id => { vel[id] = { x: 0, y: 0 }; });

    for (let iter = 0; iter < 300; iter++) {
        const cooling = 1 - iter / 300;
        const forces = {};
        ids.forEach(id => { forces[id] = { x: 0, y: 0 }; });

        // Repulsion between all pairs
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const a = ids[i], b = ids[j];
                const dx = positions[b].x - positions[a].x;
                const dy = positions[b].y - positions[a].y;
                const d = Math.max(Math.hypot(dx, dy), 1);
                const f = K_REPULSE / (d * d);
                forces[a].x -= (dx / d) * f;
                forces[a].y -= (dy / d) * f;
                forces[b].x += (dx / d) * f;
                forces[b].y += (dy / d) * f;
            }
        }

        // Attraction along edges
        for (const [a, b] of edges) {
            const dx = positions[b].x - positions[a].x;
            const dy = positions[b].y - positions[a].y;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const f = K_ATTRACT * (d - REST_LEN);
            forces[a].x += (dx / d) * f;
            forces[a].y += (dy / d) * f;
            forces[b].x -= (dx / d) * f;
            forces[b].y -= (dy / d) * f;
        }

        ids.forEach(id => {
            vel[id].x = (vel[id].x + forces[id].x) * 0.6;
            vel[id].y = (vel[id].y + forces[id].y) * 0.6;
            const speed = Math.hypot(vel[id].x, vel[id].y);
            const maxSpeed = 8 * cooling + 1;
            if (speed > maxSpeed) { vel[id].x *= maxSpeed / speed; vel[id].y *= maxSpeed / speed; }
            positions[id].x += vel[id].x;
            positions[id].y += vel[id].y;
        });
    }

    // Normalize to start at (40, 40)
    const minX = Math.min(...ids.map(id => positions[id].x));
    const minY = Math.min(...ids.map(id => positions[id].y));
    ids.forEach(id => { positions[id].x -= minX - 40; positions[id].y -= minY - 40; });

    state.roomPositions = positions;
}

function renderGraph() {
    const canvas = document.getElementById('graph-canvas');
    const panel = document.getElementById('graph-panel');
    canvas.width = panel.clientWidth || 400;
    canvas.height = panel.clientHeight || 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { x: ox, y: oy } = state.graphOffset;
    const z = state.graphZoom;

    // Draw edges
    Object.keys(rooms).forEach((id) => {
        const pos = state.roomPositions[id];
        if (!pos) return;

        // Use active state for current room, or static data for others
        const exits = id === state.roomId ? state.exits : (state._savedExits[id] || rooms[id]?.exits || {});

        Object.entries(exits).forEach(([dir, destId]) => {
            const dest = state.roomPositions[destId];
            if (!dest) return;

            // Check reciprocal exit (accounting for active state)
            const otherExits = destId === state.roomId ? state.exits : (state._savedExits[destId] || rooms[destId]?.exits || {});
            const reciprocal = Object.values(otherExits).includes(id);

            const x1 = pos.x * z + ox;
            const y1 = pos.y * z + oy;
            const x2 = dest.x * z + ox;
            const y2 = dest.y * z + oy;

            if (reciprocal) {
                // Draw single solid green line for bidirectional
                if (id < destId) { // Only draw once
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = (id === state.roomId || destId === state.roomId) ? '#55cc77' : '#2a5a3a';
                    ctx.lineWidth = (id === state.roomId || destId === state.roomId) ? 3 : 1.5;
                    ctx.setLineDash([]);
                    ctx.stroke();
                }
            } else {
                // Draw red arrow for one-way
                const color = (id === state.roomId || destId === state.roomId) ? '#ff4444' : '#aa3333';
                drawArrow(ctx, x1, y1, x2, y2, color, true);
            }
        });
    });

    // Draw nodes
    Object.entries(state.roomPositions).forEach(([id, pos]) => {
        const room = rooms[id];
        const x = pos.x * z + ox;
        const y = pos.y * z + oy;
        const isActive = id === state.roomId;
        const r = isActive ? 9 : 7;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#33aa55' : '#2a4a3a';
        ctx.fill();
        ctx.strokeStyle = isActive ? '#55cc77' : '#4a7a5a';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();

        ctx.fillStyle = isActive ? '#fff' : '#aaa';
        ctx.font = `${Math.max(9, Math.floor(10 * z))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = id.replace(/_/g, ' ');
        ctx.fillText(label, x, y + r + 4);
    });
}

function setupGraphCanvas() {
    const canvas = document.getElementById('graph-canvas');
    const resizeObs = new ResizeObserver(() => renderGraph());
    resizeObs.observe(document.getElementById('graph-panel'));

    document.getElementById('btn-reset-layout')?.addEventListener('click', () => {
        state.roomPositions = {};
        computeGraphLayout(true);
        renderGraph();
    });

    canvas.addEventListener('mousedown', (e) => {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const { x: ox, y: oy } = state.graphOffset;
        const z = state.graphZoom;

        for (const [id, pos] of Object.entries(state.roomPositions)) {
            const px = pos.x * z + ox;
            const py = pos.y * z + oy;
            if (Math.hypot(mx - px, my - py) < 15) {
                state.nodeDrag = { id, startX: mx, startY: my, initPos: { ...pos } };
                loadRoom(id);
                return;
            }
        }
        // Start drag
        state.graphDrag = { startX: e.clientX - ox, startY: e.clientY - oy };
    });

    canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const z = state.graphZoom;

        if (state.nodeDrag) {
            const dx = (mx - state.nodeDrag.startX) / z;
            const dy = (my - state.nodeDrag.startY) / z;
            state.roomPositions[state.nodeDrag.id].x = state.nodeDrag.initPos.x + dx;
            state.roomPositions[state.nodeDrag.id].y = state.nodeDrag.initPos.y + dy;
            renderGraph();
            return;
        }

        if (!state.graphDrag) return;
        state.graphOffset.x = e.clientX - state.graphDrag.startX;
        state.graphOffset.y = e.clientY - state.graphDrag.startY;
        renderGraph();
    });

    window.addEventListener('mouseup', () => { 
        state.graphDrag = null; 
        state.nodeDrag = null;
        saveEditorState();
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        state.graphZoom = Math.max(0.3, Math.min(3, state.graphZoom * factor));
        renderGraph();
    }, { passive: false });
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function setupToolbar() {
    const copy = () => {
        navigator.clipboard.writeText(document.getElementById('dsl-out').value).then(() => {
            document.getElementById('status').textContent = 'Copied to clipboard!';
            setTimeout(() => document.getElementById('status').textContent = '', 2000);
        });
    };
    document.getElementById('btn-copy').addEventListener('click', copy);
    document.getElementById('btn-copy2').addEventListener('click', copy);
    document.getElementById('btn-export').addEventListener('click', exportAll);

    const updateSize = () => {
        const room = rooms[state.roomId];
        const nw = parseInt(document.getElementById('inp-width').value) || 2;
        const nh = parseInt(document.getElementById('inp-height').value) || 2;
        room.width = nw;
        room.height = nh;
        
        // Adjust grid
        while (state.grid.length < nh) state.grid.push(Array(nw).fill('.'));
        state.grid = state.grid.slice(0, nh).map(row => {
            while (row.length < nw) row.push('.');
            return row.slice(0, nw);
        });
        
        renderTileCanvas(); renderDSL(); saveEditorState();
    };

    document.getElementById('inp-width').addEventListener('change', updateSize);
    document.getElementById('inp-height').addEventListener('change', updateSize);

    document.getElementById('btn-add-row').addEventListener('click', () => {
        const h = parseInt(document.getElementById('inp-height').value);
        document.getElementById('inp-height').value = h + 1;
        updateSize();
    });

    document.getElementById('btn-del-row').addEventListener('click', () => {
        const h = parseInt(document.getElementById('inp-height').value);
        if (h > 2) {
            document.getElementById('inp-height').value = h - 1;
            updateSize();
        }
    });

    document.getElementById('btn-add-col').addEventListener('click', () => {
        const w = parseInt(document.getElementById('inp-width').value);
        document.getElementById('inp-width').value = w + 1;
        updateSize();
    });

    document.getElementById('btn-del-col').addEventListener('click', () => {
        const w = parseInt(document.getElementById('inp-width').value);
        if (w > 2) {
            document.getElementById('inp-width').value = w - 1;
            updateSize();
        }
    });
}

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'hearthwick_editor_v1';

function saveEditorState() {
    try {
        // Update in-memory saved maps immediately so other rooms (renderGraph) see them
        state._savedGrids[state.roomId] = state.grid;
        state._savedScenery[state.roomId] = state.scenery;
        state._savedExits[state.roomId] = state.exits;
        state._savedExitTiles[state.roomId] = state.exitTiles;

        const data = {
            roomId: state.roomId,
            grids: state._savedGrids,
            sceneryMap: state._savedScenery,
            exitsMap: state._savedExits,
            exitTilesMap: state._savedExitTiles,
            roomPositions: state.roomPositions,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
}

function loadEditorState() {
    try {
        const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        state._savedGrids = data.grids || {};
        state._savedScenery = data.sceneryMap || {};
        state._savedExits = data.exitsMap || {};
        state._savedExitTiles = data.exitTilesMap || {};
        state.roomPositions = data.roomPositions || {};
        const startRoom = (data.roomId && rooms[data.roomId]) ? data.roomId : state.roomId;
        loadRoom(startRoom);
    } catch {
        loadRoom(state.roomId);
    }
}

init();
