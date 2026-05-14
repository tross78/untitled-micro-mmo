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

import { TILE_TAXONOMY, SCENERY_SIZE_CLASSES, SCENERY_DIMENSIONS } from '../infra/graphics-constants.js';
import { COMPILED_ASSET_SHAPES, COMPILED_ASSET_META } from '../generated/assets/compiled-assets.js';

/**
 * Hearthwick Graphics Bible & Tile Taxonomy (Phase 8.55a)
 * 
 * PALETTE RULES:
 * All procedural assets use a 4-color unified palette [primary, secondary, outline, accent].
 * 
 * SCALE RULES:
 * - Small (1x1): props, small plants, items
 * - Medium (2x2): furniture, pillars, shrubs
 * - Large (3x3+): trees, ruins, major structures
 */

export { TILE_TAXONOMY, SCENERY_SIZE_CLASSES, SCENERY_DIMENSIONS };
export const hasCompiledAssetShape = (type) => !!COMPILED_ASSET_SHAPES[type];
export const getCompiledAssetMeta = (type) => COMPILED_ASSET_META[type] || null;

// LttP + Stardew unified palette — saturated SNES-era colors
const TILE_PAL = {
    grass:       { base: '#48942a', hi: '#6ab83c', lo: '#2d5e18', accent: '#90d050' },
    stone_floor: { base: '#787060', hi: '#9a9080', lo: '#504840', accent: '#b8aea0' },
    wall:        { base: '#58504a', hi: '#787060', lo: '#302c28', accent: '#a09488' },
    water:       { base: '#1848a8', hi: '#2870c8', lo: '#0c2c68', accent: '#60c0e8' },
    exit:        { base: '#082808', hi: '#20b840', lo: '#041404', accent: '#40f070' },
    interior:    { base: '#9a6030', hi: '#c8844a', lo: '#603818', accent: '#e0a868' },
    dungeon:     { base: '#404878', hi: '#6070a8', lo: '#282e50', accent: '#98b0d8' },
    cave:        { base: '#5a4030', hi: '#7a5840', lo: '#361e10', accent: '#9a7050' },
    ice:         { base: '#c0ddf0', hi: '#e8f6ff', lo: '#88b8d8', accent: '#ffffff' },
    dirt:        { base: '#906830', hi: '#b08848', lo: '#583e18', accent: '#c8a868' },
    sand:        { base: '#d8bc70', hi: '#ead898', lo: '#a88840', accent: '#f8eebc' },
    forest:      { base: '#204818', hi: '#346828', lo: '#102808', accent: '#50a030' },
    cobble:      { base: '#585048', hi: '#787060', lo: '#343028', accent: '#989088' },
};

