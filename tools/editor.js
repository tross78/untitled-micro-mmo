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
    exits: [],         // parsed exit objects
    activeTile: '.',   // currently selected tile char
    graphOffset: { x: 0, y: 0 },
    graphZoom: 1,
    graphDrag: null,
    roomPositions: {}, // {roomId: {x,y}} for graph layout
    pendingSceneryPos: null,
};

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
    buildRoomSelect();
    buildPalette();
    buildSceneryModal();
    computeGraphLayout();
    loadEditorState(); // must come before loadRoom so _savedGrids/_savedScenery are populated
    setupGraphCanvas();
    setupTileCanvas();
    setupToolbar();
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
        : (room.scenery || []).map(s => ({ ...s }));
    state.exits = (room.exitTiles || []);

    document.getElementById('room-select').value = id;
    document.getElementById('room-size').textContent = `${w}×${h}`;

    renderTileCanvas();
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
    (state.exits || []).forEach(ex => {
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

// ── DSL Generator ─────────────────────────────────────────────────────────────

function renderDSL() {
    const room = rooms[state.roomId];
    if (!room) return;

    const id = state.roomId;
    const w = room.width;
    const h = room.height;

    // Compute tileOverrides from grid (only non-default cells)
    const overrides = [];
    for (let ty = 0; ty < h; ty++) {
        for (let tx = 0; tx < w; tx++) {
            const char = state.grid[ty]?.[tx] || '.';
            if (char !== '.') {
                overrides.push(`{ x: ${tx}, y: ${ty}, type: '${CHAR_TO_TYPE[char]}' }`);
            }
        }
    }

    // Scenery DSL
    const sceneryStr = state.scenery.map(s => `${s.x},${s.y},${s.label}`).join('|');

    // Exits DSL (read from original room, not editable in this MVP)
    const exitStr = (room.exitTiles || []).map(ex =>
        `${ex.x},${ex.y},${ex.dest},${ex.destX},${ex.destY},${ex.type}`
    ).join('|');

    // Tile grid rows (compact ASCII grid)
    const tileRows = state.grid.map(row => `    '${row.join('')}'`).join(',\n');
    const hasTiles = state.grid.some(row => row.some(c => c !== '.'));

    const parts = [
        `    name: '${room.name}',`,
        `    description: '${(room.description || '').replace(/'/g, "\\'")}',`,
        `    width: ${w}, height: ${h},`,
        room.exits ? `    exits: ${JSON.stringify(room.exits)},` : null,
        exitStr ? `    exitTiles: "${exitStr}",` : null,
        sceneryStr ? `    scenery: "${sceneryStr}",` : null,
        hasTiles ? `    tiles: [\n${tileRows}\n    ],` : null,
        overrides.length > 0 && !hasTiles ? `    tileOverrides: [\n        ${overrides.join(',\n        ')}\n    ],` : null,
    ].filter(Boolean).join('\n');

    const dsl = `${id}: defineRoom('${id}', {\n${parts}\n}),`;
    document.getElementById('dsl-out').value = dsl;
}

// ── World Graph ───────────────────────────────────────────────────────────────

function computeGraphLayout() {
    // Simple force-directed layout seed from structure
    const ids = Object.keys(rooms);
    const visited = new Set();
    const positions = {};
    const spacing = 80;

    // BFS from first room
    const queue = [{ id: ids[0], x: 0, y: 0 }];
    visited.add(ids[0]);
    while (queue.length > 0) {
        const { id, x, y } = queue.shift();
        positions[id] = { x, y };
        const room = rooms[id];
        const dirs = room.exits || {};
        const dirOffsets = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };
        for (const [dir, destId] of Object.entries(dirs)) {
            if (!visited.has(destId) && rooms[destId]) {
                visited.add(destId);
                const [dx, dy] = dirOffsets[dir] || [0, 0];
                queue.push({ id: destId, x: x + dx * spacing, y: y + dy * spacing });
            }
        }
    }

    // Any orphans
    ids.forEach((id, i) => {
        if (!positions[id]) positions[id] = { x: (i % 5) * spacing, y: Math.floor(i / 5) * spacing };
    });

    // Normalize to start from positive coords
    const minX = Math.min(...Object.values(positions).map(p => p.x));
    const minY = Math.min(...Object.values(positions).map(p => p.y));
    Object.values(positions).forEach(p => { p.x -= minX - 30; p.y -= minY - 30; });

    state.roomPositions = positions;
}

function renderGraph() {
    const canvas = document.getElementById('graph-canvas');
    const panel = document.getElementById('graph-panel');
    canvas.width = panel.clientWidth || 280;
    canvas.height = panel.clientHeight || 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { x: ox, y: oy } = state.graphOffset;
    const z = state.graphZoom;

    // Draw edges
    const drawn = new Set();
    Object.entries(rooms).forEach(([id, room]) => {
        const pos = state.roomPositions[id];
        if (!pos) return;
        Object.entries(room.exits || {}).forEach(([dir, destId]) => {
            const key = [id, destId].sort().join('|');
            if (drawn.has(key)) return;
            drawn.add(key);
            const dest = state.roomPositions[destId];
            if (!dest) return;

            // Check reciprocal exit
            const reciprocal = Object.values(rooms[destId]?.exits || {}).includes(id);
            ctx.beginPath();
            ctx.moveTo(pos.x * z + ox, pos.y * z + oy);
            ctx.lineTo(dest.x * z + ox, dest.y * z + oy);
            ctx.strokeStyle = reciprocal ? '#2a5a3a' : '#aa3333';
            ctx.lineWidth = reciprocal ? 1.5 : 1;
            ctx.setLineDash(reciprocal ? [] : [4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
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
        ctx.font = `${Math.min(10, Math.max(7, 9 * z))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(id.replace(/_/g, '·'), x, y + r + 2);
    });
}

function setupGraphCanvas() {
    const canvas = document.getElementById('graph-canvas');
    const resizeObs = new ResizeObserver(() => renderGraph());
    resizeObs.observe(document.getElementById('graph-panel'));

    canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const { x: ox, y: oy } = state.graphOffset;
        const z = state.graphZoom;

        for (const [id, pos] of Object.entries(state.roomPositions)) {
            const px = pos.x * z + ox;
            const py = pos.y * z + oy;
            if (Math.hypot(mx - px, my - py) < 12) {
                loadRoom(id);
                return;
            }
        }
        // Start drag
        state.graphDrag = { startX: e.clientX - ox, startY: e.clientY - oy };
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!state.graphDrag) return;
        state.graphOffset.x = e.clientX - state.graphDrag.startX;
        state.graphOffset.y = e.clientY - state.graphDrag.startY;
        renderGraph();
    });

    window.addEventListener('mouseup', () => { state.graphDrag = null; });

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

    document.getElementById('btn-add-row').addEventListener('click', () => {
        const room = rooms[state.roomId];
        if (!room) return;
        room.height++;
        state.grid.push(Array(room.width).fill('.'));
        document.getElementById('room-size').textContent = `${room.width}×${room.height}`;
        renderTileCanvas(); renderDSL(); saveEditorState();
    });

    document.getElementById('btn-del-row').addEventListener('click', () => {
        const room = rooms[state.roomId];
        if (!room || room.height <= 2) return;
        room.height--;
        state.grid.pop();
        document.getElementById('room-size').textContent = `${room.width}×${room.height}`;
        renderTileCanvas(); renderDSL(); saveEditorState();
    });

    document.getElementById('btn-add-col').addEventListener('click', () => {
        const room = rooms[state.roomId];
        if (!room) return;
        room.width++;
        state.grid.forEach(row => row.push('.'));
        document.getElementById('room-size').textContent = `${room.width}×${room.height}`;
        renderTileCanvas(); renderDSL(); saveEditorState();
    });

    document.getElementById('btn-del-col').addEventListener('click', () => {
        const room = rooms[state.roomId];
        if (!room || room.width <= 2) return;
        room.width--;
        state.grid.forEach(row => row.pop());
        document.getElementById('room-size').textContent = `${room.width}×${room.height}`;
        renderTileCanvas(); renderDSL(); saveEditorState();
    });
}

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'hearthwick_editor_v1';

function saveEditorState() {
    try {
        const existing = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        const data = {
            roomId: state.roomId,
            grids: { ...(existing.grids || {}) },
            sceneryMap: { ...(existing.sceneryMap || {}) },
        };
        data.grids[state.roomId] = state.grid;
        data.sceneryMap[state.roomId] = state.scenery;
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
}

function loadEditorState() {
    try {
        const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        state._savedGrids = data.grids || {};
        state._savedScenery = data.sceneryMap || {};
        const startRoom = (data.roomId && rooms[data.roomId]) ? data.roomId : state.roomId;
        loadRoom(startRoom);
    } catch {
        loadRoom(state.roomId);
    }
}

init();
