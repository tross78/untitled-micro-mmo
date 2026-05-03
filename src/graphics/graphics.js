// Inline seeded RNG — no dep on rules.js so graphics stays renderer-only
function tileRng(seed) {
    let s = (seed * 2654435761) >>> 0;
    return (n) => {
        s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
        s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
        s = (s ^ (s >>> 16)) >>> 0;
        return n === undefined ? s : s % n;
    };
}

// LttP + Stardew unified palette — saturated, 16-bit SNES feel
const TILE_PAL = {
    grass:       { base: '#3d6b2a', hi: '#5a9a38', lo: '#274518', accent: '#80c050' },
    stone_floor: { base: '#6e6458', hi: '#8a7d6f', lo: '#48413a', accent: '#a09080' },
    wall:        { base: '#4a5248', hi: '#6a7260', lo: '#282e28', accent: '#8a9080' },
    water:       { base: '#1a3f6a', hi: '#2e608a', lo: '#0e2540', accent: '#6aaac8' },
    exit:        { base: '#0a2a0a', hi: '#33aa55', lo: '#051505', accent: '#44dd77' },
    interior:    { base: '#8a5a28', hi: '#b87c3a', lo: '#5a3818', accent: '#d4a060' },
    dungeon:     { base: '#5a6878', hi: '#7a90a8', lo: '#3a4858', accent: '#b0c4d8' },
    cave:        { base: '#6a5038', hi: '#8a6a4a', lo: '#3e2e20', accent: '#a8845c' },
    ice:         { base: '#b8d8e8', hi: '#ddf0f8', lo: '#8ab0c8', accent: '#ffffff' },
};

const zoneTileType = (locationId) => {
    const map = {
        cellar: 'stone_floor',   hallway: 'stone_floor',
        library: 'stone_floor',  crossroads: 'stone_floor',
        ruins: 'stone_floor',    ruins_descent: 'stone_floor',
        tavern: 'interior',      market: 'interior',
        herbalist_hut: 'interior', mill: 'interior',
        forest_edge: 'grass',    forest_depths: 'grass',
        bandit_camp: 'grass',    cemetery: 'grass',
        frozen_lake: 'ice',
        lake_shore: 'water',     harbour: 'water',
        mountain_pass: 'wall',   watchtower: 'wall',
        catacombs: 'dungeon',    dungeon_cell: 'dungeon',
        throne_room: 'dungeon',
        cave: 'cave',            sea_cave: 'cave',
        smuggler_den: 'cave',
    };
    return map[locationId] || 'stone_floor';
};
export { zoneTileType };