const zoneTileType = (locationId) => {
    const map = {
        cellar: 'stone_floor',   hallway: 'stone_floor',
        library: 'stone_floor',  crossroads: 'dirt',
        ruins: 'cobble',         ruins_descent: 'cobble',
        tavern: 'interior',      market: 'interior',
        herbalist_hut: 'interior', mill: 'interior',
        forest_edge: 'grass',    forest_depths: 'forest',
        bandit_camp: 'grass',    cemetery: 'forest',
        frozen_lake: 'ice',
        lake_shore: 'sand',      harbour: 'sand',
        mountain_pass: 'stone_floor', watchtower: 'stone_floor',
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
    // Use seed only to pick a variant (0-7), not per-pixel noise positions.
    // Invalid seeds can leak in from callers during partial world/bootstrap states.
    const safeSeed = Number.isFinite(rngSeed) ? Math.abs(Math.trunc(rngSeed)) : 0;
    const variant = safeSeed % 8;
    const h = Math.floor(S / 2);
    const q = Math.floor(S / 4);

    ctx.fillStyle = p.base;
    ctx.fillRect(cx, cy, S, S);

    if (tileType === 'grass' || tileType === 'forest') {
        // Structured tufts — 4 tuft position templates, picked by variant
        const tufts = [
            [[2, S-6], [S-5, 3]],           // v0: two corner tufts
            [[h-1, 2], [3, S-5]],            // v1: top-center + bottom-left
            [[2, 3], [S-5, S-6], [h, h-2]],  // v2: three tufts
            [[h-1, h-2]],                     // v3: single center tuft
        ];
        const tgroup = tufts[variant % 4];
        tgroup.forEach(([tx, ty]) => {
            ctx.fillStyle = p.hi;
            ctx.fillRect(cx + tx, cy + ty, 1, 3);      // stem
            ctx.fillRect(cx + tx - 1, cy + ty + 1, 1, 1); // left blade
            ctx.fillRect(cx + tx + 1, cy + ty, 1, 1);     // right tip
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + tx, cy + ty, 1, 1);          // tip highlight
        });
        // Forest: denser + darker patches + leaf litter
        if (tileType === 'forest') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx, cy, S, S); // darker base for forest
            tgroup.forEach(([tx, ty]) => {
                ctx.fillStyle = p.hi;
                ctx.fillRect(cx + tx, cy + ty, 1, 3);
                ctx.fillRect(cx + tx - 1, cy + ty + 1, 1, 1);
                ctx.fillRect(cx + tx + 1, cy + ty, 1, 1);
                ctx.fillStyle = p.accent;
                ctx.fillRect(cx + tx, cy + ty, 1, 1);
            });
            // Leaf debris (brown, at fixed positions per variant)
            const leafPos = [[1,1],[S-4,S-3],[q,S-2]];
            leafPos.slice(0, 1 + variant % 2).forEach(([lx, ly]) => {
                ctx.fillStyle = '#6a4020';
                ctx.fillRect(cx + lx, cy + ly, 2, 1);
            });
        }
        // Rare flower — only on specific variants
        if (variant === 0) {
            const fx = cx + q + 1, fy = cy + q;
            ctx.fillStyle = variant % 2 ? '#ffc840' : '#ff80aa';
            ctx.fillRect(fx, fy, 2, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(fx, fy, 1, 1);
        }

    } else if (tileType === 'stone_floor') {
        // 4-quadrant flagstone with consistent mortar and bevels
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h, S, 2);       // horizontal mortar
        ctx.fillRect(cx + h, cy, 2, S);       // vertical mortar
        // Bevel top-left of each quadrant
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 1,     cy + 1,     h - 3, 1); // Q1 top
        ctx.fillRect(cx + 1,     cy + 1,     1, h - 3); // Q1 left
        ctx.fillRect(cx + h + 3, cy + 1,     h - 3, 1); // Q2 top
        ctx.fillRect(cx + h + 3, cy + 1,     1, h - 3); // Q2 left
        ctx.fillRect(cx + 1,     cy + h + 3, h - 3, 1); // Q3 top
        ctx.fillRect(cx + 1,     cy + h + 3, 1, h - 3); // Q3 left
        ctx.fillRect(cx + h + 3, cy + h + 3, h - 3, 1); // Q4 top
        ctx.fillRect(cx + h + 3, cy + h + 3, 1, h - 3); // Q4 left
        // Occasional wear mark (variant-dependent, not random)
        if (variant < 2) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + q + 1, cy + q + 1, 2, 1);
        }

    } else if (tileType === 'cobble') {
        // Irregular cobblestone — 6 stones in structured layout
        const stones = [
            [1, 1, h-2, h-1],           // top-left
            [h+2, 2, h-2, h-2],         // top-right
            [2, h+2, h-1, h-2],         // bottom-left
            [h+1, h+2, h-1, h-1],       // bottom-right
            [q, q+1, q, h-1],           // center-left
            [h+q-1, q, q+1, h-2],       // center-right
        ];
        stones.forEach(([sx, sy, sw, sh], i) => {
            ctx.fillStyle = (i + variant) % 3 === 0 ? p.lo : (i % 2 ? p.hi : p.base);
            ctx.fillRect(cx + sx, cy + sy, sw, sh);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + sx, cy + sy, sw, 1);    // top highlight
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + sx, cy + sy + sh, sw, 1); // bottom shadow
        });

    } else if (tileType === 'dirt') {
        // Diagonal crosshatch dithering — structured texture
        ctx.fillStyle = p.hi;
        for (let y = 0; y < S; y += 4) {
            for (let x = 0; x < S; x += 4) {
                ctx.fillRect(cx + x + (y/4 % 2)*2, cy + y, 2, 1);
            }
        }
        // Variant: occasional pebble at fixed position
        if (variant < 3) {
            ctx.fillStyle = p.lo;
            const px = q + (variant * q) % (h);
            ctx.fillRect(cx + px, cy + h, 3, 2);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + px, cy + h, 3, 1);
        }

    } else if (tileType === 'sand') {
        // Horizontal ripple bands at consistent Y positions
        const rippleYs = [Math.floor(S*0.2), Math.floor(S*0.45), Math.floor(S*0.7)];
        const rippleOffset = (variant % 4) * Math.floor(S / 8);
        rippleYs.forEach((ry, i) => {
            ctx.fillStyle = i === 1 ? p.accent : p.hi;
            const rLen = Math.floor(S * 0.55);
            ctx.fillRect(cx + rippleOffset % (S - rLen), cy + ry, rLen, 1);
        });
        // Shadow at bottom
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + S - 2, S, 2);

    } else if (tileType === 'wall') {
        // Proper staggered brick — 2 rows, each half-height, bricks alternate offset
        const bOff = (variant % 2) * h; // odd/even column stagger
        const bW = h - 1;
        // Row 1
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + bOff + 1,     cy + 1,     bW - 1, h - 2);
        ctx.fillRect(cx + bOff - h + 1, cy + 1,     bW - 1, h - 2); // wrap-around brick
        ctx.fillRect(cx + bOff + h + 1, cy + 1,     bW - 1, h - 2); // wrap-around brick
        // Row 2
        ctx.fillRect(cx + (bOff + h/2 | 0) + 1, cy + h + 1, bW - 1, h - 2);
        ctx.fillRect(cx + (bOff - h/2 | 0) + 1, cy + h + 1, bW - 1, h - 2);
        ctx.fillRect(cx + (bOff + h/2 | 0) - h + 1, cy + h + 1, bW - 1, h - 2);
        // Mortar (dark lines)
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h, S, 2);        // horizontal mortar
        for (let bx = 0; bx <= S; bx += h) {
            ctx.fillRect(cx + (bx + bOff) % S, cy, 1, h);
            ctx.fillRect(cx + (bx + bOff + h/2 | 0) % S, cy + h, 1, h);
        }
        // Highlight bevel (top of each brick)
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + bOff + 2,     cy + 2, bW - 3, 1);
        ctx.fillRect(cx + (bOff + h/2 | 0) + 2, cy + h + 2, bW - 3, 1);

    } else if (tileType === 'water') {
        // Layered horizontal bands — dark base → bright crests
        ctx.fillStyle = p.base;
        ctx.fillRect(cx, cy, S, S);
        // Wave crests at consistent Y offsets, shifted by variant
        const waveShift = (variant * (S / 8)) % S;
        [[S*0.15, p.hi, Math.floor(S*0.6)],
         [S*0.4,  p.accent, Math.floor(S*0.35)],
         [S*0.65, p.hi, Math.floor(S*0.5)]].forEach(([wy, color, wl]) => {
            ctx.fillStyle = color;
            const wx = Math.floor((waveShift) % (S - wl));
            ctx.fillRect(cx + wx, cy + Math.floor(wy), wl, 1);
        });
        // Sparkle — only on variant 0
        if (variant === 0) {
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.5;
            ctx.fillRect(cx + q, cy + q, 2, 1);
            ctx.globalAlpha = 1.0;
        }

    } else if (tileType === 'exit') {
        // Glowing portal rings
        const mx = cx + h, my = cy + h;
        [[Math.floor(S*0.38), p.lo],
         [Math.floor(S*0.26), p.hi],
         [Math.floor(S*0.16), p.accent],
         [Math.floor(S*0.08), '#ffffff']].forEach(([r, color]) => {
            ctx.beginPath();
            ctx.arc(mx, my, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(1, S*0.04), 0, Math.PI * 2);
        ctx.fillStyle = p.base;
        ctx.fill();

    } else if (tileType === 'interior') {
        // Stardew-style wood planks — 3 horizontal planks
        const gapY = [Math.floor(S*0.33), Math.floor(S*0.66)];
        // Draw planks
        [0, gapY[0]+1, gapY[1]+1].forEach((py, i) => {
            const ph = (i === 2 ? S : gapY[i]) - py;
            ctx.fillStyle = i % 2 === 0 ? p.base : p.hi;
            ctx.fillRect(cx, cy + py, S, ph);
            // Grain highlight strip along top of each plank
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 1, cy + py + 1, S - 2, 1);
            // Grain shadow along bottom
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx, cy + py + ph - 1, S, 1);
        });
        // Dark gap lines between planks
        ctx.fillStyle = p.lo;
        gapY.forEach(gy => ctx.fillRect(cx, cy + gy, S, 1));
        // Knot on variant 0
        if (variant === 0) {
            const kx = cx + q + 2, ky = cy + q + 1;
            ctx.fillStyle = p.lo;
            ctx.fillRect(kx, ky, 4, 3);
            ctx.fillRect(kx+1, ky-1, 2, 1);
            ctx.fillRect(kx+1, ky+3, 2, 1);
            ctx.fillStyle = p.base;
            ctx.fillRect(kx+1, ky+1, 2, 1);
        }

    } else if (tileType === 'dungeon') {
        // LttP checkerboard — alternating hi/base quadrants + mortar + bevel
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 1, cy + 1, h - 2, h - 2);
        ctx.fillRect(cx + h + 1, cy + h + 1, h - 2, h - 2);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx + h + 1, cy + 1, h - 2, h - 2);
        ctx.fillRect(cx + 1, cy + h + 1, h - 2, h - 2);
        // Mortar
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h, S, 2);
        ctx.fillRect(cx + h, cy, 2, S);
        // Bevel on hi quadrants
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + 1, cy + 1, h - 3, 1);
        ctx.fillRect(cx + 1, cy + 1, 1, h - 3);
        ctx.fillRect(cx + h + 2, cy + h + 2, h - 3, 1);
        ctx.fillRect(cx + h + 2, cy + h + 2, 1, h - 3);
        // Corner ornament on every 4th tile
        if (variant === 0) {
            const mx = cx + h, my = cy + h;
            ctx.fillStyle = p.accent;
            ctx.fillRect(mx - 1, my, 3, 1);
            ctx.fillRect(mx, my - 1, 1, 3);
            ctx.fillStyle = p.lo;
            ctx.fillRect(mx, my, 1, 1);
        }

    } else if (tileType === 'cave') {
        // Structured stone cells — 6 fixed positions, Stardew mine style
        const cells = [
            [1,     1,     h-2, h-2],
            [h+2,   2,     h-2, h-3],
            [2,     h+2,   h-1, h-2],
            [h+1,   h+2,   h-1, h-1],
            [q,     q,     q-1, q],
            [h+q,   h+q-1, q,   q],
        ];
        cells.forEach(([sx, sy, sw, sh], i) => {
            ctx.fillStyle = i % 3 === 0 ? p.lo : (i % 2 ? p.hi : p.base);
            ctx.fillRect(cx+sx, cy+sy, sw, sh);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx+sx, cy+sy, sw, 1);        // top highlight
            ctx.fillStyle = '#1a0a00';
            ctx.fillRect(cx+sx, cy+sy+sh, sw, 1);     // bottom shadow
        });

    } else if (tileType === 'ice') {
        // Pale blue-white — mostly flat with structured decoration
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, S, S);
        // Horizontal shimmer band at consistent position
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + q, cy + q, h, 1);
        // Crack — L-shaped at fixed position per variant
        if (variant < 3) {
            ctx.fillStyle = p.lo;
            const cx2 = cx + q + (variant * 3 % q);
            const cy2 = cy + h;
            ctx.fillRect(cx2, cy2, q + 2, 1);          // horizontal
            ctx.fillRect(cx2 + q + 1, cy2, 1, q);      // vertical drop
        }
        // Corner glint
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx + 2, cy + 2, 2, 1);
        ctx.fillRect(cx + 2, cy + 2, 1, 2);
    }
}

