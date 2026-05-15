/**
 * Hearthwick Graphics Bible & Tile Taxonomy (Phase 8.55a)
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