export function drawTile(ctx, tileType, cx, cy, rngSeed, S = 16) {
    const p = TILE_PAL[tileType] || TILE_PAL.stone_floor;
    const rng = tileRng(rngSeed ^ 0xdeadbeef);

    ctx.fillStyle = p.base;
    ctx.fillRect(cx, cy, S, S);

    if (tileType === 'grass') {
        // Darker patch variation
        if (rng(3) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx, cy, S, S);
        }
        // Tufts
        for (let i = 0; i < 4 + rng(5); i++) {
            ctx.fillStyle = rng(2) ? p.hi : p.accent;
            const tx = cx + rng(S - 2);
            const ty = cy + rng(S - 3);
            ctx.fillRect(tx, ty + 1, 1, 2);
            ctx.fillRect(tx, ty, 1, 1);
        }
        // Pebble
        if (rng(6) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + rng(S - 2), cy + rng(S - 2), 1, 1);
        }
        // Flower
        if (rng(9) === 0) {
            ctx.fillStyle = rng(2) ? '#ffcc44' : '#ff88aa';
            const fx = cx + 2 + rng(S - 6);
            const fy = cy + 2 + rng(S - 6);
            ctx.fillRect(fx, fy, 2, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(fx, fy, 1, 1);
        }
        if (rng(4) === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(cx, cy, S, 1);
        }

    } else if (tileType === 'stone_floor') {
        // Flagstone grid
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S / 2), S, 1);
        ctx.fillRect(cx + Math.floor(S / 2), cy, 1, S);
        // Bevel
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 1, cy + 1, Math.floor(S / 2) - 2, 1);
        ctx.fillRect(cx + 1, cy + 1, 1, Math.floor(S / 2) - 2);
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + Math.floor(S / 2) + 2, cy + Math.floor(S / 2) + 2, Math.floor(S / 3), 1);
        // Wear marks
        for (let i = 0; i < 3; i++) {
            if (rng(4) === 0) {
                ctx.fillStyle = p.lo;
                ctx.fillRect(cx + 2 + rng(S - 4), cy + 2 + rng(S - 4), 1, 1);
            }
        }

    } else if (tileType === 'wall') {
        // Brick rows with stagger
        const brickRow = Math.floor(rngSeed / 100) % 2;
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + (brickRow ? 0 : Math.floor(S / 2)), cy + 1, Math.floor(S / 2) - 2, Math.floor(S / 2) - 2);
        ctx.fillRect(cx + (brickRow ? Math.floor(S / 2) : 0), cy + Math.floor(S / 2) + 1, Math.floor(S / 2) - 2, Math.floor(S / 2) - 2);
        // Mortar
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S / 2), S, 1);
        ctx.fillRect(cx + Math.floor(S / 3), cy, 1, S);
        // Bevel
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + (brickRow ? 1 : Math.floor(S / 2) + 1), cy + 2, 2, 1);
        // Cracks
        if (rng(5) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 1 + rng(S - 3), cy + 1 + rng(S / 2), 1, 2 + rng(3));
        }

    } else if (tileType === 'water') {
        // Wave bands
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i === 0 ? p.hi : p.accent;
            const wy = cy + 2 + rng(S - 6);
            ctx.fillRect(cx + 1 + rng(3), wy, Math.floor(S * 0.45), 1);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(cx, cy + Math.floor(S * 0.2), S, 1);
        // Shimmer
        if (rng(3) === 0) {
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.35;
            ctx.fillRect(cx + rng(S - 2), cy + rng(S - 2), 2, 1);
            ctx.globalAlpha = 1.0;
        }

    } else if (tileType === 'exit') {
        // Glowing portal rings
        const cx2 = cx + Math.floor(S / 2);
        const cy2 = cy + Math.floor(S / 2);
        [[6, p.hi], [4, p.accent], [2, '#ffffff']].forEach(([r, color]) => {
            ctx.beginPath();
            ctx.arc(cx2, cy2, r * (S / 16), 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });
        ctx.beginPath();
        ctx.arc(cx2, cy2, 1, 0, Math.PI * 2);
        ctx.fillStyle = p.base;
        ctx.fill();

    } else if (tileType === 'interior') {
        // Warm wood planks (Stardew style)
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, S, S);
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S * 0.33), S, 1);
        ctx.fillRect(cx, cy + Math.floor(S * 0.66), S, 1);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx, cy + 1, S, Math.floor(S * 0.33) - 1);
        ctx.fillRect(cx, cy + Math.floor(S * 0.33) + 1, S, Math.floor(S * 0.33) - 1);
        ctx.fillRect(cx, cy + Math.floor(S * 0.66) + 1, S, Math.floor(S * 0.34) - 1);
        // Plank knot
        if (rng(7) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 3 + rng(S - 8), cy + 4 + rng(4), 3, 2);
            ctx.fillStyle = p.base;
            ctx.fillRect(cx + 4 + rng(S - 10), cy + 5 + rng(2), 1, 1);
        }
        // Grain highlight
        if (rng(3) === 0) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 1 + rng(S - 4), cy + 1 + rng(S - 4), 3, 1);
        }

    } else if (tileType === 'dungeon') {
        // LttP dungeon floor — blue-grey interlocking tiles
        const h = Math.floor(S / 2);
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 1, cy + 1, h - 2, h - 2);
        ctx.fillRect(cx + h + 1, cy + h + 1, h - 2, h - 2);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx + h + 1, cy + 1, h - 2, h - 2);
        ctx.fillRect(cx + 1, cy + h + 1, h - 2, h - 2);
        // Mortar lines
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h, S, 1);
        ctx.fillRect(cx + h, cy, 1, S);
        // Bevel on bright quadrants
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + 1, cy + 1, h - 3, 1);
        ctx.fillRect(cx + 1, cy + 1, 1, h - 3);
        ctx.fillRect(cx + h + 1, cy + h + 1, h - 3, 1);
        ctx.fillRect(cx + h + 1, cy + h + 1, 1, h - 3);
        // Diamond inlay on every 4th tile (seeded)
        if ((rngSeed % 4) === 0) {
            const cx2 = cx + h;
            const cy2 = cy + h;
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx2 - 1, cy2, 3, 1);
            ctx.fillRect(cx2, cy2 - 1, 1, 3);
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx2, cy2, 1, 1);
        }

    } else if (tileType === 'cave') {
        // Earthy cobblestone (Stardew mine style)
        const pebs = 4 + rng(3);
        for (let i = 0; i < pebs; i++) {
            const px = cx + 1 + rng(S - 5);
            const py = cy + 1 + rng(S - 4);
            const pw = 2 + rng(3);
            const ph = 1 + rng(2);
            ctx.fillStyle = rng(3) === 0 ? p.hi : rng(2) === 0 ? p.accent : p.base;
            ctx.fillRect(px, py, pw, ph);
            ctx.fillStyle = p.lo;
            ctx.fillRect(px + 1, py + ph, pw - 1, 1);
        }

    } else if (tileType === 'ice') {
        // Pale blue-white frost
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, S, S);
        // Shimmer
        if (rng(2) === 0) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + rng(S - 4), cy + rng(Math.floor(S / 2)), Math.floor(S * 0.4), 1);
        }
        // Hairline crack
        if (rng(3) === 0) {
            ctx.fillStyle = p.lo;
            const x1 = cx + rng(S - 4);
            const y1 = cy + rng(S - 4);
            const len = 2 + rng(4);
            for (let i = 0; i < len; i++) {
                ctx.fillRect(x1 + i, y1 + (i % 2), 1, 1);
            }
        }
        // Glint
        if (rng(4) === 0) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx + rng(S - 1), cy + rng(S - 1), 1, 1);
        }
    }
}