// --- AUTHORED SPRITE BITMASKS ---
// 8x14 grayscale templates (0: transparent, 1: outline #000, 2: secondary #888, 3: primary #ccc, 4: accent #fff)
const SHAPES = {
    // Player Base — Humanoid silhouette (16px tall total with feet)
    player: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_back: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_side: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133100", "01333310", "01333110", "01333110", "01133100", "01133100",
        "01100000", "01100000"
    ],
    // Hair Masks (Layered on top of primary #ccc head)
    hair_bowl:   ["00111100", "01222210", "12222221", "01122110"],
    hair_shaggy: ["00111100", "12222221", "12222221", "11222211", "01111110"],
    hair_long:   ["01111110", "12222221", "12222221", "12222221", "12222221", "11011011"],
    // Clothing Accent Masks (Layered on primary #ccc body)
    vest:  ["00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00111100", "01211210", "12111121", "01211210"],
    cloak: ["00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00122100", "01222210", "12222221", "12222221", "12222221", "12222221"],

    stairs: [
        "00011000", "00011000", "00133100", "00133100", "01333310", "01333310",
        "13333331", "13333331", "33333333", "33333333", "11111111", "00000000"
    ],
    // --- NPC SPRITES ---
    guard: [
        "00111100", "01333310", "01344310", "01311310", "00111100", "02333320",
        "23333332", "23333332", "23333332", "23333332", "02200220", "02200220", "01100110"
    ],
    // Barkeep — round-bodied, apron stripe down the front
    barkeep: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "01131110", "13131331", "13131331", "13131331", "13133331",
        "01133110", "01100110", "01100110"
    ],
    // Merchant — deep hood, goods in hand
    merchant: [
        "01111110", "11333111", "11333311", "01333310", "01133110", "01111110",
        "01333310", "13333331", "13333331", "13333331",
        "01333110", "01133110", "01100110", "01100110"
    ],
    // Herbalist — slender robe, widens at hem
    herbalist: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "01333310", "13333331", "13333331",
        "01333310", "00133100"
    ],
    // Sage — pointed hat, long beard flowing into robe
    sage: [
        "00010000", "00131000", "01331100", "11333110",
        "01333310", "01313310", "00111100",
        "01333310", "13333331", "13333331", "13333331",
        "01333310", "00333300"
    ],
    // Bard — cocked hat, holds lute neck
    bard: [
        "00110000", "01314100", "00133100", "01333310", "00133100", "00011000",
        "01133100", "13332331", "13312331", "01312310",
        "01133100", "01133100", "01100000"
    ],

    // --- ENEMY SPRITES ---
    // Wolf — 4-legged silhouette, readable at 8px
    wolf: [
        "00110000", "00110000", "01133000", "31133300",
        "33333100", "13333310", "03313310",
        "13131310", "11100110", "00000110", "11000010", "00000000"
    ],
    // Ruin shade — translucent ghost, hollow face
    ruin_shade: [
        "00011000", "00144100", "01444410", "01411410", "01444410", "00144100",
        "00143100", "01133310", "01133310", "01300310", "12000210", "02000200", "00000000"
    ],
    // Skeleton — exposed ribs, hollow eyes
    skeleton: [
        "00011000", "00133100", "01311310", "01333310", "00111100", "00011000",
        "00133100", "01311310", "01311310", "00111100", "00111100", "01100110", "01100110"
    ],
    // Wraith — billowing dark form, glowing core
    wraith: [
        "00011000", "00144100", "01444410", "01411410", "01444410", "00144100",
        "00133100", "01333310", "01333310", "01300310", "12000210", "02000200", "00000000"
    ],
    // Goblin — short, hunched, big ears and eyes
    goblin: [
        "00000000", "01011010", "01133110", "01141110",
        "00133100", "00011000",
        "01133110", "11333311", "11333311",
        "01133110", "01100110", "01100110", "00000000"
    ],
    // Cave troll — massive, hunched, huge fists
    cave_troll: [
        "01111110", "13333331", "13133131", "13333331", "01111110",
        "11333311", "13333331", "13333331", "13333331",
        "11133111", "11100111", "01000010"
    ],
    // Mountain troll — like cave troll, slightly taller
    mountain_troll: [
        "01111110", "13333331", "13133131", "13333331", "01111110",
        "11333311", "13333331", "13333331", "13333331", "13333331",
        "11133111", "11100111", "01000010"
    ],
    // Bandit — hooded cloak, weapon implied
    bandit: [
        "01111110", "11233111", "01233310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "13333331",
        "01133110", "01133110", "01100110", "01100110"
    ],
    // Crab — wide low silhouette, claws raised
    crab: [
        "00000000", "10000001", "13000031", "11300311",
        "03313300", "03333300", "03333300",
        "11111111", "01111110", "00111100", "00000000", "00000000"
    ],
    potion: [
        "00044000", "00033000", "00333300", "03433430", "03333330", "03333330", "00333300"
    ],
    heart: [
        "00000000", "03303300", "34434430", "34444430", "34444430", "03444300", "00343000", "00030000"
    ],
    tree: [
        "00034000", "00343400", "00334300", "03443330", "03334430", "33343333",
        "33333333", "00011000", "00012000", "00012000", "00012000", "00012000"
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
    well: [
        "00111100", "01222210", "12222221", "12111121",
        "12100121", "12100121", "11111111", "01333310",
        "01333310", "01333310", "00111100", "00000000"
    ],
    flower_pot: [
        "00000000", "00044000", "00433400", "00433400",
        "00044000", "01111110", "13333331", "13333331",
        "01333310", "00111100", "00000000", "00000000"
    ],
};

