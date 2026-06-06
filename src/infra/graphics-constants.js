/**
 * Fenhollow Graphics Bible & Tile Taxonomy (Phase 8.55a)
 */

export const TILE_TAXONOMY = {
    natural:   ['grass', 'dirt', 'sand', 'forest'],
    structure: ['stone_floor', 'cobble', 'wall', 'interior', 'dungeon', 'cave', 'mud'],
    liquid:    ['water'],
    special:   ['exit', 'ice']
};

export const SCENERY_SIZE_CLASSES = {
    small:  ['torch', 'candle', 'scroll', 'mushroom', 'shell', 'bones', 'flower', 'potion', 'heart', 'crown', 'crate', 'barrel', 'snowflake', 'pillar', 'chair', 'well', 'flower_pot', 'log', 'ore', 'herbs', 'fiber', 'stone', 'coal'],
    medium: ['shrub', 'rock', 'sign', 'wheel', 'ladder', 'table', 'altar', 'counter', 'cauldron', 'bed', 'door_arch', 'stall', 'anchor', 'grave', 'stairs'],
    large:  ['tree', 'bookshelf', 'fireplace']
};

/**
 * Mapping of labels to canonical [width, height] in tiles.
 */
export const SCENERY_DIMENSIONS = {
    tree: [3, 3],
    bookshelf: [2, 1], // Read as 2 wide, 1 deep, but visually tall
    fireplace: [2, 1],
    table: [2, 1],
    bed: [2, 1],
    stall: [2, 2],
    altar: [1, 1],
    counter: [2, 1],
    door_arch: [2, 1],
    shrub: [1, 1],
    cauldron: [1, 1],
    sign: [1, 1],
    ladder: [1, 1],
    pillar: [1, 1],
    well: [1, 1],
};

/**
 * Collision masks for props whose reserved footprint is larger than their solid mass. A tree reserves
 * a 3x3 footprint so its canopy can spread wide and tall, but only the canopy mass and trunk should
 * block movement — the transparent corners must stay walkable so players can move around and past a
 * tree instead of hitting an invisible box. Offsets are [col, row] relative to the footprint origin;
 * props with no entry block their entire footprint (the default).
 */
export const SCENERY_COLLISION_MASK = {
    // Derived from the tree sprite's per-cell coverage (corners ~0-10%, the rest is canopy/trunk):
    // solid "plus" of canopy mass + trunk, with the four transparent corners left walkable.
    tree: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
};

/**
 * Whether a placed scenery object blocks the given world cell. Single source of truth for movement,
 * pathfinding, patrol generation, walkability queries, and content validation so collision stays
 * consistent everywhere (see DECISIONS "single gameplay truth").
 */
export function sceneryBlocksCell(s, x, y) {
    const w = s.w || 1, h = s.h || 1;
    if (x < s.x || x >= s.x + w || y < s.y || y >= s.y + h) return false;
    const mask = SCENERY_COLLISION_MASK[s.label];
    if (!mask) return true; // no mask => the whole footprint is solid
    const ox = x - s.x, oy = y - s.y;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i][0] === ox && mask[i][1] === oy) return true;
    }
    return false;
}

/**
 * Visual render treatment for scenery that should read taller or larger than its
 * blocking footprint without changing room collision semantics.
 */
export const SCENERY_RENDER_STYLE = {
    tree: { heightTiles: 3.75, yOffsetTiles: 0.75 },
    bookshelf: { heightTiles: 2, yOffsetTiles: 1 },
    fireplace: { heightTiles: 2, yOffsetTiles: 1 },
    door_arch: { heightTiles: 2, yOffsetTiles: 1 },
    pillar: { heightTiles: 2, yOffsetTiles: 1 },
    well: { heightTiles: 1.5, yOffsetTiles: 0.5 },
    altar: { heightTiles: 1.5, yOffsetTiles: 0.5 },
    shrub: { heightTiles: 1.5, yOffsetTiles: 0.5 },
};

/**
 * Footprint-relative draw scale for small ground clutter whose sprite art fills its whole cell.
 * Without this they render as tile-sized boulders/objects. Scaled sprites are centered horizontally
 * and seated on the bottom of their tile so they read as objects lying on the ground. Default is 1.
 */
export const SCENERY_RENDER_SCALE = {
    rock: 0.66,
    stone: 0.6,
    ore: 0.62,
    coal: 0.6,
    bones: 0.66,
    log: 0.7,
    mushroom: 0.62,
    shell: 0.55,
    herbs: 0.62,
    fiber: 0.6,
    flower: 0.6,
    snowflake: 0.55,
};

/**
 * HUD and Overlay Palette (Phase 8.55e)
 * Warm, readable, and cohesive.
 */
export const UI_PALETTE = {
    bg:      'rgba(18, 24, 18, 0.92)',
    bgLight: 'rgba(56, 78, 48, 0.85)',
    border:  '#c7d8ab',
    text:    '#edf5d7',
    textHi:  '#f6edc5',
    textLo:  '#adc39d',
    accent:  '#ffdd55',
    danger:  '#ff4444',
    success: '#88cc44',
    overlay: 'rgba(8, 12, 8, 0.75)',
};

export const UI_STYLE = {
    radius: 8,
    borderW: 2,
    pad: 10,
};