// --- AUTHORED SPRITE BITMASKS ---
// 8x12 grayscale templates (0: transparent, 1: outline #000, 2: secondary #888, 3: primary #ccc, 4: accent #fff)
const SHAPES = {
    player: [
        "00333300", "03444430", "03411430", "03444430", "00333300", "00333300",
        "03333330", "32322323", "32322323", "03333330", "03300330", "03300330"
    ],
    player_back: [
        "00333300", "03333330", "03333330", "03333330", "00333300", "00333300",
        "03333330", "33333333", "33333333", "03333330", "03300330", "03300330"
    ],
    player_side: [
        "00033300", "00344430", "00344130", "00344430", "00033300", "00033300",
        "00333300", "03232300", "03232300", "00333300", "00330330", "00330330"
    ],
    wolf: [
        "00000000", "00000000", "30000030", "33000330", "03333300", "03311300",
        "03411430", "03333300", "02333200", "03000300", "03000300", "02000200"
    ],
    guard: [
        "00111100", "01333310", "01344310", "01311310", "00111100", "02333320",
        "23333332", "23333332", "23333332", "23333332", "02200220", "02200220"
    ],
    potion: [
        "00044000", "00033000", "00333300", "03433430", "03333330", "03333330", "00333300"
    ],
    heart: [
        "00000000", "03303300", "34434430", "34444430", "34444430", "03444300", "00343000", "00030000"
    ],
    tree: [
        "00033000", "00333300", "00333300", "03333330", "03333330", "33333333",
        "33333333", "00011000", "00011000", "00011000", "00011000", "00011000"
    ],
    shrub: [
        "00000000", "00000000", "00000000", "00033000", "00333300", "03333330",
        "03333330", "33333333", "33333333", "03333330", "00000000", "00000000"
    ],
    rock: [
        "00000000", "00000000", "00000000", "00222200", "02222220", "22222222",
        "22112222", "22222222", "22222222", "02222220", "00000000", "00000000"
    ],
    crate: [
        "11111111", "13333331", "13133131", "13311331", "13311331", "13133131",
        "13333331", "11111111"
    ],
    altar: [
        "00111100", "01333310", "13333331", "12222221", "13333331", "12222221",
        "13333331", "11111111"
    ],
    grave: [
        "00111100", "01333310", "01333310", "01333310", "01311310", "01333310",
        "11111111", "22222222"
    ],
    mushroom: [
        "00000000", "00011000", "00144100", "01444410", "11111111", "00011000",
        "00011000", "00111100"
    ],
    scroll: [
        "00011100", "00133310", "01333331", "01311331", "01333331", "01311331",
        "01333331", "01311331", "01333331", "01333331", "00133310", "00011100"
    ],
    barrel: [
        "01111110", "13333331", "13333331", "11111111", "13333331", "13333331",
        "11111111", "13333331", "13333331", "13333331", "01333310", "00111100"
    ],
    stall: [
        "11111111", "14444431", "14444431", "01111110", "00000000", "01133110",
        "11333311", "11333311", "01133110", "00000000", "00000000", "00000000"
    ],
    sign: [
        "00000000", "01111110", "13333331", "13333331", "13313331", "13333331",
        "01111110", "00010000", "00010000", "00010000", "00010000", "00010000"
    ],
    wheel: [
        "00011000", "00133100", "01311310", "13111131", "13100131", "13111131",
        "01311310", "00133100", "00011000", "00000000", "00000000", "00000000"
    ],
    torch: [
        "00044000", "00443000", "00443000", "00433000", "00111000", "00121000",
        "00121000", "00121000", "00121000", "00010000", "00010000", "00010000"
    ],
    bones: [
        "00000000", "00111100", "01333310", "01341310", "01311310", "00111100",
        "00020000", "02220220", "02020220", "00020000", "00000000", "00000000"
    ],
    anchor: [
        "00111100", "01000010", "00111100", "01111110", "00011000", "00011000",
        "00011000", "00011000", "01111110", "11011011", "01011010", "00011000"
    ],
    snowflake: [
        "00010000", "00010000", "01011010", "00111100", "01111110", "01111110",
        "00111100", "01011010", "00010000", "00010000", "00000000", "00000000"
    ],
    crown: [
        "00000000", "00000000", "10001001", "13001031", "13441431", "13444431",
        "13333331", "11111111", "00000000", "00000000", "00000000", "00000000"
    ],
    ladder: [
        "01000010", "01111110", "01000010", "01111110", "01000010", "01111110",
        "01000010", "01111110", "01000010", "01111110", "01000010", "01000010"
    ],
    shell: [
        "00000000", "00011000", "00133100", "01333310", "01331310", "01333310",
        "01331310", "01333310", "01133110", "00333300", "00011000", "00000000"
    ],
    door_arch: [
        "00000000", "01111110", "13000031", "13000031", "13000031", "13000031",
        "13000031", "13000031", "13000031", "13000031", "11000011", "00000000"
    ],
    candle: [
        "00044000", "00033000", "00111000", "00121000", "00121000",
        "00121000", "00121000", "00010000"
    ],
    bookshelf: [
        "11111111", "12321231", "12321231", "11111111",
        "13212312", "13212312", "11111111", "12321231",
        "12321231", "11111111", "00000000", "00000000"
    ],
    fireplace: [
        "11111111", "12222221", "12222221", "12344321",
        "12443421", "12344321", "12222221", "11111111",
        "00000000", "00000000", "00000000", "00000000"
    ],
    chair: [
        "00000000", "00000000", "01111110", "01222210",
        "01222210", "01111110", "00100100", "00100100",
        "00100100", "00000000", "00000000", "00000000"
    ],
    counter: [
        "11111111", "13333331", "13333331", "13333331",
        "11111111", "12222221", "12222221", "11111111",
        "00000000", "00000000", "00000000", "00000000"
    ],
    cauldron: [
        "00000000", "00000000", "00111100", "01222210",
        "12333221", "12333221", "01222210", "00111100",
        "00010100", "00010100", "00010100", "00000000"
    ],
    pillar: [
        "01111110", "13333331", "13333331", "01111110",
        "00131100", "00131100", "00131100", "00131100",
        "00131100", "01111110", "13333331", "01111110"
    ],
    table: [
        "00000000", "01111110", "13333331", "13333331",
        "13333331", "13333331", "01111110", "00100100",
        "00100100", "00100100", "00000000", "00000000"
    ],
    bed: [
        "01111110", "14444431", "14444431", "13333331",
        "13333331", "13333331", "13333331", "13333331",
        "13333331", "13333331", "01111110", "00000000"
    ],
};