/**
 * Decodes an RLE-encoded frame into a string array (shape).
 * Each row is an array of [count, char] pairs.
 */
export function decodeRLEFrame(rleRows) {
    if (!rleRows) return [];
    return rleRows.map(row => {
        let line = '';
        for (const [count, char] of row) {
            line += char.repeat(count);
        }
        return line;
    });
}

/**
 * Generates a grayscale template canvas for a shape.
 */
// Maps content IDs to sprite shape keys
const SPRITE_ALIASES = {
    forest_wolf:    'wolf',
    forest_shade:   'wraith',
    cave_shade:     'wraith',
    ruin_skeleton:  'skeleton',
    forest_troll:   'cave_troll',
};

export function usesCompiledShape(type) {
    const resolvedType = SPRITE_ALIASES[type] || type;
    const compiledShape = COMPILED_ASSET_SHAPES[resolvedType] || COMPILED_ASSET_SHAPES[type];
    return compiledShape ? compiledShape.some(row => row.replace(/0/g, '').length > 0) : false;
}

export function getSpriteBounds(type, frameIdx = 0) {
    if (!type) return null;
    const resolvedType = SPRITE_ALIASES[type] || type;
    const meta = COMPILED_ASSET_META[resolvedType] || COMPILED_ASSET_META[type];
    let shape;
    if (meta?.frames && meta.frames[frameIdx]) {
        shape = decodeRLEFrame(meta.frames[frameIdx]);
    } else {
        const compiledShape = COMPILED_ASSET_SHAPES[resolvedType] || COMPILED_ASSET_SHAPES[type];
        const compiledHasContent = compiledShape && compiledShape.some(row => row.replace(/0/g, '').length > 0);
        shape = (compiledHasContent ? compiledShape : null) || SHAPES[resolvedType];
    }
    if (!shape) return null;

    const sourceWidth = Math.max(...shape.map((row) => row.length));
    const sourceHeight = shape.length;
    const canvasWidth = Math.max(16, sourceWidth);
    const canvasHeight = Math.max(16, sourceHeight);
    const sourceX = Math.max(0, Math.floor((canvasWidth - sourceWidth) / 2));
    const sourceY = Math.max(0, canvasHeight - sourceHeight);

    return { sourceX, sourceY, sourceWidth, sourceHeight, canvasWidth, canvasHeight };
}

