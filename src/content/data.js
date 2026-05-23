import { rooms } from './data/rooms.js';
export { ROOM_BIBLE } from './data/room-bible.js';

export const world = rooms;

const _spawnRoom = Object.values(rooms).find(r => r.features?.includes('spawn'));
export const SPAWN_ROOM_ID = _spawnRoom?.id ?? Object.keys(rooms)[0];
export const SPAWN_X = _spawnRoom?.width != null ? Math.floor(_spawnRoom.width / 2) : 5;
export const SPAWN_Y = _spawnRoom?.height != null ? Math.floor(_spawnRoom.height / 2) : 5;

export const roomHasFeature = (roomId, feature) =>
    rooms[roomId]?.features?.includes(feature) ?? false;

export const roomsByZone = (zone) =>
    Object.keys(rooms).filter(id => rooms[id].zone === zone);

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
    INSTANCE_CAP 
} from './data/constants.js';
export { TILE_BIBLE, SCENERY_AUTHORING_RULES, TILE_IDS, SCENERY_IDS } from './data/tile-bible.js';

export { ITEMS } from './data/items.js';
export { ENEMIES } from './data/enemies.js';
export { NPCS } from './data/npcs.js';
export { QUESTS } from './data/quests.js';
export { RECIPES } from './data/recipes.js';