/**
 * Generates a grayscale template canvas for a shape.
 */
export function getGrayscaleTemplate(type) {
    const shape = SHAPES[type];
    if (!shape) return null;

    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const colors = {
        '0': 'transparent',
        '1': '#000000',
        '2': '#888888',
        '3': '#cccccc',
        '4': '#ffffff'
    };

    shape.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const char = row[x];
            if (char !== '0') {
                ctx.fillStyle = colors[char];
                ctx.fillRect(4 + x, 2 + y, 1, 1);
            }
        }
    });
    return canvas;
}

export const PALETTES = {
    self:  { primary: '#00ff44', secondary: '#009922', outline: '#000000', accent: '#ffffff' },
    peer:  { primary: '#00aaff', secondary: '#0066aa', outline: '#000000', accent: '#ffffff' },
    npc:   { primary: '#ffdd00', secondary: '#aa8800', outline: '#000000', accent: '#ffffff' },
    enemy: { primary: '#ff4444', secondary: '#aa1111', outline: '#000000', accent: '#ffff00' },
};

// Compact grouped palette table: [primary, secondary, outline, accent]
const _SP = {
    g: ['#1a4a1a','#0d300d','#000','#2a6a2a'],  // green
    w: ['#6a4a2a','#4a3218','#000','#9a6a40'],  // wood
    r: ['#606060','#404040','#000','#808080'],  // grey/rock
    s: ['#a09070','#706050','#000','#c0b090'],  // stone
    p: ['#c8b078','#906820','#000','#e8d090'],  // parchment
    d: ['#d4a820','#906000','#000','#ffd840'],  // gold
    f: ['#d06010','#802008','#000','#ffa030'],  // fire
    i: ['#c0e0f0','#8ab0c8','#6080a0','#fff'], // ice
    m: ['#8a4a30','#5a2818','#000','#cc7050'],  // mushroom
    h: ['#d4a868','#a07040','#000','#f0c888'],  // shell
};
const _SM = {
    tree:'g', shrub:'g',
    crate:'w', barrel:'w', stall:'w', wheel:'w', ladder:'w', sign:'w', counter:'w', chair:'w', table:'w', bookshelf:'w',
    rock:'r', anchor:'r', door_arch:'r', cauldron:'r',
    bones:'s', altar:'s', grave:'s', pillar:'s',
    scroll:'p', bed:'p',
    crown:'d',
    torch:'f', candle:'f', fireplace:'f',
    snowflake:'i',
    mushroom:'m', shell:'h',
};