export function getGrayscaleTemplate(type, seed = 0, frameIdx = 0) {
    if (!type) return null;
    const resolvedType = SPRITE_ALIASES[type] || type;
    const isPlayer = resolvedType.startsWith('player');
    
    // Phase 8.76 P3: support RLE frames from meta
    const meta = COMPILED_ASSET_META[resolvedType] || COMPILED_ASSET_META[type];
    let shape;
    if (meta?.frames && meta.frames[frameIdx]) {
        shape = decodeRLEFrame(meta.frames[frameIdx]);
    } else {
        const compiledShape = COMPILED_ASSET_SHAPES[resolvedType] || COMPILED_ASSET_SHAPES[type];
        const compiledHasContent = compiledShape && compiledShape.some(row => row.replace(/0/g, '').length > 0);
        shape = (compiledHasContent ? compiledShape : null) || SHAPES[resolvedType];
    }
    
    if (!shape) return null;
    const baseWidth = Math.max(...shape.map((row) => row.length));
    const baseHeight = shape.length;
    const canvasWidth = Math.max(16, baseWidth);
    const canvasHeight = Math.max(16, baseHeight);
    const baseOffsetX = Math.max(0, Math.floor((canvasWidth - baseWidth) / 2));
    const baseOffsetY = Math.max(0, canvasHeight - baseHeight);

    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const colors = {
        '0': 'transparent',
        '1': '#000000',
        '2': '#888888',
        '3': '#cccccc',
        '4': '#ffffff'
    };

    const drawMask = (mask, offX=0, offY=0) => {
        mask.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
                const char = row[x];
                if (char !== '0') {
                    ctx.fillStyle = colors[char];
                    ctx.fillRect(baseOffsetX + x + offX, baseOffsetY + y + offY, 1, 1);
                }
            }
        });
    }

    // 1. Draw Base
    drawMask(shape);

    // 2. Apply Multiplayer Variations (if player)
    if (isPlayer && seed !== 0) {
        const rng = tileRng(seed);
        
        // Hair variation
        const hairs = [null, 'hair_bowl', 'hair_shaggy', 'hair_long'];
        const hairType = hairs[rng(hairs.length)];
        if (hairType) {
            const hairMask = SHAPES[hairType];
            const hOffY = resolvedType === 'player_back' ? -1 : 0;
            drawMask(hairMask, 0, hOffY);
        }

        // Clothing variation
        const clothes = [null, 'vest', 'cloak'];
        const clothType = clothes[rng(clothes.length)];
        if (clothType && resolvedType !== 'player_back') {
            drawMask(SHAPES[clothType]);
        }
    }

    return canvas;
}

