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
export const defineRoom = (id, definition) => define('room', id, definition);
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
