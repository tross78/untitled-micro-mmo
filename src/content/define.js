import { seededRNG, hashStr } from '../rules/utils.js';
import { SCENERY_DIMENSIONS, SCENERY_SIZE_CLASSES } from '../infra/graphics-constants.js';

// @ts-check

/**
 * @template {Record<string, unknown>} T
 * @param {'item' | 'enemy' | 'room' | 'npc' | 'quest' | 'recipe'} kind
 * @param {string} id
 * @param {T} definition
 * @returns {T & { id: string, kind: 'item' | 'enemy' | 'room' | 'npc' | 'quest' | 'recipe' }}
 */
const define = (kind, id, definition) => ({ ...definition, id, kind });

export const defineItem = (id, definition) => define('item', id, definition);
export const defineEnemy = (id, definition) => define('enemy', id, definition);
// Tile char → tile type name
const TILE_CHAR_MAP = {
    '.': null, 'W': 'wall', 'G': 'grass', 'I': 'interior',
    'V': 'water', 'S': 'stone_floor', 'D': 'dungeon', 'C': 'cave', 'Z': 'ice',
    'P': 'dirt', 'A': 'sand', 'F': 'forest', 'K': 'cobble'
};

const SCENERY_CLASS_BY_LABEL = Object.entries(SCENERY_SIZE_CLASSES).reduce((acc, [size, labels]) => {
    labels.forEach((label) => { acc[label] = size; });
    return acc;
}, /** @type {Record<string, string>} */ ({}));

const GENERATED_SCENERY_RULES = {
    tree: { edgeClearance: 1, minSpacing: 1, sameLabelSpacing: 2, maxCount: (area) => Math.max(2, Math.ceil(area / 110)) },
    rock: { edgeClearance: 1, minSpacing: 1, sameLabelSpacing: 1, maxCount: (area) => Math.max(2, Math.ceil(area / 72)) },
    shrub: { edgeClearance: 1, minSpacing: 0, sameLabelSpacing: 0, maxCount: (area) => Math.max(3, Math.ceil(area / 44)) },
    grave: { edgeClearance: 1, minSpacing: 1, sameLabelSpacing: 1, maxCount: (area) => Math.max(2, Math.ceil(area / 84)) },
    default: { edgeClearance: 1, minSpacing: 0, sameLabelSpacing: 0, maxCount: (area) => Math.max(2, Math.ceil(area / 60)) },
};