export const PALETTES = {
    // Player — bright lime green, very readable on any background
    self:  { primary: '#20e840', secondary: '#0a8020', outline: '#001800', accent: '#ffffff' },
    // Other players — variants keyed peer0..peer5, picked by seed hash
    peer:  { primary: '#30c0ff', secondary: '#0878b8', outline: '#001828', accent: '#ffffff' },
    peer0: { primary: '#30c0ff', secondary: '#0878b8', outline: '#001828', accent: '#ffffff' }, // sky blue
    peer1: { primary: '#ff9a30', secondary: '#b85008', outline: '#180800', accent: '#ffffff' }, // amber
    peer2: { primary: '#c030ff', secondary: '#780898', outline: '#180028', accent: '#ffffff' }, // violet
    peer3: { primary: '#30ff9a', secondary: '#087848', outline: '#001818', accent: '#ffffff' }, // mint
    peer4: { primary: '#ff3060', secondary: '#980820', outline: '#180010', accent: '#ffffff' }, // rose
    peer5: { primary: '#f0e830', secondary: '#988000', outline: '#181400', accent: '#ffffff' }, // gold
    // Generic NPC fallback
    npc:   { primary: '#ffd820', secondary: '#a07800', outline: '#201800', accent: '#ffffff' },
    // Guard — steel blue armour, gold trim
    npcGuard:  { primary: '#8098c8', secondary: '#3850a0', outline: '#080820', accent: '#f8e060' },
    // Barkeep — warm amber/brown
    npcWarm:   { primary: '#e09040', secondary: '#884818', outline: '#200800', accent: '#fff8d0' },
    // Merchant — rich purple-maroon
    npcTrade:  { primary: '#c06890', secondary: '#703050', outline: '#180010', accent: '#ffd8f0' },
    // Herbalist — vivid leaf green
    npcLeaf:   { primary: '#48c838', secondary: '#186818', outline: '#001800', accent: '#d8ffd0' },
    // Sage — cool lilac
    npcSage:   { primary: '#b090d8', secondary: '#604898', outline: '#100820', accent: '#f0e8ff' },
    // Bard — bright teal
    npcSong:   { primary: '#28d8c0', secondary: '#088070', outline: '#001818', accent: '#d0fff8' },
    // Enemy — vivid red, yellow sclera
    enemy: { primary: '#f03020', secondary: '#801008', outline: '#180000', accent: '#ffee00' },
};