export function getSceneryPalette(label) {
    const a = _SP[_SM[label]] || _SP.r;
    return { primary: a[0], secondary: a[1], outline: a[2], accent: a[3] };
}

/**
 * Swaps colors on a grayscale template canvas.
 */
export function applyPalette(template, palette) {
    const canvas = new OffscreenCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return template;

    ctx.drawImage(template, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const hexToRgb = (hex) => {
        const bigint = parseInt(hex.slice(1), 16);
        return [ (bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255 ];
    };

    const p = hexToRgb(palette.primary);
    const s = hexToRgb(palette.secondary);
    const o = hexToRgb(palette.outline);
    const a = hexToRgb(palette.accent);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], alpha = data[i+3];
        if (alpha === 0) continue;
        if (r === 255) { data[i]=a[0]; data[i+1]=a[1]; data[i+2]=a[2]; }
        else if (r === 204) { data[i]=p[0]; data[i+1]=p[1]; data[i+2]=p[2]; }
        else if (r === 136) { data[i]=s[0]; data[i+1]=s[1]; data[i+2]=s[2]; }
        else if (r === 0) { data[i]=o[0]; data[i+1]=o[1]; data[i+2]=o[2]; }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

export function drawLargeTree(ctx, cx, cy, wPx, hPx, seed) {
    const rng = tileRng(seed ^ 0x7a2e4f);
    const ccx = cx + wPx / 2;
    const ccy = cy + hPx * 0.42;
    const r = wPx * 0.44;

    // Shadow offset
    ctx.beginPath();
    ctx.arc(ccx + 2, ccy + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0d2e0d';
    ctx.fill();

    // Base canopy
    ctx.beginPath();
    ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1a4a1a';
    ctx.fill();

    // Mid highlight
    ctx.beginPath();
    ctx.arc(ccx - 1, ccy - 1, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#2a6a2a';
    ctx.fill();

    // Seeded tufts
    for (let i = 0; i < 4 + rng(5); i++) {
        const angle = rng(628) / 100;
        const dist = rng(Math.floor(r * 60)) / 100;
        const sr = Math.max(1.5, r * 0.18);
        ctx.beginPath();
        ctx.arc(ccx + Math.cos(angle) * dist, ccy + Math.sin(angle) * dist, sr, 0, Math.PI * 2);
        ctx.fillStyle = rng(3) === 0 ? '#3a8a3a' : '#2a6a2a';
        ctx.fill();
    }

    // Trunk
    const tw = Math.max(2, wPx * 0.18);
    const tx = ccx - tw / 2;
    const ty = ccy + r * 0.65;
    const th = Math.max(4, cy + hPx - ty);
    ctx.fillStyle = '#5a3818';
    ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(tx, ty, 2, th);
}

// Hash-identicon character sprite — 16×16, seeded from entity id
export function generateCharacterSprite(seed, type) {
    const pal = PALETTES[type] || PALETTES.peer;
    const _rng = tileRng(seed);

    let sType = null;
    if (type === 'self' || type === 'peer') sType = 'player';
    if (type === 'enemy') sType = 'wolf';
    if (type === 'npc') sType = 'guard';

    const template = getGrayscaleTemplate(sType);
    if (template) return applyPalette(template, pal);

    // Fallback identicon
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(5, 2, 6, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 4, 1, 2);
    ctx.fillRect(9, 4, 1, 2);
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(5, 8, 6, 5);
    ctx.fillStyle = '#888888';
    ctx.fillRect(3, 8, 2, 4);
    ctx.fillRect(11, 8, 2, 4);
    ctx.fillRect(5, 13, 2, 3);
    ctx.fillRect(9, 13, 2, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(4, 1, 8, 2);
    return applyPalette(canvas, pal);
}

// Walk cycle pose
export function getWalkPose(frameTime) {
    const t = (frameTime % 400) / 400;
    const legOffset = Math.round(Math.sin(t * Math.PI * 2) * 2);
    const bodyY = Math.abs(Math.sin(t * Math.PI * 2)) > 0.7 ? -1 : 0;
    return { legOffset, bodyY };
}
