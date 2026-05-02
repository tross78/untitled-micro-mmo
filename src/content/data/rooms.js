import { defineRoom } from '../define.js';

/**
 * Open-World SNES Zelda-Style Room Definitions
 * Uses compressed string format to save bundle size (Phase 7.9.9.4)
 * Exit Format: "x,y,dest,destX,destY,type" (type: edge|door|stairs|up|down)
 * Scenery Format: "x,y,label"
 */
export const rooms = {
    cellar: defineRoom('cellar', {
        name: 'The Cellar',
        description: 'A damp cellar. Crates line the walls. A door leads north.',
        width: 10, height: 10,
        exits: { north: 'hallway' },
        exitTiles: "5,0,hallway,5,8,door",
        scenery: "2,2,📦|8,7,📦|1,8,📦",
    }),
    hallway: defineRoom('hallway', {
        name: 'The Hallway',
        description: 'A narrow passage. The cellar is south, the tavern north, the forest east, library west.',
        width: 11, height: 10,
        exits: { south: 'cellar', north: 'tavern', east: 'forest_edge', west: 'library' },
        exitTiles: "5,9,cellar,5,1,door|5,0,tavern,5,8,door|10,5,forest_edge,1,5,edge|0,5,library,9,5,edge",
        staticEntities: [{ id: 'guard', x: 2, y: 2 }],
        scenery: "4,4,🏛|6,4,🏛",
    }),
    library: defineRoom('library', {
        name: 'The Great Library',
        description: 'Dusty shelves and ancient scrolls. A quiet sanctuary of knowledge.',
        width: 11, height: 11,
        exits: { east: 'hallway' },
        exitTiles: "10,5,hallway,1,5,edge",
        scenery: "5,2,📜",
        tileOverrides: [
            { x: 3, y: 2, type: 'wall' }, { x: 3, y: 3, type: 'wall' }, { x: 3, y: 4, type: 'wall' },
            { x: 7, y: 2, type: 'wall' }, { x: 7, y: 3, type: 'wall' }, { x: 7, y: 4, type: 'wall' },
            { x: 3, y: 6, type: 'wall' }, { x: 3, y: 7, type: 'wall' }, { x: 3, y: 8, type: 'wall' },
            { x: 7, y: 6, type: 'wall' }, { x: 7, y: 7, type: 'wall' }, { x: 7, y: 8, type: 'wall' },
            { x: 5, y: 5, type: 'interior' }
        ],
    }),
    tavern: defineRoom('tavern', {
        name: 'The Rusty Flagon',
        description: 'Smoke and low voices. The market is east, the hallway south.',
        width: 12, height: 10,
        exits: { south: 'hallway', east: 'market' },
        exitTiles: "5,9,hallway,5,1,door|11,5,market,1,5,door",
        staticEntities: [{ id: 'barkeep', x: 10, y: 2 }, { id: 'bard', x: 2, y: 2 }],
        scenery: "4,4,🍺|8,4,🍺|4,6,🍺|8,6,🍺",
    }),
    market: defineRoom('market', {
        name: 'The Market Square',
        description: 'Stalls and haggling. The tavern is west, crossroads south.',
        width: 15, height: 15,
        exits: { west: 'tavern', south: 'crossroads' },
        exitTiles: "0,7,tavern,10,5,door|7,14,crossroads,5,1,edge",
        staticEntities: [{ id: 'merchant', x: 8, y: 8 }],
        scenery: "5,5,🏪|11,5,🏪|5,11,🏪|11,11,🏪|8,2,⛲",
    }),
    crossroads: defineRoom('crossroads', {
        name: 'The Crossroads',
        description: 'A hub of activity. Market north, mill west, herbalist south, frozen lake east.',
        width: 11, height: 11,
        exits: { north: 'market', west: 'mill', south: 'herbalist_hut', east: 'frozen_lake' },
        exitTiles: "5,0,market,7,13,edge|0,5,mill,9,5,edge|5,10,herbalist_hut,4,1,edge|10,5,frozen_lake,1,5,edge",
        scenery: "5,5,🪧",
    }),
    mill: defineRoom('mill', {
        name: 'The Old Mill',
        description: 'The smell of ground grain fills the air. Crossroads east.',
        width: 10, height: 10,
        exits: { east: 'crossroads' },
        exitTiles: "9,5,crossroads,1,5,edge",
        scenery: "5,5,⚙️",
    }),
    herbalist_hut: defineRoom('herbalist_hut', {
        name: "Herbalist's Hut",
        description: 'Dried herbs hang from the ceiling. Crossroads north.',
        width: 8, height: 8,
        exits: { north: 'crossroads' },
        exitTiles: "4,0,crossroads,5,9,edge",
        staticEntities: [{ id: 'herbalist', x: 4, y: 4 }],
        scenery: "2,2,🌿",
    }),
    frozen_lake: defineRoom('frozen_lake', {
        name: 'The Frozen Lake',
        description: 'A wide expanse of treacherous ice. Crossroads west.',
        width: 25, height: 10,
        exits: { west: 'crossroads' },
        exitTiles: "0,5,crossroads,9,5,edge",
        scenery: "12,5,❄️",
        tileOverrides: [{ x: 10, y: 5, type: 'water' }],
        enemy: 'skeleton', enemyX: 15, enemyY: 5
    }),
    forest_edge: defineRoom('forest_edge', {
        name: 'The Forest Edge',
        description: 'Twisted pines. A wolf watches from the dark. The hallway is west, ruins north, cave south, depths east.',
        width: 20, height: 20,
        exits: { west: 'hallway', north: 'ruins', south: 'cave', east: 'forest_depths' },
        exitTiles: "0,10,hallway,9,5,edge|10,0,ruins,10,18,edge|10,19,cave,5,1,door|19,10,forest_depths,1,12,edge",
        scenery: "3,3,🌲|15,4,🌲|5,16,🌲|17,14,🌲",
        sceneryScatter: [{ type: 'flora', label: '🍄', count: [3, 8] }, { type: 'scenery', label: '🪨', count: [1, 3] }],
        enemy: 'forest_wolf', enemyX: 12, enemyY: 5
    }),
    forest_depths: defineRoom('forest_depths', {
        name: 'The Forest Depths',
        description: 'Ancient trees block the sky. Goblins lurk in the brush. The edge is west, a lake east, a camp north, cemetery south.',
        width: 25, height: 25,
        exits: { west: 'forest_edge', east: 'lake_shore', north: 'bandit_camp', south: 'cemetery' },
        exitTiles: "0,12,forest_edge,18,10,edge|24,12,lake_shore,1,10,edge|12,0,bandit_camp,10,13,edge|12,24,cemetery,10,1,edge",
        scenery: "5,5,🌲|18,6,🌲|10,15,🌲|22,20,🌲",
        sceneryScatter: [{ type: 'flora', label: '🌿', count: [5, 12] }, { type: 'scenery', label: '🪵', count: [2, 6] }],
        enemy: 'goblin', enemyX: 15, enemyY: 15
    }),
    cemetery: defineRoom('cemetery', {
        name: 'The Ancient Cemetery',
        description: 'Weathered headstones and a lingering mist. Forest north, catacombs south.',
        width: 20, height: 20,
        exits: { north: 'forest_depths', south: 'catacombs' },
        exitTiles: "10,0,forest_depths,12,23,edge|10,19,catacombs,7,2,stairs",
        scenery: "5,5,🪦|15,15,🪦",
        enemy: 'wraith', nightOnly: true, enemyX: 10, enemyY: 10
    }),
    lake_shore: defineRoom('lake_shore', {
        name: 'The Lake Shore',
        description: 'Still water reflects the grey sky. The forest is west, mountains north, harbour east.',
        width: 20, height: 20,
        exits: { west: 'forest_depths', north: 'mountain_pass', east: 'harbour' },
        exitTiles: "0,10,forest_depths,23,12,edge|10,0,mountain_pass,10,28,edge|19,10,harbour,1,7,edge",
        scenery: "5,5,🌊|6,5,🌊",
    }),
    harbour: defineRoom('harbour', {
        name: 'The Harbour',
        description: 'Salty air and the creak of timber. Lake west, sea cave south, smuggler den hidden.',
        width: 15, height: 15,
        exits: { west: 'lake_shore', south: 'sea_cave', east: 'smuggler_den' },
        exitTiles: "0,7,lake_shore,18,10,edge|7,14,sea_cave,6,1,door|14,7,smuggler_den,1,4,door",
        staticEntities: [{ id: 'merchant', x: 10, y: 5 }], 
        scenery: "5,7,⚓",
    }),
    sea_cave: defineRoom('sea_cave', {
        name: 'The Sea Cave',
        description: 'Glistening walls and the sound of waves. Harbour north.',
        width: 12, height: 12,
        exits: { north: 'harbour' },
        exitTiles: "6,0,harbour,7,13,door",
        scenery: "3,3,🐚",
        tileOverrides: [{ x: 0, y: 0, type: 'water' }, { x: 11, y: 0, type: 'water' }, { x: 0, y: 11, type: 'water' }, { x: 11, y: 11, type: 'water' }],
        enemy: 'crab', enemyX: 6, enemyY: 6
    }),
    smuggler_den: defineRoom('smuggler_den', {
        name: "Smuggler's Den",
        description: 'A hidden cave filled with contraband. Harbour west.',
        width: 8, height: 8,
        exits: { west: 'harbour' },
        exitTiles: "0,4,harbour,13,7,door",
        staticEntities: [{ id: 'merchant', x: 4, y: 4 }],
        scenery: "2,2,📦",
    }),
    bandit_camp: defineRoom('bandit_camp', {
        name: 'The Bandit Camp',
        description: 'Tents and a guttering fire. Bandits watch the trail. The forest is south.',
        width: 15, height: 15,
        exits: { south: 'forest_depths' },
        exitTiles: "7,14,forest_depths,12,1,edge",
        scenery: "7,7,🔥",
        enemy: 'bandit', enemyX: 10, enemyY: 5
    }),
    mountain_pass: defineRoom('mountain_pass', {
        name: 'The Mountain Pass',
        description: 'Thin air and treacherous paths. A troll guards the heights. Lake south, watchtower north.',
        width: 20, height: 30,
        exits: { south: 'lake_shore', north: 'watchtower' },
        exitTiles: "10,29,lake_shore,10,1,edge|10,0,watchtower,3,18,edge",
        scenery: "5,10,🪨|15,20,🪨",
        enemy: 'mountain_troll', enemyX: 10, enemyY: 10
    }),
    watchtower: defineRoom('watchtower', {
        name: 'The Ancient Watchtower',
        description: 'A tall stone spire overlooking the realm. Pass south.',
        width: 6, height: 20,
        exits: { south: 'mountain_pass' },
        exitTiles: "3,19,mountain_pass,10,1,edge",
        staticEntities: [{ id: 'guard', x: 3, y: 3 }],
        scenery: "3,10,🪜",
    }),
    ruins: defineRoom('ruins', {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south, a descent leads north.',
        width: 20, height: 20,
        exits: { south: 'forest_edge', north: 'ruins_descent' },
        exitTiles: "10,19,forest_edge,10,1,edge|10,0,ruins_descent,5,8,stairs",
        staticEntities: [{ id: 'sage', x: 10, y: 10 }],
        scenery: "5,5,🏛|15,15,🏛",
        enemy: 'ruin_shade', enemyX: 5, enemyY: 10
    }),
    ruins_descent: defineRoom('ruins_descent', {
        name: 'The Ruins Descent',
        description: 'A crumbling staircase spiraling down into the earth. Ruins are south, catacombs down.',
        width: 10, height: 10,
        exits: { south: 'ruins', down: 'catacombs' },
        exitTiles: "5,9,ruins,10,1,stairs|5,0,catacombs,5,13,down",
        scenery: "2,5,🪜",
        enemy: 'skeleton', enemyX: 8, enemyY: 5
    }),
    catacombs: defineRoom('catacombs', {
        name: 'The Catacombs',
        description: 'Endless rows of skulls and dust. A wraith haunts the tombs. Descent up, cell north, cemetery north.',
        width: 15, height: 15,
        exits: { up: 'ruins_descent', north: 'dungeon_cell', south: 'cemetery' },
        exitTiles: "7,14,ruins_descent,5,1,up|7,0,dungeon_cell,5,8,edge|7,2,cemetery,10,18,stairs",
        scenery: "3,3,☠|12,12,☠",
        enemy: 'wraith', enemyX: 7, enemyY: 7
    }),
    dungeon_cell: defineRoom('dungeon_cell', {
        name: 'The Dungeon Cell',
        description: 'Rusty bars and straw. A skeleton rattles in the corner. Catacombs are south, a throne room east.',
        width: 10, height: 10,
        exits: { south: 'catacombs', east: 'throne_room' },
        exitTiles: "5,9,catacombs,7,1,edge|9,5,throne_room,1,5,door",
        scenery: "1,1,⛓",
        enemy: 'skeleton', enemyX: 5, enemyY: 5
    }),
    throne_room: defineRoom('throne_room', {
        name: 'The Throne Room',
        description: 'A shattered throne under a mountain of dust. Shadows dance here. The cell is west.',
        width: 15, height: 15,
        exits: { west: 'dungeon_cell' },
        exitTiles: "0,7,dungeon_cell,8,5,door",
        scenery: "7,2,👑",
        enemy: 'wraith', enemyX: 7, enemyY: 10
    }),
    cave: defineRoom('cave', {
        name: 'The Dark Cave',
        description: 'Low ceilings, dripping water. A cave troll blocks the passage. The forest is north.',
        width: 12, height: 12,
        exits: { north: 'forest_edge' },
        exitTiles: "6,0,forest_edge,10,18,door",
        scenery: "3,3,💧",
        enemy: 'cave_troll', enemyX: 6, enemyY: 6
    }),
};
