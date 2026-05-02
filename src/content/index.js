// @ts-check

import {
  GAME_NAME,
  ENABLE_ADS,
  SEASONS,
  SEASON_LENGTH,
  moodMarkov,
  SCARCITY_ITEMS,
  MOOD_INITIAL,
  NPCS,
  QUESTS,
  DIALOGUE_POOLS,
  CORPORA,
  ENEMIES,
  ITEMS,
  RECIPES,
  world,
  DEFAULT_PLAYER_STATS,
  INSTANCE_CAP,
} from './data.js';
import { defineEnemy, defineItem, defineNpc, defineQuest, defineRecipe, defineRoom } from './define.js';
import { Registry } from './registry.js';

export {
  GAME_NAME,
  ENABLE_ADS,
  SEASONS,
  SEASON_LENGTH,
  moodMarkov,
  SCARCITY_ITEMS,
  MOOD_INITIAL,
  DIALOGUE_POOLS,
  CORPORA,
  DEFAULT_PLAYER_STATS,
  INSTANCE_CAP,
};

export const itemRegistry = new Registry('items').registerAll(
  Object.entries(ITEMS).map(([id, definition]) => defineItem(id, definition))
);
export const enemyRegistry = new Registry('enemies').registerAll(
  Object.entries(ENEMIES).map(([id, definition]) => defineEnemy(id, definition))
);
export const roomRegistry = new Registry('rooms').registerAll(
  Object.entries(world).map(([id, definition]) => defineRoom(id, definition))
);
export const npcRegistry = new Registry('npcs').registerAll(
  Object.entries(NPCS).map(([id, definition]) => defineNpc(id, definition))
);
export const questRegistry = new Registry('quests').registerAll(
  Object.entries(QUESTS).map(([id, definition]) => defineQuest(id, definition))
);
export const recipeRegistry = new Registry('recipes').registerAll(
  RECIPES.map((definition) => defineRecipe(definition.id, definition))
);

export const itemDefinitions = itemRegistry.all();
export const enemyDefinitions = enemyRegistry.all();
export const roomDefinitions = roomRegistry.all();
export const npcDefinitions = npcRegistry.all();
export const questDefinitions = questRegistry.all();
export const recipeDefinitions = recipeRegistry.all();

export const ITEMS_BY_ID = itemRegistry.toObject();
export const ENEMIES_BY_ID = enemyRegistry.toObject();
export const ROOMS_BY_ID = roomRegistry.toObject();
export const NPCS_BY_ID = npcRegistry.toObject();
export const QUESTS_BY_ID = questRegistry.toObject();
export const RECIPES_BY_ID = Object.fromEntries(recipeDefinitions.map((recipe) => [recipe.id, recipe]));
