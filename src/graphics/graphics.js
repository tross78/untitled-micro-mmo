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
import { NPC_IDLE_FRAMES } from './npc-idle-frames.js';
import { TILE_BIBLE } from '../content/data/tile-bible.js';

/**
 * Fenhollow Graphics Bible & Tile Taxonomy (Phase 8.55a)
 * 
 * PALETTE RULES:
 * All procedural assets use a role palette with outline/secondary/primary/accent and optional shadow.
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
    mud:         { base: '#3a2c1e', hi: '#5a4c3e', lo: '#1a100a', accent: '#6a5848' },
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
        throne_room: 'dungeon',
        cave: 'mud',             sea_cave: 'mud',
        smuggler_den: 'mud',     catacombs: 'mud',
        dungeon_cell: 'mud',
    };
    return map[locationId] || 'stone_floor';
};
export { zoneTileType };

function getBlendProfile(tileType, neighborType) {
    const key = `${tileType}->${neighborType}`;
    const profiles = {
        'grass->water': { side: '#6aa03a', accent: '#8ed0ff', mode: 'shore' },
        'forest->water': { side: '#24461a', accent: '#7ac8ff', mode: 'shore' },
        'dirt->water': { side: '#7a5a28', accent: '#8ccae8', mode: 'shore' },
        'sand->water': { side: '#d8c88a', accent: '#8ccae8', mode: 'shore' },
        'stone_floor->wall': { side: '#504840', accent: '#b8aea0', mode: 'frame' },
        'cobble->wall': { side: '#4c443c', accent: '#b0a89c', mode: 'frame' },
        'interior->wall': { side: '#6a4018', accent: '#d09868', mode: 'frame' },
        'dungeon->wall': { side: '#383c60', accent: '#96a8d0', mode: 'frame' },
        'cave->wall': { side: '#4a2e1c', accent: '#9a7050', mode: 'frame' },
        'mud->water': { side: '#35271b', accent: '#88bfe0', mode: 'shore' },
        'wall->stone_floor': { side: '#302c28', accent: '#a09488', mode: 'shadow' },
        'wall->dirt': { side: '#302018', accent: '#704a24', mode: 'shadow' },
        'wall->interior': { side: '#302018', accent: '#a46c3c', mode: 'shadow' },
        'wall->cobble': { side: '#302c28', accent: '#7a7064', mode: 'shadow' },
        'water->sand': { side: '#2e84c0', accent: '#dcd8a2', mode: 'foam' },
        'water->grass': { side: '#2e84c0', accent: '#8fca58', mode: 'foam' },
        'water->dirt': { side: '#2e84c0', accent: '#b28c54', mode: 'foam' },
        'ice->stone_floor': { side: '#8bb6d4', accent: '#e7f8ff', mode: 'crack' },
        'ice->dirt': { side: '#8bb6d4', accent: '#d1e8f4', mode: 'crack' },
        'ice->sand': { side: '#8bb6d4', accent: '#f2f5de', mode: 'crack' },
    };
    if (profiles[key]) return profiles[key];
    // Generic ground↔ground transition: dither the neighbour's colour into this tile's edge so two
    // different floor types don't meet in a hard, blocky seam (a procedural stand-in for transition tiles).
    // Walls and water keep their explicit profiles above; we only auto-blend walkable floor types.
    const GROUND = new Set(['grass', 'forest', 'dirt', 'sand', 'cobble', 'stone_floor', 'dungeon', 'cave', 'interior', 'mud', 'ice']);
    if (tileType !== neighborType && GROUND.has(tileType) && GROUND.has(neighborType)) {
        const np = TILE_PAL[neighborType];
        if (np) return { side: np.base, accent: np.lo, mode: 'round' };
    }
    return null;
}

function getNeighborSignature(tileType, neighbors) {
    if (!neighbors) return 0;
    return (
        (neighbors.north === tileType ? 1 : 0) |
        (neighbors.south === tileType ? 2 : 0) |
        (neighbors.west === tileType ? 4 : 0) |
        (neighbors.east === tileType ? 8 : 0)
    );
}

function edgeState(neighbors, tileType) {
    if (!neighbors) return 'isolated';
    const same = sameNeighborCount(neighbors, tileType);
    if (same === 4) return 'center';
    if (same >= 2) return 'interior';
    if (same === 1) return 'edge';
    return 'isolated';
}

function sameNeighborCount(neighbors, tileType) {
    if (!neighbors) return 0;
    let count = 0;
    for (const dir of ['north', 'south', 'west', 'east']) {
        if (neighbors[dir] === tileType) count++;
    }
    return count;
}

function fillRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, radius);
        ctx.fill();
        return;
    }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fill();
}

function drawCornerBlend(ctx, tileType, cx, cy, neighbors, S) {
    if (!neighbors) return;
    const corners = [
        { dirs: ['north', 'west'], x: 0, y: 0 },
        { dirs: ['north', 'east'], x: S - 3, y: 0 },
        { dirs: ['south', 'west'], x: 0, y: S - 3 },
        { dirs: ['south', 'east'], x: S - 3, y: S - 3 },
    ];

    for (const corner of corners) {
        const [aDir, bDir] = corner.dirs;
        const a = neighbors[aDir];
        const b = neighbors[bDir];
        // Only round where BOTH neighbours are real, differing tiles. If one is off-map (null at the
        // room boundary) we must not round — otherwise edge-of-screen tiles cut a corner toward the void
        // and show a reversed-colour artefact.
        if (!a || !b || a === tileType || b === tileType) continue;

        const profile = getBlendProfile(tileType, a) || getBlendProfile(tileType, b);
        if (!profile) continue;

        if (profile.mode === 'round') {
            // Cut this convex corner along a quarter-circle and fill it with the neighbour colour, so the
            // floor region reads as a smooth rounded blob (like the water pool) instead of a blocky step.
            const r = Math.max(2, Math.round(S * 0.42));
            const west = corner.dirs.includes('west');
            const north = corner.dirs.includes('north');
            const accx = west ? r : S - 1 - r;
            const accy = north ? r : S - 1 - r;
            const x0 = west ? 0 : S - r, x1 = west ? r : S - 1;
            const y0 = north ? 0 : S - r, y1 = north ? r : S - 1;
            ctx.fillStyle = profile.side;
            for (let yy = y0; yy <= y1; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    const ddx = xx - accx, ddy = yy - accy;
                    if (ddx * ddx + ddy * ddy > r * r) ctx.fillRect(cx + xx, cy + yy, 1, 1);
                }
            }
            continue;
        }

        const px = cx + corner.x;
        const py = cy + corner.y;
        if (profile.mode === 'foam' || profile.mode === 'shore') {
            ctx.fillStyle = profile.side;
            ctx.fillRect(px, py, 3, 1);
            ctx.fillRect(px, py + 1, 2, 1);
            ctx.fillRect(px + 1, py + 2, 1, 1);
            ctx.fillStyle = profile.accent;
            ctx.fillRect(px + 1, py + 1, 1, 1);
        } else if (profile.mode === 'shadow' || profile.mode === 'frame') {
            ctx.fillStyle = profile.side;
            ctx.fillRect(px, py, 3, 1);
            ctx.fillRect(px, py, 1, 3);
            ctx.fillRect(px + 1, py + 2, 2, 1);
            ctx.fillStyle = profile.accent;
            ctx.fillRect(px + 1, py + 1, 1, 1);
        } else if (profile.mode === 'tuft') {
            ctx.fillStyle = profile.side;
            ctx.fillRect(px + 1, py, 1, 2);
            ctx.fillRect(px, py + 1, 2, 1);
            ctx.fillRect(px + 2, py + 1, 1, 1);
            ctx.fillStyle = profile.accent;
            ctx.fillRect(px + 1, py + 1, 1, 1);
        } else if (profile.mode === 'crack') {
            ctx.fillStyle = profile.side;
            ctx.fillRect(px, py, 1, 1);
            ctx.fillRect(px + 1, py + 1, 1, 1);
            ctx.fillRect(px + 2, py, 1, 1);
            ctx.fillStyle = profile.accent;
            ctx.fillRect(px + 2, py + 1, 1, 1);
        }
    }
}

function blendTileEdges(ctx, tileType, cx, cy, neighbors, S) {
    if (!neighbors) return;
    const edges = [
        ['north', 0, 0, S, 3],
        ['south', 0, S - 3, S, 3],
        ['west', 0, 0, 3, S],
        ['east', S - 3, 0, 3, S],
    ];
    for (const [dir, ox, oy, w, h] of edges) {
        const profile = getBlendProfile(tileType, neighbors[dir]);
        if (!profile) continue;
        ctx.fillStyle = profile.side;
        if (profile.mode === 'shadow') {
            ctx.globalAlpha = 0.65;
            ctx.fillRect(cx + ox, cy + oy, w, h);
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = profile.accent;
            if (dir === 'north' || dir === 'south') {
                ctx.fillRect(cx + 2, cy + oy, S - 4, 1);
                ctx.fillRect(cx + 4, cy + oy + 1, S - 8, 1);
            } else {
                ctx.fillRect(cx + ox, cy + 2, 1, S - 4);
                ctx.fillRect(cx + ox + 1, cy + 4, 1, S - 8);
            }
            continue;
        }

        if (profile.mode === 'round') {
            // The smooth, water-like outline is produced entirely by the corner rounding in
            // drawCornerBlend. Feathering straight runs here produced a dotted seam line that traced the
            // whole boundary, so we deliberately draw nothing on straight edges — clean colour boundary.
            continue;
        }

        if (profile.mode === 'foam' || profile.mode === 'shore') {
            const edgeY = dir === 'north' ? 0 : (dir === 'south' ? S - 3 : 0);
            const edgeX = dir === 'west' ? 0 : (dir === 'east' ? S - 3 : 0);
            if (dir === 'north' || dir === 'south') {
                for (let x = 0; x < S; x += 2) {
                    const pattern = (x + (dir === 'south' ? 1 : 0)) % 4;
                    const yOff = pattern === 0 ? 0 : pattern === 1 ? 1 : 2;
                    ctx.fillRect(cx + x, cy + edgeY + yOff, 2, 1);
                    if (x % 4 === 0) ctx.fillRect(cx + x + 1, cy + edgeY + 1 + (pattern % 2), 1, 1);
                    if (x % 6 === 0) ctx.fillRect(cx + x, cy + edgeY + 2, 1, 1);
                    if (x % 8 === 0) ctx.fillRect(cx + x + 1, cy + edgeY + 2, 1, 1);
                }
            } else {
                for (let y = 0; y < S; y += 2) {
                    const pattern = (y + (dir === 'east' ? 1 : 0)) % 4;
                    const xOff = pattern === 0 ? 0 : pattern === 1 ? 1 : 2;
                    ctx.fillRect(cx + edgeX + xOff, cy + y, 1, 2);
                    if (y % 4 === 0) ctx.fillRect(cx + edgeX + 1 + (pattern % 2), cy + y + 1, 1, 1);
                    if (y % 6 === 0) ctx.fillRect(cx + edgeX + 2, cy + y, 1, 1);
                    if (y % 8 === 0) ctx.fillRect(cx + edgeX + 2, cy + y + 1, 1, 1);
                }
            }
            ctx.fillStyle = profile.accent;
            if (dir === 'north' || dir === 'south') {
                ctx.fillRect(cx + 2, cy + (dir === 'north' ? 2 : S - 4), S - 4, 1);
            } else {
                ctx.fillRect(cx + (dir === 'west' ? 2 : S - 4), cy + 2, 1, S - 4);
            }
        } else if (dir === 'north' || dir === 'south') {
            for (let x = 0; x < S; x += 2) {
                const y0 = dir === 'north' ? 0 : S - 3;
                ctx.fillRect(cx + x, cy + y0 + ((x / 2) % 2), 2, 1);
                ctx.fillStyle = profile.accent;
                ctx.fillRect(cx + x + (profile.mode === 'foam' ? 1 : 0), cy + y0 + 2, 1, 1);
                if (profile.mode === 'shore' && x % 4 === 0) ctx.fillRect(cx + x + 1, cy + y0 + 1, 1, 1);
                ctx.fillStyle = profile.side;
            }
        } else {
            for (let y = 0; y < S; y += 2) {
                const x0 = dir === 'west' ? 0 : S - 3;
                ctx.fillRect(cx + x0 + ((y / 2) % 2), cy + y, 1, 2);
                ctx.fillStyle = profile.accent;
                ctx.fillRect(cx + x0 + 2, cy + y + (profile.mode === 'foam' ? 1 : 0), 1, 1);
                if (profile.mode === 'shore' && y % 4 === 0) ctx.fillRect(cx + x0 + 1, cy + y + 1, 1, 1);
                ctx.fillStyle = profile.side;
            }
        }

        if (profile.mode === 'crack') {
            ctx.fillStyle = profile.accent;
            if (dir === 'north' || dir === 'south') {
                ctx.fillRect(cx + Math.floor(S * 0.35), cy + oy + 1, 1, 2);
                ctx.fillRect(cx + Math.floor(S * 0.6), cy + oy, 1, 3);
            } else {
                ctx.fillRect(cx + ox + 1, cy + Math.floor(S * 0.35), 2, 1);
                ctx.fillRect(cx + ox, cy + Math.floor(S * 0.6), 3, 1);
            }
        }
    }
    drawCornerBlend(ctx, tileType, cx, cy, neighbors, S);
}

export function drawTile(ctx, tileType, cx, cy, rngSeed, S = 16, neighbors = null) {
    const p = TILE_PAL[tileType] || TILE_PAL.stone_floor;
    const guide = TILE_BIBLE[tileType] || TILE_BIBLE.stone_floor;
    // Use seed only to pick a variant (0-7), not per-pixel noise positions.
    // Invalid seeds can leak in from callers during partial world/bootstrap states.
    const safeSeed = Number.isFinite(rngSeed) ? Math.abs(Math.trunc(rngSeed)) : 0;
    const variant = (safeSeed ^ (getNeighborSignature(tileType, neighbors) * 31)) % 8;
    const h = Math.floor(S / 2);
    const q = Math.floor(S / 4);
    const motif = guide.motifs.length ? guide.motifs[variant % guide.motifs.length] : null;

    ctx.fillStyle = p.base;
    ctx.fillRect(cx, cy, S, S);

    if (tileType === 'grass' || tileType === 'forest') {
        // Layered blades, tufts, and wear. The goal is a readably hand-authored turf tile.
        // Cohesive turf: keep the base fill consistent across tiles so the ground does not read as a
        // checkerboard of different greens. Variation lives in the blade/tuft detail, not the base color.
        const subType = Math.floor(variant / 2);
        const baseColor = tileType === 'forest' ? p.lo : p.base;
        const hiColor   = p.hi;
        const shadowColor = tileType === 'forest' ? '#102808' : '#2e5318';
        const state = edgeState(neighbors, tileType);

        ctx.fillStyle = baseColor;
        ctx.fillRect(cx, cy, S, S);

        // Three-layer turf structure: dark undergrowth, main blades, bright tips.
        const tuftPlans = [
            [[2, 11], [11, 4], [6, 2]],
            [[4, 3], [10, 9], [12, 4]],
            [[2, 5], [11, 11], [7, 3]],
            [[4, 9], [11, 4], [2, 3]],
            [[2, 3], [11, 3], [7, 10]],
            [[4, 10], [9, 10], [7, 4]],
            [[6, 3], [11, 11]],
            [[3, 3], [8, 10]],
        ][variant];

        tuftPlans.forEach(([tx, ty], idx) => {
            ctx.fillStyle = idx === 0 ? shadowColor : hiColor;
            ctx.fillRect(cx + tx, cy + ty, 1, 3);
            ctx.fillRect(cx + tx - 1, cy + ty + 1, 1, 1);
            ctx.fillRect(cx + tx + 1, cy + ty, 1, 1);
            if (idx > 0) {
                ctx.fillStyle = p.accent;
                ctx.fillRect(cx + tx, cy + ty, 1, 1);
            }
        });

        if (state === 'edge') {
            ctx.fillStyle = tileType === 'forest' ? '#0a1606' : '#5aa031';
            ctx.fillRect(cx + 1, cy + 1, 3, 1);
            ctx.fillRect(cx + S - 4, cy + S - 4, 3, 1);
        } else if (state === 'isolated') {
            ctx.fillStyle = tileType === 'forest' ? '#0e2008' : '#67b83d';
            ctx.fillRect(cx + 4, cy + 4, 2, 1);
            ctx.fillRect(cx + 9, cy + 9, 2, 1);
        }

        // Small edge shadows keep the tile from reading like flat noise.
        ctx.fillStyle = shadowColor;
        ctx.fillRect(cx, cy + h + 2, 2, 1);
        ctx.fillRect(cx + S - 3, cy + 2, 2, 1);
        if (tileType === 'forest') {
            ctx.fillRect(cx + 2, cy + S - 3, 3, 1);
            ctx.fillRect(cx + S - 5, cy + h, 2, 1);
        }

        // Sub-type detail overlays
        if (subType === 1) {
            // Lush: small damp patch
            ctx.fillStyle = tileType === 'forest' ? '#0e2008' : '#2a6018';
            ctx.fillRect(cx + h, cy + h + 1, 4, 2);
            ctx.fillRect(cx + h + 1, cy + h + 2, 1, 1);
        } else if (subType === 2) {
            // Dry: a few pale straw pixels
            ctx.fillStyle = '#c8b050';
            ctx.fillRect(cx + 2, cy + h - 1, 1, 2);
            ctx.fillRect(cx + S - 4, cy + h - 2, 1, 3);
            ctx.fillRect(cx + h, cy + 2, 1, 1);
        } else if (subType === 3 && variant === 7) {
            // Rare, subtle ground wear — kept small and tonal so it does not read as scattered brown blobs.
            ctx.fillStyle = tileType === 'forest' ? '#26340f' : '#3f6a22';
            ctx.fillRect(cx + h, cy + h, 2, 1);
            ctx.fillRect(cx + h + 1, cy + h + 1, 1, 1);
        }

        // Forest: leaf debris on all variants
        if (tileType === 'forest') {
            ctx.fillStyle = '#5a3010';
            ctx.fillRect(cx + 1, cy + S - 4, 2, 1);
            ctx.fillRect(cx + S - 4, cy + 2, 2, 1);
            ctx.fillRect(cx + 3, cy + 3, 1, 1);
            if (variant % 2 === 0) ctx.fillRect(cx + S - 5, cy + S - 5, 2, 1);
        }

        if (motif === 'flower' || motif === 'clearing') {
            ctx.fillStyle = '#ff80aa';
            ctx.fillRect(cx + q + 1, cy + q, 2, 2);
            ctx.fillRect(cx + q + 3, cy + q + 2, 1, 1);
            ctx.fillStyle = '#fff8c0';
            ctx.fillRect(cx + q + 1, cy + q, 1, 1);
        } else if (motif === 'dry_patch') {
            ctx.fillStyle = '#6a4928';
            ctx.fillRect(cx + h - 1, cy + h - 1, 4, 2);
        } else if (motif === 'root') {
            ctx.fillStyle = '#2a1408';
            ctx.fillRect(cx + 1, cy + h, 3, 1);
            ctx.fillRect(cx + h, cy + 2, 3, 1);
            ctx.fillRect(cx + h - 1, cy + h - 1, 2, 1);
        } else if (motif === 'leaf_litter') {
            ctx.fillStyle = '#5a3010';
            ctx.fillRect(cx + 2, cy + S - 4, 2, 1);
            ctx.fillRect(cx + S - 4, cy + 3, 2, 1);
            ctx.fillRect(cx + h - 2, cy + 2, 1, 1);
        } else if (motif === 'dense') {
            ctx.fillStyle = '#102808';
            ctx.fillRect(cx + 2, cy + h, 4, 2);
            ctx.fillRect(cx + h + 1, cy + h - 1, 2, 1);
        } else if (motif === 'tuft') {
            ctx.fillStyle = shadowColor;
            ctx.fillRect(cx + 4, cy + 4, 2, 1);
        }

    } else if (tileType === 'stone_floor') {
        // Worked stone slabs with slightly irregular cut lines and wear.
        const slabX = [1, 1 + h - 1, 1, 1 + h - 1];
        const slabY = [1, 1, 1 + h - 1, 1 + h - 1];
        const slabW = [h - 2, h - 2, h - 2, h - 2];
        const slabH = [h - 2, h - 2, h - 2, h - 2];
        const seamJitter = [0, variant % 2, (variant + 1) % 2, variant % 2];

        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h - 1, S, 3);
        ctx.fillRect(cx + h - 1, cy, 3, S);

        for (let i = 0; i < 4; i++) {
            const ox = slabX[i] + (i % 2 === 0 ? 0 : 1);
            const oy = slabY[i] + (i < 2 ? 0 : 1);
            ctx.fillStyle = i % 2 === 0 ? p.base : p.hi;
            ctx.fillRect(cx + ox, cy + oy, slabW[i] - seamJitter[i], slabH[i] - seamJitter[(i + 1) % 4]);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + ox + 1, cy + oy + 1, slabW[i] - 3, 1);
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + ox, cy + oy + slabH[i] - 1, slabW[i], 1);
        }
        // Wear, crack, moss, and clean stone variants.
        if (motif === 'wear') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + q + 1, cy + q + 1, 2, 1);
            ctx.fillRect(cx + h - 2, cy + h - 2, 2, 1);
            ctx.fillRect(cx + 4, cy + 4, 1, 1);
            ctx.fillRect(cx + 9, cy + 10, 1, 1);
        } else if (motif === 'crack') {
            ctx.fillStyle = p.lo;
            const crackStart = variant % 2 === 0 ? 2 : 4;
            for (let i = 0; i < S - 6; i++) {
                if (i % 3 !== 2) ctx.fillRect(cx + crackStart + i, cy + 2 + i, 1, 1);
                if (i % 4 === 0) ctx.fillRect(cx + crackStart + i - 1, cy + 3 + i, 1, 1);
            }
        } else if (motif === 'moss') {
            ctx.fillStyle = '#486830';
            ctx.fillRect(cx + 2, cy + h + 2, 4, 2);
            ctx.fillRect(cx + 8, cy + 2, 2, 1);
            ctx.fillStyle = '#60883a';
            ctx.fillRect(cx + 3, cy + h + 3, 1, 1);
            ctx.fillRect(cx + 9, cy + 3, 1, 1);
        } else {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 1, cy + 1, S - 2, 1);
            ctx.fillRect(cx + 2, cy + h - 1, 2, 1);
            ctx.fillRect(cx + S - 4, cy + S - 4, 1, 1);
            ctx.fillRect(cx + 7, cy + 7, 1, 1);
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
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx + q, cy + h - 1, 2, 1);
        ctx.fillRect(cx + h - 3, cy + 3, 1, 2);
        if (variant % 2 === 0) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + h - 1, cy + q, 1, 1);
            ctx.fillRect(cx + 2, cy + h - 3, 1, 1);
        }

    } else if (tileType === 'dirt') {
        // Packed earth with irregular clumps and soil variation; should read as ground, not planks.
        const rng = tileRng(safeSeed ^ 0x6d2b79f5);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx, cy, S, S);

        // Broad soil mottling.
        for (let i = 0; i < 12; i++) {
            const px = 1 + rng(S - 3);
            const py = 1 + rng(S - 3);
            const w = 1 + rng(3);
            const h2 = 1 + rng(2);
            ctx.fillStyle = i % 4 === 0 ? p.lo : (i % 3 === 0 ? p.hi : p.base);
            ctx.fillRect(cx + px, cy + py, w, h2);
        }

        // Fine grit and stones keep it from reading like fabric or floorboards.
        ctx.fillStyle = p.lo;
        for (let i = 0; i < 10; i++) {
            const px = 1 + rng(S - 2);
            const py = 1 + rng(S - 2);
            ctx.fillRect(cx + px, cy + py, 1, 1);
        }
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + 2, cy + 3, 1, 1);
        ctx.fillRect(cx + S - 4, cy + S - 5, 1, 1);
        ctx.fillRect(cx + 4, cy + S - 4, 1, 1);
        ctx.fillRect(cx + 8, cy + 5, 1, 1);

        if (motif === 'pebble') {
            const px = q + (variant * q) % h;
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + px, cy + h, 3, 2);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + px, cy + h, 3, 1);
        } else if (motif === 'rut' || motif === 'path') {
            // Trampled path wear should feel compressed and organic, not like planks.
            ctx.fillStyle = p.lo;
            for (let x = 1; x < S - 1; x += 2) {
                const y0 = cy + h - 1 + ((x + variant) % 3 === 0 ? 1 : 0);
                ctx.fillRect(cx + x, y0, 1, 1);
                if ((x + variant) % 4 === 0) ctx.fillRect(cx + x, y0 + 1, 1, 1);
            }
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 2, cy + h - 2, S - 4, 1);
            if (variant % 2 === 0) ctx.fillRect(cx + 4, cy + h - 1, S - 8, 1);
        } else if (motif === 'crack') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + q, cy + 2, 1, h - 2);
            ctx.fillRect(cx + h, cy + h, 1, h - 2);
            ctx.fillRect(cx + 2, cy + h - 3, 4, 1);
        } else if (motif === 'dune') {
            ctx.fillStyle = p.hi;
            ctx.fillRect(cx + 2, cy + 3, S - 4, 1);
            ctx.fillRect(cx + 3, cy + 4, S - 6, 1);
            ctx.fillRect(cx + 5, cy + 5, S - 10, 1);
        }

    } else if (tileType === 'mud') {
        // Wet cave mud — irregular 1-2px stipple for an organic damp-earth look
        const rng = tileRng(rngSeed ^ 0xdeadbeef);
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const n = (x * 7 + y * 13 + variant * 3) % 11;
                ctx.fillStyle = n < 2 ? p.lo : n < 4 ? p.hi : p.base;
                ctx.fillRect(cx + x, cy + y, 1, 1);
            }
        }
        // Damp sheen — small water-glint patch, position seeded per tile
        const sx = rng(S - 4) + 1;
        const sy = rng(S - 3) + 1;
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(cx + sx, cy + sy, 2, 1);
        ctx.fillRect(cx + sx + 1, cy + sy + 1, 1, 1);
        ctx.fillRect(cx + 2, cy + 2, 1, 1);
        if (variant % 2 === 1) ctx.fillRect(cx + S - 4, cy + S - 4, 1, 1);
        ctx.fillRect(cx + 4, cy + 5, 1, 1);
        ctx.globalAlpha = 1.0;

    } else if (tileType === 'sand') {
        // Wind-blown grain: scattered speckle + a couple of short, offset ripples. Deliberately NO
        // full-width horizontal bands or per-tile bottom shadow — those tile up into plank/panel seams.
        ctx.fillStyle = p.base;
        ctx.fillRect(cx, cy, S, S);
        for (let i = 0; i < 20; i++) {
            const px = (variant * 5 + i * 7) % S;
            const py = (variant * 3 + i * 11) % S;
            ctx.fillStyle = i % 6 === 0 ? p.lo : (i % 3 === 0 ? p.hi : p.base);
            ctx.fillRect(cx + px, cy + py, 1, 1);
        }
        // two short, broken ripples at varied positions — never spanning the full tile width
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + (variant * 3) % Math.max(1, S - 6), cy + 3 + (variant % 4), 3 + (variant % 3), 1);
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx + 2 + (variant * 5) % Math.max(1, S - 7), cy + S - 5 - (variant % 3), 3 + ((variant + 1) % 3), 1);
        if (variant % 2 === 0) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + (variant * 2) % Math.max(1, S - 2), cy + h, 2, 1);
        }
        if (motif === 'shoreline') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 2, cy + S - 3, S - 4, 1);
            ctx.fillRect(cx + 5, cy + S - 4, S - 10, 1);
        } else if (motif === 'dune') {
            ctx.fillStyle = p.hi;
            ctx.fillRect(cx + 3, cy + 2, S - 6, 1);
        }

    } else if (tileType === 'wall') {
        // Proper staggered brick with heavier top weight and a stronger support read.
        const bOff = (variant % 2) * h; // odd/even column stagger
        const bW = h - 1;
        const same = sameNeighborCount(neighbors, tileType);
        const exposed = Math.max(0, 4 - same);

        // Outer massing so the wall reads like a chunk of structure, not a flat pattern.
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy, S, 2);
        ctx.fillRect(cx, cy + S - 2, S, 2);
        ctx.fillRect(cx, cy, 2, S);
        ctx.fillRect(cx + S - 2, cy, 2, S);

        // Row 1
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + bOff + 1,     cy + 1,     bW - 1, h - 2);
        ctx.fillRect(cx + bOff - h + 1, cy + 1,     bW - 1, h - 2); // wrap-around brick
        ctx.fillRect(cx + bOff + h + 1, cy + 1,     bW - 1, h - 2); // wrap-around brick
        // Row 2
        ctx.fillRect(cx + (bOff + h/2 | 0) + 1, cy + h + 1, bW - 1, h - 2);
        ctx.fillRect(cx + (bOff - h/2 | 0) + 1, cy + h + 1, bW - 1, h - 2);
        ctx.fillRect(cx + (bOff + h/2 | 0) - h + 1, cy + h + 1, bW - 1, h - 2);
        // Mortar (dark lines) and highlight bevels keep the wall readable at a glance.
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + h, S, 2);
        for (let bx = 0; bx <= S; bx += h) {
            ctx.fillRect(cx + ((bx + bOff) % S), cy, 1, h);
            ctx.fillRect(cx + (((bx + bOff + (h / 2 | 0)) % S)), cy + h, 1, h);
        }
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + bOff + 2,     cy + 2, bW - 3, 1);
        ctx.fillRect(cx + (bOff + h/2 | 0) + 2, cy + h + 2, bW - 3, 1);
        if (motif === 'crack' || exposed >= 2) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + q, cy + 2, 1, S - 4);
            ctx.fillRect(cx + h - 2, cy + 2, 1, S - 4);
            ctx.fillRect(cx + 3, cy + h - 1, S - 6, 1);
            ctx.fillRect(cx + 5, cy + 4, 1, 3);
        } else if (motif === 'buttress') {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + h - 1, cy + 1, 2, S - 2);
            ctx.fillRect(cx + 1, cy + h - 1, 2, 1);
            ctx.fillRect(cx + S - 4, cy + 2, 1, S - 4);
        } else if (same <= 1) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 2, cy + 2, 2, 1);
            ctx.fillRect(cx + S - 4, cy + S - 4, 2, 1);
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 3, cy + 3, 1, S - 6);
            ctx.fillRect(cx + S - 4, cy + 3, 1, S - 6);
            ctx.fillRect(cx + 6, cy + 9, 1, 2);
        }

    } else if (tileType === 'water') {
        // Layered pool geometry — outer rim, deep center, and bright surface crests.
        const state = edgeState(neighbors, tileType);
        const isPool = state === 'isolated' || state === 'edge';
        const isDeep = state === 'center' || state === 'interior';
        const same = sameNeighborCount(neighbors, tileType);
        const shiftX = ((variant % 3) - 1) * 0.35;
        const shiftY = (((variant >> 1) % 3) - 1) * 0.25;
        const missingNorth = neighbors?.north !== tileType;
        const missingSouth = neighbors?.south !== tileType;
        const missingWest = neighbors?.west !== tileType;
        const missingEast = neighbors?.east !== tileType;
        const blobSeed = tileRng(safeSeed ^ (same << 4) ^ (isPool ? 0x9e37 : 0x6a09));
        const rx = isPool ? 5.2 : 4.7;
        const ry = isPool ? 4.4 : 3.5;
        const cornerBias = (x, y) => {
            let cut = 0;
            if (missingNorth && y < 4) cut += (4 - y) * 0.18;
            if (missingSouth && y > 11) cut += (y - 11) * 0.18;
            if (missingWest && x < 4) cut += (4 - x) * 0.18;
            if (missingEast && x > 11) cut += (x - 11) * 0.18;
            return cut;
        };
        const fillMass = (fillColor, rxMul, ryMul, threshold, jitter = 0) => {
            ctx.fillStyle = fillColor;
            for (let y = 1; y < S - 1; y++) {
                for (let x = 1; x < S - 1; x++) {
                    const dx = (x - h + 0.5 - shiftX) / (rx * rxMul);
                    const dy = (y - h + 0.5 + shiftY) / (ry * ryMul);
                    const wobble = ((blobSeed(11) - 5) * 0.02) + ((blobSeed(7) - 3) * 0.015) + jitter;
                    const d = (dx * dx) + (dy * dy) + cornerBias(x, y) + wobble;
                    if (d <= threshold) ctx.fillRect(cx + x, cy + y, 1, 1);
                }
            }
        };

        // Build a visibly organic mass using per-pixel distance fields so the tile stops reading as a square.
        fillMass(p.lo, 1.00, 1.00, 1.02);
        fillMass(p.base, 0.86, 0.84, 0.88, -0.04);
        fillMass(p.hi, 0.62, 0.56, 0.96, 0.02);
        fillMass(p.accent, 0.36, 0.30, 0.98, 0.05);

        // Soft outer rim and surface contrast.
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 2, cy + 4, 3, 1);
        ctx.fillRect(cx + S - 5, cy + 4, 3, 1);
        ctx.fillRect(cx + 4, cy + 2, 2, 1);
        ctx.fillRect(cx + 4, cy + S - 5, 2, 1);

        // Wave crests at consistent Y offsets, shifted by variant.
        const waveShift = ((variant + same) * (S / 8)) % S;
        [[S * 0.15, p.hi, Math.floor(S * 0.6)],
         [S * 0.4,  p.accent, Math.floor(S * 0.35)],
         [S * 0.65, p.hi, Math.floor(S * 0.5)]].forEach(([wy, color, wl]) => {
            ctx.fillStyle = color;
            const wx = Math.floor((waveShift) % Math.max(1, (S - wl)));
            ctx.fillRect(cx + wx, cy + Math.floor(wy), wl, 1);
            ctx.fillRect(cx + wx + 1, cy + Math.floor(wy) + 1, Math.max(1, wl - 2), 1);
        });
        if (motif === 'pool' || motif === 'foam' || isPool) {
            ctx.fillStyle = p.accent;
            ctx.globalAlpha = 0.35;
            ctx.fillRect(cx + 2, cy + 2, S - 4, 1);
            ctx.fillRect(cx + 3, cy + 3, S - 6, 1);
            ctx.fillRect(cx + 4, cy + 4, S - 8, 1);
            ctx.globalAlpha = 1.0;
        } else if (motif === 'deep' || isDeep) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = p.lo;
            for (let y = 2; y < S - 2; y++) {
                for (let x = 2; x < S - 2; x++) {
                    const dx = (x - h + 0.5 - shiftX * 0.4) / (isPool ? 3.8 : 3.2);
                    const dy = (y - h + 0.5 - shiftY * 0.4) / (isPool ? 3.0 : 2.4);
                    if ((dx * dx) + (dy * dy) <= 1.02) ctx.fillRect(cx + x, cy + y, 1, 1);
                }
            }
            ctx.globalAlpha = 1.0;
        } else if (motif === 'ripple') {
            ctx.fillStyle = p.hi;
            ctx.fillRect(cx + 1, cy + h, S - 2, 1);
            ctx.fillRect(cx + 2, cy + h - 2, S - 4, 1);
            ctx.fillRect(cx + 3, cy + h + 1, S - 6, 1);
        }
        // Sparkle — only on variant 0
        if (variant === 0 || sameNeighborCount(neighbors, tileType) >= 3 || isPool) {
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.5;
            ctx.fillRect(cx + q, cy + q, 2, 1);
            ctx.fillRect(cx + S - 5, cy + 3, 1, 1);
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
        // Wood planks with stronger grain direction and less flat plank-strip feel.
        const plankHeights = [5, 5, 6];
        const plankYs = [0, 5, 10];
        plankYs.forEach((py, i) => {
            const ph = plankHeights[i];
            ctx.fillStyle = i % 2 === 0 ? p.base : p.hi;
            ctx.fillRect(cx, cy + py, S, ph);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 1, cy + py + 1, S - 2, 1);
            ctx.fillRect(cx + 2, cy + py + 3, S - 4, 1);
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx, cy + py + ph - 1, S, 1);
            ctx.fillRect(cx + 2, cy + py + 2, S - 4, 1);
        });
        // Dark seam lines and end caps make the floor feel assembled.
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy + 5, S, 1);
        ctx.fillRect(cx, cy + 10, S, 1);
        ctx.fillRect(cx + 1, cy + 1, 1, S - 2);
        ctx.fillRect(cx + S - 2, cy + 1, 1, S - 2);
        // Knot, rug, and wear variants.
        if (motif === 'rug') {
            ctx.fillStyle = '#704018';
            ctx.fillRect(cx + 2, cy + h - 2, S - 4, 3);
            ctx.fillStyle = '#c8a868';
            ctx.fillRect(cx + 3, cy + h - 1, S - 6, 1);
            ctx.fillRect(cx + 4, cy + h, S - 8, 1);
            ctx.fillRect(cx + 6, cy + h - 3, S - 12, 1);
        } else if (motif === 'wear') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 2, cy + h, 3, 1);
            ctx.fillRect(cx + S - 5, cy + 2, 2, 1);
            ctx.fillRect(cx + 4, cy + 4, 1, 1);
            ctx.fillRect(cx + 8, cy + 9, 1, 1);
        } else if (variant === 0) {
            const kx = cx + q + 2, ky = cy + q + 1;
            ctx.fillStyle = p.lo;
            ctx.fillRect(kx, ky, 4, 3);
            ctx.fillRect(kx+1, ky-1, 2, 1);
            ctx.fillRect(kx+1, ky+3, 2, 1);
            ctx.fillStyle = p.base;
            ctx.fillRect(kx+1, ky+1, 2, 1);
        } else if (variant === 3) {
            ctx.fillStyle = '#7c5228';
            ctx.fillRect(cx + 2, cy + 3, S - 4, 1);
            ctx.fillRect(cx + 3, cy + 4, 1, 1);
            ctx.fillRect(cx + 5, cy + 5, 1, 1);
            ctx.fillRect(cx + 7, cy + 6, 1, 1);
            ctx.fillRect(cx + 10, cy + 9, 1, 1);
        }

    } else if (tileType === 'dungeon') {
        // Ceremonial masonry with a more carved read than a pure checkerboard.
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx, cy, S, 2);
        ctx.fillRect(cx, cy + S - 2, S, 2);
        ctx.fillRect(cx, cy, 2, S);
        ctx.fillRect(cx + S - 2, cy, 2, S);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx + 1, cy + 1, S - 2, S - 2);
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx + 2, cy + 2, h - 3, h - 3);
        ctx.fillRect(cx + h + 2, cy + h + 2, h - 3, h - 3);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx + h + 2, cy + 2, h - 3, h - 3);
        ctx.fillRect(cx + 2, cy + h + 2, h - 3, h - 3);
        // Mortar and bevels.
        ctx.fillStyle = p.lo;
        ctx.fillRect(cx + h - 1, cy, 2, S);
        ctx.fillRect(cx, cy + h - 1, S, 2);
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + 2, cy + 2, h - 4, 1);
        ctx.fillRect(cx + 2, cy + 2, 1, h - 4);
        ctx.fillRect(cx + h + 3, cy + h + 3, h - 4, 1);
        ctx.fillRect(cx + h + 3, cy + h + 3, 1, h - 4);
        if (motif === 'glyph') {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + h - 1, cy + h - 1, 3, 1);
            ctx.fillRect(cx + h, cy + h - 2, 1, 3);
        } else if (variant === 0) {
            const mx = cx + h, my = cy + h;
            ctx.fillStyle = p.accent;
            ctx.fillRect(mx - 1, my, 3, 1);
            ctx.fillRect(mx, my - 1, 1, 3);
            ctx.fillStyle = p.lo;
            ctx.fillRect(mx, my, 1, 1);
        } else if (motif === 'ornament') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 2, cy + 2, 2, 1);
            ctx.fillRect(cx + S - 4, cy + S - 4, 2, 1);
            ctx.fillRect(cx + 3, cy + 3, 1, 1);
            ctx.fillRect(cx + 10, cy + 10, 1, 1);
            ctx.fillRect(cx + 5, cy + 9, 1, 1);
        }

    } else if (tileType === 'cave') {
        // Cave stone in lumpy masses, closer to carved rock than hard rectangles.
        const cells = [
            [1, 1, 5, 4], [6, 1, 5, 5],
            [1, 5, 4, 5], [5, 5, 6, 4],
            [3, 2, 2, 2], [8, 8, 2, 2],
        ];
        cells.forEach(([sx, sy, sw, sh], i) => {
            const ox = sx + (i % 2);
            const oy = sy + ((variant + i) % 2);
            const w = sw + ((i + variant) % 2);
            const h2 = sh + (i % 3 === 0 ? 1 : 0);
            ctx.fillStyle = i % 3 === 0 ? p.lo : (i % 2 ? p.hi : p.base);
            ctx.fillRect(cx + ox, cy + oy, w, h2);
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + ox, cy + oy, w, 1);
            ctx.fillStyle = '#1a0a00';
            ctx.fillRect(cx + ox, cy + oy + h2, w, 1);
        });
        ctx.fillStyle = '#27170b';
        ctx.fillRect(cx + 2, cy + h - 2, 2, 1);
        ctx.fillRect(cx + S - 4, cy + 3, 1, 2);
        ctx.fillRect(cx + 4, cy + 9, 1, 1);
        if (motif === 'glint') {
            ctx.fillStyle = p.accent;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(cx + h - 1, cy + q, 2, 1);
            ctx.fillRect(cx + 7, cy + 6, 2, 1);
            ctx.globalAlpha = 1.0;
        } else if (motif === 'pocket') {
            ctx.fillStyle = '#1a0a00';
            ctx.fillRect(cx + 2, cy + h - 1, 3, 2);
            ctx.fillRect(cx + S - 5, cy + 2, 2, 1);
        } else if (motif === 'vein') {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cx + 2, cy + 2, S - 4, 1);
            ctx.fillRect(cx + 3, cy + S - 4, S - 6, 1);
            ctx.fillRect(cx + h - 1, cy + h - 1, 2, 1);
            ctx.fillRect(cx + 4, cy + 4, 1, 1);
            ctx.fillRect(cx + 9, cy + 7, 1, 1);
        }

    } else if (tileType === 'ice') {
        // Frozen surface with layered plates and sharper crack lines.
        ctx.fillStyle = p.hi;
        ctx.fillRect(cx, cy, S, S);
        ctx.fillStyle = p.base;
        ctx.fillRect(cx + 1, cy + 1, S - 2, S - 2);
        ctx.fillStyle = p.accent;
        ctx.fillRect(cx + q, cy + q, h, 1);
        ctx.fillRect(cx + 3, cy + 3, 3, 1);
        ctx.fillRect(cx + 8, cy + 7, 2, 1);
        // Crack clusters vary by motif.
        const crackStart = cx + 2 + (variant % 3);
        const crackY = cy + 4 + (variant % 2);
        if (motif === 'crack' || motif === 'sheet') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(crackStart, crackY, 6, 1);
            ctx.fillRect(crackStart + 5, crackY, 1, 5);
            ctx.fillRect(cx + 7, cy + 2, 1, 4);
            ctx.fillRect(cx + 4, cy + 10, 4, 1);
        } else if (motif === 'frost') {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + 1, cy + h - 2, S - 2, 1);
            ctx.fillRect(cx + h - 1, cy + 1, 1, S - 2);
            ctx.fillRect(cx + 3, cy + 3, 2, 1);
            ctx.fillRect(cx + 6, cy + 6, 2, 1);
            ctx.fillRect(cx + 9, cy + 4, 1, 2);
        }
        // Frosted plate highlights and corner bite-out keep it from reading as flat blue.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx + 2, cy + 2, 2, 1);
        ctx.fillRect(cx + 2, cy + 2, 1, 2);
        ctx.fillRect(cx + 10, cy + 3, 1, 1);
        ctx.fillRect(cx + 3, cy + 9, 1, 1);
        if (variant % 2 === 0) {
            ctx.fillStyle = p.lo;
            ctx.fillRect(cx + S - 4, cy + S - 4, 2, 1);
        }
    }

    blendTileEdges(ctx, tileType, cx, cy, neighbors, S);
}

// --- AUTHORED SPRITE BITMASKS ---
// Bitmask templates (0: transparent, 1: outline, 2: secondary, 3: primary, 4: accent, 5: shadow)
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
    player_walk1: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01331100",
        "01300110", "00110000"
    ],
    player_walk2: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_walk3: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "00113310",
        "01100310", "00001100"
    ],
    player_walk4: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_back_walk1: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01331100",
        "01300110", "00110000"
    ],
    player_back_walk2: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_back_walk3: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "00113310",
        "01100310", "00001100"
    ],
    player_back_walk4: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "00133100", "01333310", "13333331", "01333310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_side_walk1: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133100", "01333310", "01333110", "01333110", "01133100", "01331000",
        "01300000", "00110000"
    ],
    player_side_walk2: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133100", "01333310", "01333110", "01333110", "01133100", "01133100",
        "01100000", "01100000"
    ],
    player_side_walk3: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133100", "01333310", "01333110", "01333110", "01133100", "00113300",
        "00001100", "00000110"
    ],
    player_side_walk4: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133100", "01333310", "01333110", "01333110", "01133100", "01133100",
        "01100000", "01100000"
    ],
    player_attack: [
        "00011000", "00133100", "01333310", "01333310", "00133100", "00011000",
        "00133100", "01333331", "13333330", "01333100", "01133100", "01300110",
        "01100010", "00110000"
    ],
    player_attack_side: [
        "00011100", "00133310", "01333310", "01333110", "00133100", "00011000",
        "00133300", "01333310", "01333310", "01333110", "01133000", "01103000",
        "01100000", "01000000"
    ],
    player_attack_back: [
        "00011000", "00122100", "01222210", "01222210", "00122100", "00011000",
        "01133100", "11333310", "13333310", "01133310", "01133110", "01133110",
        "01100110", "01100110"
    ],
    player_hurt: [
        "00011000", "00113100", "01333210", "01332210", "00113100", "00011000",
        "00133100", "11333100", "11332100", "01332100", "01133010", "01133010",
        "01100100", "01100000"
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
    // Tree — 16px wide sphere canopy, bark trunk, GBC Zelda style
    tree: [
        "0001334310000000",
        "0013334433100000",
        "0133443344310000",
        "1334334343431000",
        "1343433434331000",
        "1334344334331000",
        "0133334433310000",
        "0013333333100000",
        "0001333331000000",
        "0000011100000000",
        "0000012100000000",
        "0000012100000000",
        "0000012100000000",
        "0000012100000000",
    ],
    shrub: [
        "00000000", "00033000", "00343300", "03433430",
        "03334430", "33334333", "33333333", "03334330", "00000000"
    ],
    rock: [
        "00000000", "00000000", "00222200", "02222220",
        "22212222", "22112222", "22222222", "02222220", "00000000"
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
    log: [
        "00000000", "00000000", "00011100", "00155510",
        "01543351", "15432235", "15433335", "01543351",
        "00155510", "00011100", "00000000", "00000000"
    ],
    ore: [
        "00000000", "00000000", "00055000", "00544450",
        "05433345", "54343435", "05434350", "00544450",
        "00055000", "00000000", "00000000", "00000000"
    ],
    herbs: [
        "00000000", "00033000", "00344300", "03433430",
        "00333300", "00033030", "00343000", "00133100",
        "00013100", "00001000", "00001000", "00000000"
    ],
    fiber: [
        "00000000", "00300030", "03043003", "30430030",
        "03300303", "00330030", "00043000", "00133100",
        "00013100", "00001000", "00001000", "00000000"
    ],
    stone: [
        "00000000", "00000000", "00055000", "00533350",
        "05322335", "53233323", "05333350", "00555500",
        "00011000", "00000000", "00000000", "00000000"
    ],
    coal: [
        "00000000", "00000000", "00011000", "00155510",
        "01522251", "15252525", "01522251", "00155510",
        "00011000", "00000000", "00000000", "00000000"
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
    guard_back:     'guard',
    guard_side:     'guard',
    // Enemy directional + attack variants — resolved to base until PNG strips are authored
    wolf_back:           'wolf',        wolf_side:           'wolf',        wolf_attack:           'wolf',
    forest_wolf_back:    'wolf',        forest_wolf_side:    'wolf',        forest_wolf_attack:    'wolf',
    goblin_back:         'goblin',      goblin_side:         'goblin',      goblin_attack:         'goblin',
    bandit_back:         'bandit',      bandit_side:         'bandit',      bandit_attack:         'bandit',
    skeleton_back:       'skeleton',    skeleton_side:       'skeleton',    skeleton_attack:       'skeleton',
    cave_troll_back:     'cave_troll',  cave_troll_side:     'cave_troll',  cave_troll_attack:     'cave_troll',
    mountain_troll_back: 'cave_troll',  mountain_troll_side: 'cave_troll',  mountain_troll_attack: 'cave_troll',
    wraith_back:         'wraith',      wraith_side:         'wraith',      wraith_attack:         'wraith',
    ruin_shade_back:     'wraith',      ruin_shade_side:     'wraith',      ruin_shade_attack:     'wraith',
    crab_back:           'crab',        crab_side:           'crab',        crab_attack:           'crab',
    throne_guardian_back:'throne_guardian', throne_guardian_side:'throne_guardian', throne_guardian_attack:'throne_guardian',
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
    } else if (NPC_IDLE_FRAMES[resolvedType]?.[frameIdx]) {
        // Fallback: authoring-friendly string-grid format — edit npc-idle-frames.js
        shape = NPC_IDLE_FRAMES[resolvedType][frameIdx];
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
        '4': '#ffffff',
        '5': '#444444'
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
    self:  { primary: '#20e840', secondary: '#0a8020', outline: '#001800', accent: '#ffffff', shadow: '#0b3a12' },
    // Other players — variants keyed peer0..peer5, picked by seed hash
    peer:  { primary: '#30c0ff', secondary: '#0878b8', outline: '#001828', accent: '#ffffff', shadow: '#0f4262' },
    peer0: { primary: '#30c0ff', secondary: '#0878b8', outline: '#001828', accent: '#ffffff', shadow: '#0f4262' }, // sky blue
    peer1: { primary: '#ff9a30', secondary: '#b85008', outline: '#180800', accent: '#ffffff', shadow: '#5a2608' }, // amber
    peer2: { primary: '#c030ff', secondary: '#780898', outline: '#180028', accent: '#ffffff', shadow: '#46105a' }, // violet
    peer3: { primary: '#30ff9a', secondary: '#087848', outline: '#001818', accent: '#ffffff', shadow: '#0d5a3e' }, // mint
    peer4: { primary: '#ff3060', secondary: '#980820', outline: '#180010', accent: '#ffffff', shadow: '#621428' }, // rose
    peer5: { primary: '#f0e830', secondary: '#988000', outline: '#181400', accent: '#ffffff', shadow: '#625818' }, // gold
    // Generic NPC fallback
    npc:   { primary: '#ffd820', secondary: '#a07800', outline: '#201800', accent: '#ffffff', shadow: '#6a5410' },
    // Guard — steel blue armour, gold trim
    npcGuard:  { primary: '#8098c8', secondary: '#3850a0', outline: '#080820', accent: '#f8e060', shadow: '#2b3d72' },
    // Barkeep — warm amber/brown
    npcWarm:   { primary: '#e09040', secondary: '#884818', outline: '#200800', accent: '#fff8d0', shadow: '#6a3614' },
    // Merchant — rich purple-maroon
    npcTrade:  { primary: '#c06890', secondary: '#703050', outline: '#180010', accent: '#ffd8f0', shadow: '#4e2338' },
    // Herbalist — vivid leaf green
    npcLeaf:   { primary: '#48c838', secondary: '#186818', outline: '#001800', accent: '#d8ffd0', shadow: '#24561a' },
    // Sage — cool lilac
    npcSage:   { primary: '#b090d8', secondary: '#604898', outline: '#100820', accent: '#f0e8ff', shadow: '#4c3c70' },
    // Bard — bright teal
    npcSong:   { primary: '#28d8c0', secondary: '#088070', outline: '#001818', accent: '#d0fff8', shadow: '#135a54' },
    // Enemy — fallback vivid red
    enemy: { primary: '#f03020', secondary: '#801008', outline: '#180000', accent: '#ffee00', shadow: '#5e120d' },
    // Per-type enemy palettes — distinct colors for GBC readability
    enemy_wolf:           { primary: '#9a7248', secondary: '#5c3e20', outline: '#1a1000', accent: '#d4b080', shadow: '#3a2610' },
    enemy_forest_wolf:    { primary: '#9a7248', secondary: '#5c3e20', outline: '#1a1000', accent: '#d4b080', shadow: '#3a2610' },
    enemy_bandit:         { primary: '#606070', secondary: '#303038', outline: '#080810', accent: '#c8c8d8', shadow: '#28283a' },
    enemy_goblin:         { primary: '#5a8c20', secondary: '#2c5008', outline: '#081000', accent: '#98d040', shadow: '#1e400a' },
    enemy_skeleton:       { primary: '#d0c8a0', secondary: '#888060', outline: '#201808', accent: '#fffff0', shadow: '#605840' },
    enemy_ruin_skeleton:  { primary: '#d0c8a0', secondary: '#888060', outline: '#201808', accent: '#fffff0', shadow: '#605840' },
    enemy_wraith:         { primary: '#6848a8', secondary: '#301870', outline: '#080018', accent: '#c8a8ff', shadow: '#280d58' },
    enemy_forest_shade:   { primary: '#6848a8', secondary: '#301870', outline: '#080018', accent: '#c8a8ff', shadow: '#280d58' },
    enemy_ruin_shade:     { primary: '#3088a8', secondary: '#104858', outline: '#001018', accent: '#80e0ff', shadow: '#0d3a4a' },
    enemy_cave_shade:     { primary: '#3088a8', secondary: '#104858', outline: '#001018', accent: '#80e0ff', shadow: '#0d3a4a' },
    enemy_cave_troll:     { primary: '#587840', secondary: '#2c4018', outline: '#080c00', accent: '#98b870', shadow: '#233018' },
    enemy_forest_troll:   { primary: '#587840', secondary: '#2c4018', outline: '#080c00', accent: '#98b870', shadow: '#233018' },
    enemy_mountain_troll: { primary: '#708098', secondary: '#384050', outline: '#101418', accent: '#b0c0d8', shadow: '#2a3040' },
    enemy_crab:           { primary: '#c05020', secondary: '#782808', outline: '#180800', accent: '#f09060', shadow: '#5a2210' },
    enemy_throne_guardian:{ primary: '#b8980a', secondary: '#706008', outline: '#181400', accent: '#fff080', shadow: '#4e4408' },
};

// Compact grouped palette table: [primary, secondary, outline, accent, shadow]
const _SP = {
    g: ['#286820','#103808','#000820','#48b030','#163414'],  // vivid green (shrubs)
    tr: ['#357f2b','#8a5318','#214b1f','#79cf56','#23401b'], // tree: softer outline + brighter fluffy highlights
    w: ['#a06030','#583010','#180800','#d89050','#4a2810'],  // warm wood
    r: ['#707880','#404850','#101418','#a0aab0','#38404a'],  // slate grey/rock
    s: ['#b0a888','#706848','#181408','#d8d0b0','#5a523a'],  // warm stone/bones
    L: ['#a06030','#603010','#180800','#d09060','#4e2a12'],  // warm brown wood/log
    O: ['#808898','#484858','#101018','#c8d8b0','#3a4050'],  // grey-green ore with pale accent
    H: ['#48a030','#205810','#081800','#80e050','#1b4618'],  // vivid herb green
    F: ['#78b848','#386818','#081808','#b8e888','#31501e'],  // pale fiber green
    T: ['#909898','#585858','#181818','#c8d0c8','#3d3d3d'],  // light stone grey
    C: ['#282828','#101010','#000000','#484848','#1a1a1a'],  // near-black coal
    p: ['#d8c080','#906820','#180800','#f8e8a8','#68542c'],  // parchment/scroll
    d: ['#f0c020','#a06800','#181000','#fff088','#7a5608'],  // bright gold
    f: ['#f07820','#a03008','#180800','#ffe040','#6a2408'],  // vivid fire/torch
    i: ['#d0ecff','#90c0e0','#304860','#ffffff','#6f92a9'],  // crisp ice
    m: ['#c04828','#701808','#180000','#f09060','#5b1d12'],  // rich mushroom red
    h: ['#e8c878','#b08038','#201000','#fff0b0','#6d5626'],  // pale shell
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
    log:'L', ore:'O',
    herbs:'H', fiber:'F',
    stone:'T', coal:'C',
    well:'s', flower_pot:'w',
};

export function getSceneryPalette(label) {
    const a = _SP[_SM[label]] || _SP.r;
    return { primary: a[0], secondary: a[1], outline: a[2], accent: a[3], shadow: a[4] };
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
    const sh = hexToRgb(palette.shadow || palette.secondary || '#444444');

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], alpha = data[i+3];
        if (alpha === 0) continue;
        if (r === 255) { data[i]=a[0]; data[i+1]=a[1]; data[i+2]=a[2]; }
        else if (r === 204) { data[i]=p[0]; data[i+1]=p[1]; data[i+2]=p[2]; }
        else if (r === 68) { data[i]=sh[0]; data[i+1]=sh[1]; data[i+2]=sh[2]; }
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
