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

// SNES ALttP-inspired palette per tile type
const TILE_PAL = {
    stone_floor: { base: '#3a3a3a', hi: '#4e4e4e', lo: '#252525', accent: '#5a5a6a' },
    wall:        { base: '#2a2a3a', hi: '#4a4a5a', lo: '#15151f', accent: '#3a3a4a' },
    grass:       { base: '#1a4a1a', hi: '#2a6a2a', lo: '#0d300d', accent: '#3a7a2a' },
    water:       { base: '#0a3a6a', hi: '#1a5a9a', lo: '#05203a', accent: '#2a7abb' },
    exit:        { base: '#0a2a0a', hi: '#33aa55', lo: '#051505', accent: '#44dd77' },
    interior:    { base: '#6a4a2a', hi: '#8a6a4a', lo: '#4a3218', accent: '#aa8a5a' },
};

const zoneTileType = (locationId) => {
    const map = {
        cellar: 'stone_floor', hallway: 'stone_floor',
        tavern: 'interior',    market: 'interior',
        forest_edge: 'grass',  forest_depths: 'grass', bandit_camp: 'grass',
        lake_shore: 'water',   mountain_pass: 'wall',
        ruins: 'stone_floor',  ruins_descent: 'stone_floor',
        catacombs: 'wall',     dungeon_cell: 'wall', throne_room: 'wall',
        cave: 'wall',
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
        // Ground variation
        if (rng(3) === 0) {
            ctx.fillStyle = p.hi;
            ctx.fillRect(cx + rng(S - 3), cy + rng(S - 3), 3, 2);
        }
        // Tufts
        for (let i = 0; i < 2 + rng(2); i++) {
            ctx.fillStyle = rng(2) ? p.hi : p.accent;
            const tx = cx + rng(S - 2);
            const ty = cy + rng(S - 3);
            ctx.fillRect(tx, ty + 1, 1, 2);
            ctx.fillRect(tx + 1, ty, 1, 3);
        }
        // Rare flower
        if (rng(14) === 0) {
            ctx.fillStyle = '#ffcc44';
            ctx.fillRect(cx + 2 + rng(S - 6), cy + 2 + rng(S - 6), 2, 2);
        }

    } else if (tileType === 'stone_floor') {
        // Tile grout
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S / 2), S, 1);
        ctx.fillRect(cx + Math.floor(S / 2), cy, 1, S);
        // Bevel highlight
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, Math.floor(S / 2) - 1, 1);
        ctx.fillRect(cx, cy, 1, Math.floor(S / 2) - 1);
        // Occasional worn patch
        if (rng(6) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + rng(S - 4) + 2, cy + rng(S - 4) + 2, 2, 2);
        }

    } else if (tileType === 'wall') {
        // Brick rows — offset every other logical row
        const brickRow = Math.floor(rngSeed / 100) % 2;
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + (brickRow ? 0 : Math.floor(S / 2)), cy + 1, Math.floor(S / 2) - 2, Math.floor(S / 2) - 2);
        ctx.fillRect(cx + (brickRow ? Math.floor(S / 2) : 0), cy + Math.floor(S / 2) + 1, Math.floor(S / 2) - 2, Math.floor(S / 2) - 2);
        // Mortar
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S / 2), S, 1);
        // Crack
        if (rng(7) === 0) {
            ctx.fillStyle = p.lo;
            const cx2 = cx + 1 + rng(S - 3);
            ctx.fillRect(cx2, cy + 1 + rng(S / 2), 1, 2 + rng(4));
        }

    } else if (tileType === 'water') {
        // Wave lines
        ctx.fillStyle = p.hi;
        const w1y = cy + 3 + rng(4);
        ctx.fillRect(cx + 1, w1y, Math.floor(S * 0.35), 1);
        ctx.fillRect(cx + Math.floor(S * 0.55), w1y + 4, Math.floor(S * 0.35), 1);
        // Surface shimmer
        if (rng(4) === 0) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + rng(S - 2), cy + rng(S - 2), 2, 1);
        }

    } else if (tileType === 'exit') {
        // Concentric glowing rings
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
        // Wood planks
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + Math.floor(S * 0.3), S, 1);
        ctx.fillRect(cx, cy + Math.floor(S * 0.65), S, 1);
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, S, 1);
        // Knot
        if (rng(8) === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 3 + rng(S - 8), cy + 4 + rng(4), 3, 2);
        }
    }
}

