/**
 * Hearthwick Map Editor (Phase 8.2B)
 * Standalone browser tool — zero dependencies, no server needed.
 * Open tools/editor.html directly in browser (file:// or local server).
 */

import { drawTile, zoneTileType, getGrayscaleTemplate, applyPalette, getSceneryPalette } from '../src/graphics/graphics.js';
import { rooms } from '../src/content/data/rooms.js';

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

// ── State ────────────────────────────────────────────────────────────────────

const state = {
    roomId: Object.keys(rooms)[0],
    grid: [],          // 2D array of chars (tile type chars)
    scenery: [],       // [{x,y,label}]
    exits: {},         // logical exits {north: 'id'}
    exitTiles: [],     // parsed exit objects [{x,y,dest,...}]
    activeTile: '.',   // currently selected tile char
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

function setupExitHandlers() {
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

        // 2. Handle reciprocal
        if (reciprocal) {
            const revDir = REVERSE_DIR[dir];
            if (revDir) {
                const destSavedExits = state._savedExits[dest] || { ...(rooms[dest]?.exits || {}) };
                destSavedExits[revDir] = state.roomId;
                state._savedExits[dest] = destSavedExits;
                
                const destSavedTiles = state._savedExitTiles[dest] || (Array.isArray(rooms[dest]?.exitTiles) ? [...rooms[dest].exitTiles] : []);
                if (!destSavedTiles.find(e => e.dest === state.roomId)) {
                    destSavedTiles.push({ x: dx, y: dy, dest: state.roomId, destX: x, destY: y, type, w: 1, h: 1 });
                }
                state._savedExitTiles[dest] = destSavedTiles;
            }
        }
        
        renderExitsUI();
        renderGraph();
        renderDSL();
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
            delete state.exits[dir];
            state.exitTiles = state.exitTiles.filter(e => e.dest !== destId);
            renderExitsUI();
            renderGraph();
            renderDSL();
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

    // Draw exit overlays
    (state.exitTiles || []).forEach(ex => {
        if (ex.x < 0 || ex.y < 0) return;
        ctx.fillStyle = 'rgba(80,200,120,0.35)';
        ctx.fillRect(ex.x * S, ex.y * S, S, S);
        ctx.strokeStyle = '#33aa55';
        ctx.lineWidth = 1;
        ctx.strokeRect(ex.x * S + 0.5, ex.y * S + 0.5, S - 1, S - 1);
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

        painting = true;
        paintTile(tx, ty);
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!painting) return;
        const { tx, ty } = getPos(e);
        paintTile(tx, ty);
        // Update status
        const char = state.grid[ty]?.[tx] || '.';
        const type = CHAR_TO_TYPE[char] || zoneTileType(state.roomId);
        document.getElementById('status').textContent = `(${tx},${ty}) ${type}`;
    });

    canvas.addEventListener('mouseleave', () => { painting = false; });
    window.addEventListener('mouseup', () => { painting = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
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
    const exitStr = exitTiles.map(ex => `${ex.x},${ex.y},${ex.dest},${ex.destX},${ex.destY},${ex.type}`).join('|');
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

function renderDSL() {
    const dsl = getRoomDSL(state.roomId);
    document.getElementById('dsl-out').value = dsl;
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

function computeGraphLayout() {
    // Simple force-directed layout seed from structure
    const ids = Object.keys(rooms);
    const visited = new Set();
    const positions = {};
    const spacing = 140; // Increased spacing for better legibility

    const dirOffsets = { 
        north: [0, -1], 
        north_east: [0.7, -0.7],
        east: [1, 0], 
        south_east: [0.7, 0.7],
        south: [0, 1], 
        south_west: [-0.7, 0.7],
        west: [-1, 0], 
        north_west: [-0.7, -0.7],
        up: [-0.4, -0.4], 
        down: [0.4, 0.4] 
    };

    const isOccupied = (x, y) => {
        return Object.values(positions).some(p => Math.hypot(p.x - x, p.y - y) < spacing * 0.4);
    };

    // BFS from first room
    const queue = [{ id: ids[0], x: 0, y: 0 }];
    visited.add(ids[0]);
    while (queue.length > 0) {
        const { id, x, y } = queue.shift();
        
        let nx = x, ny = y;
        let nudgeAttempt = 0;
        while (isOccupied(nx, ny) && nudgeAttempt < 8) {
            nx += 30;
            ny += 20;
            nudgeAttempt++;
        }

        positions[id] = { x: nx, y: ny };
        const room = rooms[id];
        const dirs = room.exits || {};
        for (const [dir, destId] of Object.entries(dirs)) {
            if (!visited.has(destId) && rooms[destId]) {
                visited.add(destId);
                const [dx, dy] = dirOffsets[dir] || [0, 0];
                queue.push({ id: destId, x: nx + dx * spacing, y: ny + dy * spacing });
            }
        }
    }

    // Any orphans (placed in a separate grid to avoid tangles)
    let orphanIdx = 0;
    ids.forEach((id) => {
        if (!positions[id]) {
            positions[id] = { x: 800 + (orphanIdx % 3) * spacing, y: Math.floor(orphanIdx / 3) * spacing };
            orphanIdx++;
        }
    });

    // Normalize and center
    const minX = Math.min(...Object.values(positions).map(p => p.x));
    const minY = Math.min(...Object.values(positions).map(p => p.y));
    Object.values(positions).forEach((p, i) => { 
        const id = ids[i];
        if (state.roomPositions[id]) {
            p.x = state.roomPositions[id].x;
            p.y = state.roomPositions[id].y;
        } else {
            p.x -= minX - 40; 
            p.y -= minY - 40; 
        }
    });

    state.roomPositions = { ...positions, ...state.roomPositions };
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
