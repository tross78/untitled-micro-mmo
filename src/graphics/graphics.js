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

// --- AUTHORED SPRITE SILHOUETTES ---
// 8x12 shapes (compact bitmask)
const SHAPES = {
    // Player: Heroic humanoid
    player: [
        0x3C, 0x7E, 0x66, 0x7E, 0x3C, 0x3C, 0x7E, 0xDB, 0xDB, 0x7E, 0x66, 0x66
    ],
    // Wolf: Quadruped with ears
    wolf: [
        0x00, 0x00, 0x42, 0x24, 0x7E, 0xFF, 0xFF, 0xFF, 0xBD, 0x81, 0x81, 0xC3
    ],
    // Guard: Humanoid with helmet/shield feel
    guard: [
        0x3C, 0x7E, 0x7E, 0x7E, 0x3C, 0xBD, 0xFF, 0xFF, 0xFF, 0xFF, 0x66, 0x66
    ]
};

function drawSilhouette(ctx, type, pal) {
    const shape = SHAPES[type];
    if (!shape) return false;
    
    ctx.fillStyle = pal.body;
    shape.forEach((row, y) => {
        for (let x = 0; x < 8; x++) {
            if ((row >> (7 - x)) & 1) {
                // Add some shading/texture based on row/column
                ctx.fillStyle = (y < 5) ? pal.body : (x < 2 || x > 5) ? pal.dark : pal.body;
                ctx.fillRect(4 + x, 2 + y, 1, 1);
            }
        }
    });
    // Eyes
    ctx.fillStyle = pal.eye;
    if (type === 'wolf') {
        ctx.fillRect(6, 6, 1, 1);
        ctx.fillRect(9, 6, 1, 1);
    } else {
        ctx.fillRect(6, 4, 1, 2);
        ctx.fillRect(9, 4, 1, 2);
    }
    return true;
}

// Hash-identicon character sprite — 16×16, seeded from entity id
export function generateCharacterSprite(seed, type) {
    const colors = {
        self:   { body: '#00ff44', dark: '#009922', eye: '#000000' },
        peer:   { body: '#00aaff', dark: '#0066aa', eye: '#000000' },
        npc:    { body: '#ffdd00', dark: '#aa8800', eye: '#000000' },
        enemy:  { body: '#ff4444', dark: '#aa1111', eye: '#ffff00' },
    };
    const pal = colors[type] || colors.peer;
    const rng = tileRng(seed);
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d');

    // Attempt authored silhouette first
    let sType = null;
    if (type === 'self' || type === 'peer') sType = 'player';
    if (type === 'enemy') sType = 'wolf';
    if (type === 'npc') sType = 'guard';

    if (sType && drawSilhouette(ctx, sType, pal)) {
        return canvas;
    }

    // Fallback to procedural identicon
    // Head
    ctx.fillStyle = pal.body;
    ctx.fillRect(5, 2, 6, 6);
    // Eyes
    ctx.fillStyle = pal.eye;
    ctx.fillRect(6, 4, 1, 2);
    ctx.fillRect(9, 4, 1, 2);
    // Body
    ctx.fillStyle = pal.body;
    ctx.fillRect(5, 8, 6, 5);
    // Arms
    ctx.fillStyle = pal.dark;
    ctx.fillRect(3, 8, 2, 4);
    ctx.fillRect(11, 8, 2, 4);
    // Legs
    ctx.fillStyle = pal.dark;
    ctx.fillRect(5, 13, 2, 3);
    ctx.fillRect(9, 13, 2, 3);
    // Random hair/hat detail
    const hatColor = ['#aa4400', '#886622', '#224488', '#442266'][rng(4)];
    ctx.fillStyle = hatColor;
    ctx.fillRect(4, 1, 8, 2);

    return canvas;
}

// Walk cycle pose — used by Phase 8 sprite animation
export function getWalkPose(frameTime) {
    const t = (frameTime % 400) / 400;
    const legOffset = Math.round(Math.sin(t * Math.PI * 2) * 2);
    const bodyY = Math.abs(Math.sin(t * Math.PI * 2)) > 0.7 ? -1 : 0;
    return { legOffset, bodyY };
}