// --- AUTHORED SPRITE BITMASKS ---
// 8x12 grayscale templates (0: empty, 1: outline #000, 2: secondary #888, 3: primary #ccc, 4: accent #fff)
const SHAPES = {
    player: [
        "00333300",
        "03444430",
        "03411430",
        "03444430",
        "00333300",
        "00333300",
        "03333330",
        "32322323",
        "32322323",
        "03333330",
        "03300330",
        "03300330"
    ],
    wolf: [
        "00000000",
        "00000000",
        "03000030",
        "03300330",
        "03333330",
        "33333333",
        "33433433",
        "33333333",
        "32333323",
        "30300303",
        "30300303",
        "20200202"
    ],
    guard: [
        "00111100",
        "01333310",
        "01344310",
        "01333310",
        "00111100",
        "02333320",
        "23333332",
        "23333332",
        "23333332",
        "23333332",
        "02200220",
        "02200220"
    ],
    potion: [
        "00044000",
        "00033000",
        "00333300",
        "03433430",
        "03333330",
        "03333330",
        "00333300"
    ],
    heart: [
        "00000000",
        "03303300",
        "34434430",
        "34444430",
        "34444430",
        "03444300",
        "00343000",
        "00030000"
    ]
};

/**
 * Generates a grayscale template canvas for a shape.
 * @param {string} type 
 * @returns {OffscreenCanvas | null}
 */
export function getGrayscaleTemplate(type) {
    const shape = SHAPES[type];
    if (!shape) return null;
    
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const colors = {
        '0': 'transparent',
        '1': '#000000', // Outline
        '2': '#888888', // Secondary
        '3': '#cccccc', // Primary
        '4': '#ffffff'  // Accent (Eyes/Highlights)
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

/**
 * Utility to swap colors on a grayscale template canvas.
 * Template rules: White (#fff) -> accent, Light Gray (#ccc) -> primary, 
 * Mid Gray (#888) -> secondary, Black (#000) -> outline.
 * @param {HTMLCanvasElement|OffscreenCanvas} template 
 * @param {typeof PALETTES['self']} palette 
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
        
        // grayscale mapping based on R channel (since R=G=B in our template)
        if (r === 255) { data[i]=a[0]; data[i+1]=a[1]; data[i+2]=a[2]; }
        else if (r === 204) { data[i]=p[0]; data[i+1]=p[1]; data[i+2]=p[2]; }
        else if (r === 136) { data[i]=s[0]; data[i+1]=s[1]; data[i+2]=s[2]; }
        else if (r === 0) { data[i]=o[0]; data[i+1]=o[1]; data[i+2]=o[2]; }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

// Hash-identicon character sprite — 16×16, seeded from entity id
export function generateCharacterSprite(seed, type) {
    const pal = PALETTES[type] || PALETTES.peer;
    const _rng = tileRng(seed);

    // 1. Attempt authored grayscale template
    let sType = null;
    if (type === 'self' || type === 'peer') sType = 'player';
    if (type === 'enemy') sType = 'wolf';
    if (type === 'npc') sType = 'guard';

    const template = getGrayscaleTemplate(sType);
    if (template) {
        return applyPalette(template, pal);
    }

    // 2. Fallback to procedural identicon (colorized grayscale template)
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    
    // Head (#ccc)
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(5, 2, 6, 6);
    // Eyes (#fff)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 4, 1, 2);
    ctx.fillRect(9, 4, 1, 2);
    // Body (#ccc)
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(5, 8, 6, 5);
    // Arms (#888)
    ctx.fillStyle = '#888888';
    ctx.fillRect(3, 8, 2, 4);
    ctx.fillRect(11, 8, 2, 4);
    // Legs (#888)
    ctx.fillStyle = '#888888';
    ctx.fillRect(5, 13, 2, 3);
    ctx.fillRect(9, 13, 2, 3);
    // Hair (#000)
    ctx.fillStyle = '#000000';
    ctx.fillRect(4, 1, 8, 2);

    return applyPalette(canvas, pal);
}

// Walk cycle pose — used by Phase 8 sprite animation
export function getWalkPose(frameTime) {
    const t = (frameTime % 400) / 400;
    const legOffset = Math.round(Math.sin(t * Math.PI * 2) * 2);
    const bodyY = Math.abs(Math.sin(t * Math.PI * 2)) > 0.7 ? -1 : 0;
    return { legOffset, bodyY };
}

