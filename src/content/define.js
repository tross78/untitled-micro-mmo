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
    'V': 'water', 'S': 'stone_floor', 'D': 'dungeon', 'C': 'cave', 'Z': 'ice'
};

export const defineRoom = (id, definition) => {
    // Compression parsing (Phase 7.9.9.4)
    if (typeof definition.exitTiles === 'string') {
        definition.exitTiles = definition.exitTiles.split('|').map(s => {
            const [x, y, dest, destX, destY, type] = s.split(',');
            return { x: +x, y: +y, dest, destX: +destX, destY: +destY, type: type || 'edge' };
        });
    }
    if (typeof definition.scenery === 'string') {
        definition.scenery = definition.scenery.split('|').map(s => {
            const [x, y, label, w = '1', h = '1'] = s.split(',');
            return { x: +x, y: +y, label, w: +w, h: +h };
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