// Compact grouped palette table: [primary, secondary, outline, accent]
const _SP = {
    g: ['#286820','#103808','#000820','#48b030'],  // vivid green (shrubs)
    tr: ['#357f2b','#8a5318','#214b1f','#79cf56'], // tree: softer outline + brighter fluffy highlights
    w: ['#a06030','#583010','#180800','#d89050'],  // warm wood
    r: ['#707880','#404850','#101418','#a0aab0'],  // slate grey/rock
    s: ['#b0a888','#706848','#181408','#d8d0b0'],  // warm stone/bones
    p: ['#d8c080','#906820','#180800','#f8e8a8'],  // parchment/scroll
    d: ['#f0c020','#a06800','#181000','#fff088'],  // bright gold
    f: ['#f07820','#a03008','#180800','#ffe040'],  // vivid fire/torch
    i: ['#d0ecff','#90c0e0','#304860','#ffffff'],  // crisp ice
    m: ['#c04828','#701808','#180000','#f09060'],  // rich mushroom red
    h: ['#e8c878','#b08038','#201000','#fff0b0'],  // pale shell
};
const _SM = {
    tree:'tr', shrub:'g',
    crate:'w', barrel:'w', stall:'w', wheel:'w', ladder:'w', sign:'w', counter:'w', chair:'w', table:'w', bookshelf:'w',
    rock:'r', anchor:'r', door_arch:'r', cauldron:'r',
    bones:'s', altar:'s', grave:'s', pillar:'s', stairs:'s',
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

// Hash-identicon character sprite — 16×16, seeded from entity id
export function generateCharacterSprite(seed, type) {
    let palKey = type;
    if (type === 'peer') {
        // Derive a stable variant (0-5) from the seed so each peer has a distinct colour
        let h = 0;
        const s = String(seed);
        for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
        palKey = `peer${h % 6}`;
    }
    const pal = PALETTES[palKey] || PALETTES.peer;

    let sType = null;
    if (type === 'self' || type === 'peer') sType = 'player';
    else if (type === 'enemy') {
        const rng = tileRng(seed);
        const types = ['wolf', 'wraith', 'skeleton'];
        sType = types[rng(types.length)];
    }
    else if (type === 'npc') sType = 'guard';

    const template = getGrayscaleTemplate(sType, seed);
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

/**
 * Primitive for rounded rectangles.
 */
export function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
