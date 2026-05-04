// @ts-check

import { itemDefinitions, enemyDefinitions, roomDefinitions, npcDefinitions, questDefinitions, recipeDefinitions } from './index.js';

const hasDuplicateIds = (definitions) => new Set(definitions.map((entry) => entry.id)).size !== definitions.length;

export const validateContent = () => {
  /** @type {string[]} */
  const problems = [];
  const rooms = /** @type {Array<Record<string, any>>} */ (roomDefinitions);
  const items = /** @type {Array<Record<string, any>>} */ (itemDefinitions);
  const enemies = /** @type {Array<Record<string, any>>} */ (enemyDefinitions);
  const npcs = /** @type {Array<Record<string, any>>} */ (npcDefinitions);
  const quests = /** @type {Array<Record<string, any>>} */ (questDefinitions);
  const recipes = /** @type {Array<Record<string, any>>} */ (recipeDefinitions);

  const collections = [
    ['items', items],
    ['enemies', enemies],
    ['rooms', rooms],
    ['npcs', npcs],
    ['quests', quests],
    ['recipes', recipes],
  ];

  for (const [name, definitions] of collections) {
    if (hasDuplicateIds(definitions)) {
      problems.push(`Duplicate ids found in ${name}`);
    }
  }

  const roomIds = new Set(rooms.map((room) => room.id));
  const itemIds = new Set(items.map((item) => item.id));
  const enemyIds = new Set(enemies.map((enemy) => enemy.id));
  const questIds = new Set(quests.map((quest) => quest.id));

  for (const room of rooms) {
    /** @type {Set<string>} */
    const occupiedExitSources = new Set();
    for (const dest of Object.values(room.exits || {})) {
      if (!roomIds.has(String(dest))) {
        problems.push(`Room "${room.id}" references missing exit destination "${dest}"`);
      }
    }
    for (const exitTile of room.exitTiles || []) {
      if (!roomIds.has(String(exitTile.dest))) {
        problems.push(`Room "${room.id}" has exitTile to missing room "${exitTile.dest}"`);
      }
      const width = exitTile.w || 1;
      const height = exitTile.h || 1;
      if (typeof exitTile.x === 'number' && (exitTile.x < 0 || exitTile.x >= room.width)) {
        problems.push(`Room "${room.id}" exitTile source x out of bounds`);
      }
      if (typeof exitTile.y === 'number' && (exitTile.y < 0 || exitTile.y >= room.height)) {
        problems.push(`Room "${room.id}" exitTile source y out of bounds`);
      }
      if (typeof exitTile.x === 'number' && typeof exitTile.y === 'number') {
        if (exitTile.x + width > room.width || exitTile.y + height > room.height) {
          problems.push(`Room "${room.id}" exitTile footprint exceeds source room bounds`);
        }
        for (let dx = 0; dx < width; dx++) {
          for (let dy = 0; dy < height; dy++) {
            const key = `${exitTile.x + dx},${exitTile.y + dy}`;
            if (occupiedExitSources.has(key)) {
              problems.push(`Room "${room.id}" has overlapping exitTiles at "${key}"`);
            } else {
              occupiedExitSources.add(key);
            }
          }
        }
      }
      const targetRoom = rooms.find((entry) => entry.id === exitTile.dest);
      if (targetRoom) {
        if (typeof exitTile.destX === 'number' && (exitTile.destX < 0 || exitTile.destX >= targetRoom.width)) {
          problems.push(`Room "${room.id}" exitTile destX out of bounds for "${exitTile.dest}"`);
        }
        if (typeof exitTile.destY === 'number' && (exitTile.destY < 0 || exitTile.destY >= targetRoom.height)) {
          problems.push(`Room "${room.id}" exitTile destY out of bounds for "${exitTile.dest}"`);
        }
      }
    }
    if (room.enemy && !enemyIds.has(room.enemy)) {
      problems.push(`Room "${room.id}" references missing enemy "${room.enemy}"`);
    }
  }

  for (const npc of npcs) {
    if (npc.home && !roomIds.has(String(npc.home))) {
      problems.push(`NPC "${npc.id}" references missing home room "${npc.home}"`);
    }
    for (const itemId of npc.shop || []) {
      if (!itemIds.has(String(itemId))) {
        problems.push(`NPC "${npc.id}" shop references missing item "${itemId}"`);
      }
    }
  }

  for (const quest of quests) {
    if (quest.prerequisite && !questIds.has(String(quest.prerequisite))) {
      problems.push(`Quest "${quest.id}" references missing prerequisite "${quest.prerequisite}"`);
    }
    if (quest.giver && !npcs.find((npc) => npc.id === quest.giver)) {
      problems.push(`Quest "${quest.id}" references missing giver "${quest.giver}"`);
    }
    if (quest.receiver && !npcs.find((npc) => npc.id === quest.receiver)) {
      problems.push(`Quest "${quest.id}" references missing receiver "${quest.receiver}"`);
    }
    if (quest.objective?.type === 'explore' && !roomIds.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" references missing room target "${quest.objective.target}"`);
    }
    if (quest.objective?.type === 'kill' && !enemyIds.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" references missing enemy target "${quest.objective.target}"`);
    }
    if (quest.objective?.type === 'fetch' && !itemIds.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" references missing item target "${quest.objective.target}"`);
    }
    if (quest.reward?.item && !itemIds.has(String(quest.reward.item))) {
      problems.push(`Quest "${quest.id}" references missing reward item "${quest.reward.item}"`);
    }
  }

  for (const recipe of recipes) {
    if (recipe.location && !roomIds.has(String(recipe.location))) {
      problems.push(`Recipe "${recipe.id}" references missing location "${recipe.location}"`);
    }
    if (!itemIds.has(String(recipe.output))) {
      problems.push(`Recipe "${recipe.id}" references missing output item "${recipe.output}"`);
    }
    for (const itemId of Object.keys(recipe.inputs || {})) {
      if (!itemIds.has(String(itemId))) {
        problems.push(`Recipe "${recipe.id}" references missing input item "${itemId}"`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
  };
};
