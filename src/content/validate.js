// @ts-check
import { TILE_TAXONOMY, SCENERY_SIZE_CLASSES } from '../infra/graphics-constants.js';
import { findSafeArrival } from '../rules/index.js';
import { COMPILED_ASSET_SHAPES } from '../generated/assets/compiled-assets.js';

const VALID_TILES = new Set(Object.values(TILE_TAXONOMY).flat());
const VALID_SCENERY = new Set(Object.values(SCENERY_SIZE_CLASSES).flat());
const FORAGE_LABEL_TO_ITEM = {
  herbs: 'herbs',
  mushroom: 'red_mushroom',
};

const hasDuplicateIds = (definitions) => new Set(definitions.map((entry) => entry.id)).size !== definitions.length;

export const validateContent = (defs) => {
  const { itemDefinitions, enemyDefinitions, roomDefinitions, npcDefinitions, questDefinitions, recipeDefinitions } = defs || require('./index.js');
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
  const obtainableItemSources = new Map();

  const noteSource = (itemId, source) => {
    if (!itemId) return;
    if (!obtainableItemSources.has(itemId)) obtainableItemSources.set(itemId, new Set());
    obtainableItemSources.get(itemId).add(source);
  };

  for (const enemy of enemies) {
    for (const itemId of enemy.loot || []) noteSource(String(itemId), `enemy:${enemy.id}`);
  }
  for (const npc of npcs) {
    if (!npc.sprite) {
      problems.push(`NPC "${npc.id}" is missing required sprite id`);
    } else if (!COMPILED_ASSET_SHAPES[npc.sprite]) {
      problems.push(`NPC "${npc.id}" references missing compiled sprite "${npc.sprite}"`);
    }
    for (const itemId of npc.shop || []) noteSource(String(itemId), `shop:${npc.id}`);
  }
  for (const recipe of recipes) {
    if (recipe.output) noteSource(String(recipe.output), `craft:${recipe.id}`);
  }
  for (const quest of quests) {
    if (quest.reward?.item) noteSource(String(quest.reward.item), `quest:${quest.id}`);
  }
  const getIsWalkable = (r) => (x, y) => {
    if (x < 0 || x >= r.width || y < 0 || y >= r.height) return false;
    const wall = (r.tileOverrides || []).find(t => t.x === x && t.y === y && t.type === 'wall');
    if (wall) return false;
    const scenery = (r.scenery || []).find(s => 
      x >= s.x && x < s.x + (s.w || 1) && 
      y >= s.y && y < s.y + (s.h || 1)
    );
    if (scenery) return false;
    return true;
  };

  for (const room of rooms) {
    // --- Visual Grammar Validation (Phase 8.55a) ---
    for (const to of room.tileOverrides || []) {
      if (to.type && !VALID_TILES.has(to.type)) {
        problems.push(`Room "${room.id}" uses non-canonical tile type "${to.type}"`);
      }
    }
    for (const sc of room.scenery || []) {
      if (sc.label && !VALID_SCENERY.has(sc.label)) {
        problems.push(`Room "${room.id}" uses non-canonical scenery label "${sc.label}"`);
      }
    }
    for (const scatter of room.sceneryScatter || []) {
      if (scatter.type === 'flora') {
        const itemId = FORAGE_LABEL_TO_ITEM[scatter.label];
        if (itemId) noteSource(itemId, `forage:${room.id}`);
        else problems.push(`Room "${room.id}" uses unknown forage label "${scatter.label}"`);
      }
    }

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
        const destX = exitTile.destX ?? 0;
        const destY = exitTile.destY ?? 0;
        if (!findSafeArrival(destX, destY, targetRoom.width, targetRoom.height, getIsWalkable(targetRoom))) {
          problems.push(`Room "${room.id}" exitTile to "${exitTile.dest}" has no safe landing near (${destX},${destY})`);
        }
      }
    }
    if (room.enemy && !enemyIds.has(room.enemy)) {
      problems.push(`Room "${room.id}" references missing enemy "${room.enemy}"`);
    }

    // --- Traversability Validation (Phase 8.5b complete) ---
    const isWalkable = getIsWalkable(room);

    const getReachable = (startX, startY) => {
      if (!isWalkable(startX, startY)) return new Set();
      const reachable = new Set();
      const queue = [[startX, startY]];
      reachable.add(`${startX},${startY}`);
      let head = 0;
      while (head < queue.length) {
        const [cx, cy] = queue[head++];
        for (const [dx, dy] of [[0,1], [0,-1], [1,0], [-1,0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (isWalkable(nx, ny)) {
              const key = `${nx},${ny}`;
              if (!reachable.has(key)) { reachable.add(key); queue.push([nx, ny]); }
          }
        }
      }
      return reachable;
    };

    const points = [];

    (room.exitTiles || []).forEach((et, i) => {
      for (let dx = 0; dx < (et.w || 1); dx++) {
        for (let dy = 0; dy < (et.h || 1); dy++) {
          if (isWalkable(et.x + dx, et.y + dy)) {
            points.push({ x: et.x + dx, y: et.y + dy, label: `exitTile[${i}]`, blocked: false });
          }
        }
      }
    });
    
    if (room.exits) {
      ['north', 'south', 'east', 'west'].forEach(edge => {
        const destId = room.exits[edge];
        if (!destId) return;
        const destRoom = rooms.find(r => r.id === destId);
        if (!destRoom) return;

        let lx, ly, tx, ty;
        if (edge === 'north') { lx = Math.floor(room.width / 2); ly = 0; tx = Math.min(lx, destRoom.width - 1); ty = destRoom.height - 1; }
        else if (edge === 'south') { lx = Math.floor(room.width / 2); ly = room.height - 1; tx = Math.min(lx, destRoom.width - 1); ty = 0; }
        else if (edge === 'east') { lx = room.width - 1; ly = Math.floor(room.height / 2); tx = 0; ty = Math.min(ly, destRoom.height - 1); }
        else if (edge === 'west') { lx = 0; ly = Math.floor(room.height / 2); tx = destRoom.width - 1; ty = Math.min(ly, destRoom.height - 1); }

        const safeLanding = findSafeArrival(tx, ty, destRoom.width, destRoom.height, getIsWalkable(destRoom));
        if (!safeLanding) {
          problems.push(`Room "${room.id}" ${edge} exit center landing in "${destId}" has no safe tiles`);
        } else {
          // Verify source center is at least adjacent to walkable
          let sourceSafe = findSafeArrival(lx, ly, room.width, room.height, isWalkable);
          if (!sourceSafe) problems.push(`Room "${room.id}" ${edge} exit source center is blocked`);
          else points.push({ x: sourceSafe.x, y: sourceSafe.y, label: `${edge} exit`, blocked: false });
        }
      });
    }

    (room.staticEntities || []).forEach(e => {
      points.push({ x: e.x, y: e.y, label: `Entity "${e.id}"`, interact: true, blocked: false });
    });

    if (points.length > 1) {
      const firstValid = points.find(p => !p.interact && !p.blocked && isWalkable(p.x, p.y));
      const reachable = firstValid ? getReachable(firstValid.x, firstValid.y) : new Set();

      if (reachable.size === 0 && points.some(p => !p.blocked)) {
          problems.push(`Room "${room.id}" has points but none are reachable from each other`);
      } else {
          for (const p of points) {
            let ok = p.blocked === false && reachable.has(`${p.x},${p.y}`);
            if (!ok && p.interact) {
              for (const [dx, dy] of [[0,1], [0,-1], [1,0], [-1,0]]) {
                  if (reachable.has(`${p.x + dx},${p.y + dy}`)) { ok = true; break; }
              }
            }
            if (!ok) problems.push(`Room "${room.id}": ${p.label} is unreachable`);
          }
      }
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
    if (quest.objective?.type === 'fetch' && itemIds.has(String(quest.objective.target)) && !obtainableItemSources.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" targets item "${quest.objective.target}" but no acquisition source is defined`);
    }
    if (quest.objective?.type === 'craft' && !recipes.find((recipe) => recipe.output === quest.objective.target || recipe.id === quest.objective.target)) {
      problems.push(`Quest "${quest.id}" targets craft item "${quest.objective.target}" but no matching recipe exists`);
    }
    if (quest.objective?.type === 'deliver' && !itemIds.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" references missing delivery item "${quest.objective.target}"`);
    }
    if (quest.objective?.type === 'deliver' && itemIds.has(String(quest.objective.target)) && !obtainableItemSources.has(String(quest.objective.target))) {
      problems.push(`Quest "${quest.id}" delivers item "${quest.objective.target}" but no acquisition source is defined`);
    }
    if (quest.objective?.type === 'talk' && !npcs.find((npc) => npc.id === quest.objective.target)) {
      problems.push(`Quest "${quest.id}" references missing NPC target "${quest.objective.target}"`);
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