function getSceneryRule(label) {
    const rule = GENERATED_SCENERY_RULES[label] || GENERATED_SCENERY_RULES.default;
    if (SCENERY_CLASS_BY_LABEL[label] === 'large') {
        return {
            ...rule,
            edgeClearance: Math.max(rule.edgeClearance, 1),
            minSpacing: Math.max(rule.minSpacing, 1),
        };
    }
    return rule;
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function canPlaceGeneratedScenery(candidate, placedScenery, blockedTiles, width, height) {
    const rule = getSceneryRule(candidate.label);
    if (candidate.x < rule.edgeClearance || candidate.y < rule.edgeClearance) return false;
    if (candidate.x + candidate.w > width - rule.edgeClearance) return false;
    if (candidate.y + candidate.h > height - rule.edgeClearance) return false;

    for (let oy = 0; oy < candidate.h; oy++) {
        for (let ox = 0; ox < candidate.w; ox++) {
            if (blockedTiles.has(`${candidate.x + ox},${candidate.y + oy}`)) return false;
        }
    }

    for (const placed of placedScenery) {
        const placedRule = getSceneryRule(placed.label);
        let pad = Math.max(rule.minSpacing, placedRule.minSpacing);
        if (placed.label === candidate.label) pad = Math.max(pad, rule.sameLabelSpacing, placedRule.sameLabelSpacing);
        if (SCENERY_CLASS_BY_LABEL[placed.label] === 'large' || SCENERY_CLASS_BY_LABEL[candidate.label] === 'large') {
            pad = Math.max(pad, 1);
        }
        if (rectsOverlap(
            { x: candidate.x - pad, y: candidate.y - pad, w: candidate.w + pad * 2, h: candidate.h + pad * 2 },
            { x: placed.x, y: placed.y, w: placed.w || 1, h: placed.h || 1 }
        )) {
            return false;
        }
    }

    return true;
}

export const defineRoom = (id, definition) => {
    // Compression parsing (Phase 7.9.9.4)
    if (typeof definition.exitTiles === 'string') {
        definition.exitTiles = definition.exitTiles.split('|').map(s => {
            const [x, y, dest, destX, destY, type, w = '1', h = '1'] = s.split(',');
            return { x: +x, y: +y, dest, destX: +destX, destY: +destY, type: type || 'edge', w: +w, h: +h };
        });
    }
    if (typeof definition.scenery === 'string') {
        definition.scenery = definition.scenery.split('|').map(s => {
            const parts = s.split(',');
            const label = parts[2];
            const dims = SCENERY_DIMENSIONS[label] || [1, 1];
            const w = parts[3] ? +parts[3] : dims[0];
            const h = parts[4] ? +parts[4] : dims[1];
            return { x: +parts[0], y: +parts[1], label, w, h };
        });
    } else if (Array.isArray(definition.scenery)) {
        definition.scenery.forEach(sc => {
            const dims = SCENERY_DIMENSIONS[sc.label] || [1, 1];
            if (sc.w === undefined) sc.w = dims[0];
            if (sc.h === undefined) sc.h = dims[1];
        });
    }
    // Parse tile grid (Phase 8.2) — overrides tileOverrides where char != '.'
    if (Array.isArray(definition.tiles)) {
        const extras = [];
        definition.tiles.forEach((row, wy) => {
            for (let wx = 0; wx < row.length; wx++) {
                const type = TILE_CHAR_MAP[row[wx]];
                if (type) extras.push({ x: wx, y: wy, type });
            }
        });
        definition.tileOverrides = (definition.tileOverrides || []).concat(extras);
        delete definition.tiles;
    }

    // Constrained Terrain Generation (Phase 8.5c)
    if (definition.terrain && !definition.tileOverrides?.length && !definition.scenery?.length) {
        const t = definition.terrain;
        const rng = seededRNG(hashStr(id));
        const width = definition.width || 11;
        const height = definition.height || 11;
        const protectedTiles = new Set();

        // 1. Identify exit points to protect
        const exitPoints = [];
        if (definition.exits?.north) exitPoints.push({ x: Math.floor(width / 2), y: 0 });
        if (definition.exits?.south) exitPoints.push({ x: Math.floor(width / 2), y: height - 1 });
        if (definition.exits?.east)  exitPoints.push({ x: width - 1, y: Math.floor(height / 2) });
        if (definition.exits?.west)  exitPoints.push({ x: 0, y: Math.floor(height / 2) });
        (definition.exitTiles || []).forEach(et => {
            for (let iy = 0; iy < (et.h || 1); iy++) {
                for (let ix = 0; ix < (et.w || 1); ix++) {
                    const px = et.x + ix, py = et.y + iy;
                    exitPoints.push({ x: px, y: py });
                    protectedTiles.add(`${px},${py}`);
                }
            }
        });
        (definition.staticEntities || []).forEach(se => exitPoints.push({ x: se.x, y: se.y }));

        // 2. Protect 3x3 zones around critical points and shortest paths
        exitPoints.forEach(p => {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = p.x + dx, ny = p.y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) protectedTiles.add(`${nx},${ny}`);
                }
            }
        });

        if (exitPoints.length > 1) {
            for (let i = 0; i < exitPoints.length; i++) {
                const start = exitPoints[i];
                const end = exitPoints[(i + 1) % exitPoints.length];
                let cx = start.x;
                let cy = start.y;
                protectedTiles.add(`${cx},${cy}`);
                while (cx !== end.x || cy !== end.y) {
                    if (cx !== end.x) cx += (end.x > cx ? 1 : -1);
                    else cy += (end.y > cy ? 1 : -1);
                    protectedTiles.add(`${cx},${cy}`);
                    // Protect neighbors for 2-wide paths
                    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                        const nx = cx + dx, ny = cy + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) protectedTiles.add(`${nx},${ny}`);
                    }
                }
            }
        }

        // 3. Fill terrain
        const overrides = [];
        const scenery = [];
        const placedScenery = [];
        const blockedTiles = new Set(protectedTiles);
        const area = width * height;
        const placedByLabel = new Map();
        const maxByLabel = new Map((t.clutter || []).map((label) => [label, getSceneryRule(label).maxCount(area)]));
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const isEdge = x === 0 || x === width - 1 || y === 0 || y === height - 1;
                const isProtected = protectedTiles.has(`${x},${y}`);
                const isExit = exitPoints.some(p => p.x === x && p.y === y);

                if (isEdge && !isExit) {
                    overrides.push({ x, y, type: 'wall' });
                } else {
                    let placed = false;
                    if (!isProtected && t.clutter && rng(100) < (t.density || 10)) {
                        const label = t.clutter[rng(t.clutter.length)];
                        const currentCount = placedByLabel.get(label) || 0;
                        const maxCount = maxByLabel.get(label) || Infinity;
                        const [w, h] = SCENERY_DIMENSIONS[label] || [1, 1];
                        const candidate = { x, y, label, w, h };
                        if (currentCount < maxCount && canPlaceGeneratedScenery(candidate, placedScenery, blockedTiles, width, height)) {
                            scenery.push(candidate);
                            placedScenery.push(candidate);
                            placedByLabel.set(label, currentCount + 1);
                            placed = true;
                            for (let oy = 0; oy < h; oy++) {
                                for (let ox = 0; ox < w; ox++) {
                                    blockedTiles.add(`${x + ox},${y + oy}`);
                                }
                            }
                        }
                    }
                    if (!placed && t.floor) overrides.push({ x, y, type: t.floor });
                }
            }
        }
        definition.tileOverrides = (definition.tileOverrides || []).concat(overrides);
        definition.scenery = (definition.scenery || []).concat(scenery);
    }

    // Parse patrol paths (Phase 8.76 P4)
    if (Array.isArray(definition.staticEntities)) {
        definition.staticEntities.forEach(se => {
            if (typeof se.patrol === 'string') {
                se.patrol = se.patrol.split('|').map(p => {
                    const [px, py] = p.split(',');
                    return { x: +px, y: +py };
                });
            }
        });
    }

    return define('room', id, definition);
};
export const defineNpc = (id, definition) => define('npc', id, definition);
export const defineQuest = (id, definition) => define('quest', id, definition);
export const defineRecipe = (id, definition) => define('recipe', id, definition);

/**
 * @param {import('../domain/types.js').CommandDefinition} definition
 * @returns {import('../domain/types.js').CommandDefinition}
 */
export const defineCommand = (definition) => ({
  aliases: [],
  category: 'misc',
  ...definition,
});
