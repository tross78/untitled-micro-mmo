import { defineRoom } from '../define.js';

export const rooms = {
    cellar: defineRoom('cellar', {
        name: 'The Cellar',
        description: 'A damp stone cellar. You can hear muffled voices through the wooden door leading north.',
        width: 10, height: 10,
        exits: {"north":"hallway"},
        exitTiles: "5,0,hallway,5,10,door",
        scenery: "1,1,barrel|7,1,barrel|1,7,crate|3,7,crate|6,7,crate|8,7,crate|8,3,crate",
        tiles: [
            'WWWW...WWW',
            'W........W',
            'W........W',
            'W........W',
            'W........W',
            'W........W',
            'W........W',
            'W........W',
            'W........W',
            'WWWWWWWWWW'
        ],
    }),

    hallway: defineRoom('hallway', {
        name: 'The Hallway',
        description: 'A stone passage. Voices drift from the tavern to the north. A guard stands watch near the crossroads east.',
        width: 11, height: 11,
        exits: {"south":"cellar","north":"tavern","east":"crossroads","west":"library","mill":"mill"},
        exitTiles: "5,10,cellar,5,0,door|5,0,tavern,6,10,door|10,5,crossroads,0,5,edge|0,5,library,10,5,edge|10,1,mill,0,5,edge",
        scenery: "2,1,torch|8,1,torch|2,9,torch|8,9,torch|4,4,pillar|6,4,pillar",
        staticEntities: [{ id: 'guard', x: 2, y: 2 }],
        tiles: [
            'WWWW...WWWW',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            '...........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'WWWW...WWWW'
        ],
    }),

    library: defineRoom('library', {
        name: 'The Great Library',
        description: 'Dusty shelves and ancient scrolls. A quiet sanctuary of knowledge. Hallway east.',
        width: 11, height: 11,
        exits: {"east":"hallway"},
        exitTiles: "10,5,hallway,0,5,edge",
        scenery: "1,1,bookshelf|7,1,bookshelf|1,7,bookshelf|7,7,bookshelf|5,1,fireplace|5,5,scroll|2,4,chair|8,4,chair|2,6,chair|8,6,chair",
        tiles: [
            'WWWWWWWWWWW',
            'W.........W',
            'W.........W',
            'W.........W',
            'W.........W',
            'W..........',
            'W.........W',
            'W.........W',
            'W.........W',
            'W.........W',
            'WWWWWWWWWWW'
        ],
    }),

    tavern: defineRoom('tavern', {
        name: 'The Rusty Flagon',
        description: 'Smoke and low voices. The market square lies to the east, and the guard stands south in the hallway.',
        width: 12, height: 11,
        exits: {"south":"hallway","east":"market"},
        exitTiles: "6,10,hallway,5,0,door|11,5,market,0,7,door",
        scenery: "6,1,counter|10,1,fireplace|3,4,table|8,4,table|3,7,table|8,7,table|2,4,chair|4,4,chair|7,4,chair|9,4,chair|2,7,chair|4,7,chair|7,7,chair|9,7,chair|1,1,barrel|1,9,barrel",
        staticEntities: [{ id: 'barkeep', x: 6, y: 2 }, { id: 'bard', x: 3, y: 2 }],
        tiles: [
            'WWWWWWWWWWWW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIII.',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WIIIIIIIIIIW',
            'WWWWW...WWWW'
        ],
    }),

    market: defineRoom('market', {
        name: 'The Market Square',
        description: 'Bustling stalls and organized haggling. The tavern is west, and the path to the forest crossroads leads south.',
        width: 15, height: 15,
        exits: {"west":"tavern","south":"crossroads"},
        exitTiles: "0,7,tavern,11,5,door|7,14,crossroads,5,0,edge",
        scenery: "7,6,well|1,2,stall|1,10,stall|11,2,stall|11,10,stall|1,1,barrel|3,1,crate|11,1,barrel|13,1,crate|3,13,barrel|11,13,crate|5,5,flower_pot|9,5,flower_pot|5,9,flower_pot|9,9,flower_pot",
        staticEntities: [{ id: 'merchant', x: 7, y: 7 }],
        tileOverrides: [
            { x: 6, y: 0, type: 'dirt' }, { x: 7, y: 0, type: 'dirt' }, { x: 8, y: 0, type: 'dirt' },
            { x: 0, y: 6, type: 'dirt' }, { x: 0, y: 7, type: 'dirt' }, { x: 0, y: 8, type: 'dirt' },
            { x: 14, y: 6, type: 'dirt' }, { x: 14, y: 7, type: 'dirt' }, { x: 14, y: 8, type: 'dirt' },
            { x: 6, y: 14, type: 'dirt' }, { x: 7, y: 14, type: 'dirt' }, { x: 8, y: 14, type: 'dirt' },
            { x: 6, y: 7, type: 'dirt' }, { x: 7, y: 7, type: 'dirt' }, { x: 8, y: 7, type: 'dirt' },
            { x: 7, y: 1, type: 'dirt' }, { x: 7, y: 2, type: 'dirt' }, { x: 7, y: 3, type: 'dirt' }, { x: 7, y: 4, type: 'dirt' }, { x: 7, y: 5, type: 'dirt' }, { x: 7, y: 6, type: 'dirt' },
            { x: 1, y: 7, type: 'dirt' }, { x: 2, y: 7, type: 'dirt' }, { x: 3, y: 7, type: 'dirt' }, { x: 4, y: 7, type: 'dirt' }, { x: 5, y: 7, type: 'dirt' }, { x: 6, y: 7, type: 'dirt' }, { x: 9, y: 7, type: 'dirt' }, { x: 10, y: 7, type: 'dirt' }, { x: 11, y: 7, type: 'dirt' }, { x: 12, y: 7, type: 'dirt' }, { x: 13, y: 7, type: 'dirt' },
            { x: 7, y: 8, type: 'dirt' }, { x: 7, y: 9, type: 'dirt' }, { x: 7, y: 10, type: 'dirt' }, { x: 7, y: 11, type: 'dirt' }, { x: 7, y: 12, type: 'dirt' }, { x: 7, y: 13, type: 'dirt' }
        ],
    }),

    crossroads: defineRoom('crossroads', {
        name: 'The Crossroads',
        description: 'A hub of activity. Market north, the herbalist south, and the forest edge east. The mill is along the western road.',
        width: 11, height: 11,
        exits: {"north":"market","west":"mill","south":"herbalist_hut","east":"forest_edge","hallway":"hallway"},
        exitTiles: "5,0,market,7,14,edge|0,5,mill,9,5,edge|5,10,herbalist_hut,5,0,edge|10,5,forest_edge,0,10,edge|0,0,hallway,10,5,edge",
        scenery: "5,5,sign|1,1,tree|8,1,tree|1,8,tree|8,8,tree",
        tileOverrides: [
            { x: 4, y: 0, type: 'dirt' }, { x: 5, y: 0, type: 'dirt' }, { x: 6, y: 0, type: 'dirt' },
            { x: 4, y: 10, type: 'dirt' }, { x: 5, y: 10, type: 'dirt' }, { x: 6, y: 10, type: 'dirt' },
            { x: 0, y: 4, type: 'dirt' }, { x: 0, y: 5, type: 'dirt' }, { x: 0, y: 6, type: 'dirt' },
            { x: 10, y: 4, type: 'dirt' }, { x: 10, y: 5, type: 'dirt' }, { x: 10, y: 6, type: 'dirt' },
            { x: 5, y: 1, type: 'dirt' }, { x: 5, y: 2, type: 'dirt' }, { x: 5, y: 3, type: 'dirt' }, { x: 5, y: 4, type: 'dirt' },
            { x: 5, y: 6, type: 'dirt' }, { x: 5, y: 7, type: 'dirt' }, { x: 5, y: 8, type: 'dirt' }, { x: 5, y: 9, type: 'dirt' },
            { x: 1, y: 5, type: 'dirt' }, { x: 2, y: 5, type: 'dirt' }, { x: 3, y: 5, type: 'dirt' }, { x: 4, y: 5, type: 'dirt' },
            { x: 6, y: 5, type: 'dirt' }, { x: 7, y: 5, type: 'dirt' }, { x: 8, y: 5, type: 'dirt' }, { x: 9, y: 5, type: 'dirt' }
        ],
    }),

    mill: defineRoom('mill', {
        name: 'The Old Mill',
        description: 'The smell of ground grain fills the air. Crossroads east, hallway west.',
        width: 10, height: 11,
        exits: {"east":"crossroads","west":"hallway"},
        exitTiles: "9,5,crossroads,0,5,edge|0,5,hallway,10,1,edge",
        scenery: "3,4,wheel|1,1,crate|2,1,crate|1,2,crate|8,1,barrel|7,1,barrel|1,7,crate|1,8,crate|7,8,barrel|8,8,barrel|4,1,torch|6,1,torch",
        tiles: [
            'WWWW...WWW',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'W.........',
            'WWWWWWWWWW'
        ],
    }),

    herbalist_hut: defineRoom('herbalist_hut', {
        name: "Herbalist's Hut",
        description: 'Dried herbs hang from the ceiling. Crossroads north.',
        width: 11, height: 11,
        exits: {"north":"crossroads"},
        exitTiles: "5,0,crossroads,5,10,edge",
        scenery: "1,4,cauldron|7,3,bookshelf|7,4,scroll|1,2,shrub|8,2,shrub|6,6,barrel|2,7,mushroom|5,7,mushroom|7,7,mushroom|2,3,table|3,5,chair",
        staticEntities: [{ id: 'herbalist', x: 5, y: 4 }],
        tileOverrides: [
            { x: 0, y: 0, type: 'wall' }, { x: 1, y: 0, type: 'wall' }, { x: 2, y: 0, type: 'wall' }, { x: 3, y: 0, type: 'wall' }, { x: 4, y: 0, type: 'wall' }, { x: 6, y: 0, type: 'wall' }, { x: 7, y: 0, type: 'wall' }, { x: 8, y: 0, type: 'wall' }, { x: 9, y: 0, type: 'wall' }, { x: 10, y: 0, type: 'wall' },
            { x: 0, y: 1, type: 'wall' }, { x: 10, y: 1, type: 'wall' },
            { x: 0, y: 10, type: 'wall' }, { x: 1, y: 10, type: 'wall' }, { x: 2, y: 10, type: 'wall' }, { x: 3, y: 10, type: 'wall' }, { x: 4, y: 10, type: 'wall' }, { x: 5, y: 10, type: 'wall' }, { x: 6, y: 10, type: 'wall' }, { x: 7, y: 10, type: 'wall' }, { x: 8, y: 10, type: 'wall' }, { x: 9, y: 10, type: 'wall' }, { x: 10, y: 10, type: 'wall' }
        ],
    }),

    forest_edge: defineRoom('forest_edge', {
        name: 'The Forest Edge',
        description: 'Twisted pines. A wolf watches from the dark. Crossroads west, ruins north, cave south, depths east.',
        width: 21, height: 21,
        exits: {"west":"crossroads","north":"ruins","south":"cave","east":"forest_depths"},
        exitTiles: "0,10,crossroads,10,5,edge|10,0,ruins,10,20,edge|10,20,cave,6,0,door|20,10,forest_depths,0,12,edge",
        scenery: "1,1,tree|15,1,tree|1,14,tree|15,14,tree|5,1,tree|12,1,tree|1,7,tree|16,6,tree|1,11,tree|16,11,tree",
        sceneryScatter: [
            { type: 'flora', label: 'herbs', count: [2, 4] },
            { type: 'flora', label: 'mushroom', count: [1, 2] }
        ],
        enemy: 'forest_wolf',
        tileOverrides: [
            { x: 9, y: 0, type: 'forest' }, { x: 10, y: 0, type: 'forest' }, { x: 11, y: 0, type: 'forest' },
            { x: 9, y: 20, type: 'forest' }, { x: 10, y: 20, type: 'forest' }, { x: 11, y: 20, type: 'forest' },
            { x: 0, y: 9, type: 'forest' }, { x: 0, y: 10, type: 'forest' }, { x: 0, y: 11, type: 'forest' },
            { x: 20, y: 9, type: 'forest' }, { x: 20, y: 10, type: 'forest' }, { x: 20, y: 11, type: 'forest' }
        ],
    }),

    forest_depths: defineRoom('forest_depths', {
        name: 'The Forest Depths',
        description: 'Ancient trees block the sky. Goblins lurk in the brush. The edge is west, a lake east, a camp north, cemetery south.',
        width: 25, height: 25,
        exits: {"west":"forest_edge","east":"lake_shore","north":"bandit_camp","south":"cemetery"},
        exitTiles: "0,12,forest_edge,20,10,edge|24,12,lake_shore,0,10,edge|12,0,bandit_camp,7,14,edge|12,24,cemetery,10,0,edge",
        terrain: { floor: 'forest', density: 20, clutter: ['tree', 'shrub', 'rock'] },
        sceneryScatter: [
            { type: 'flora', label: 'herbs', count: [3, 5] },
            { type: 'flora', label: 'mushroom', count: [2, 4] }
        ],
        enemy: 'goblin',
    }),

    bandit_camp: defineRoom('bandit_camp', {
        name: 'The Bandit Camp',
        description: 'Tents and a guttering fire. Bandits watch the trail. The forest is south.',
        width: 15, height: 15,
        exits: {"south":"forest_depths"},
        exitTiles: "7,14,forest_depths,12,0,edge",
        scenery: "7,7,torch|4,4,torch|10,4,torch|4,10,torch|10,10,torch|2,3,crate|11,3,crate|2,10,crate|11,10,crate|5,1,tree|7,2,rock",
        enemy: 'bandit',
        tileOverrides: [
            { x: 6, y: 14, type: 'dirt' }, { x: 7, y: 14, type: 'dirt' }, { x: 8, y: 14, type: 'dirt' }
        ]
    }),

    cave: defineRoom('cave', {
        name: 'The Dark Cave',
        description: 'Low ceilings, dripping water. A cave troll blocks the passage. The forest is north, sea cave south.',
        width: 13, height: 13,
        exits: {"north":"forest_edge","south":"sea_cave"},
        exitTiles: "6,0,forest_edge,10,20,door|6,12,sea_cave,6,0,door",
        scenery: "1,1,rock|10,1,rock|1,10,mushroom|10,10,mushroom|5,3,mushroom|6,3,mushroom|5,8,rock|6,8,rock",
        enemy: 'cave_troll',
        tiles: [
            'WWWWWW.WWWWWW',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W..VV...VV..W',
            'W..VV...VV..W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'WWWWWW.WWWWWW'
        ],
    }),

    lake_shore: defineRoom('lake_shore', {
        name: 'The Lake Shore',
        description: 'Still water reflects the grey sky. The forest is west, mountains north, harbour east.',
        width: 21, height: 21,
        exits: {"west":"forest_depths","north":"mountain_pass","east":"harbour"},
        exitTiles: "0,10,forest_depths,24,12,edge|10,0,mountain_pass,10,30,edge|20,10,harbour,0,7,edge",
        scenery: "1,1,tree|17,1,tree|7,1,rock|2,9,rock|2,11,rock|5,5,rock|15,5,rock|5,15,rock|15,15,rock",
        sceneryScatter: [
            { type: 'flora', label: 'herbs', count: [1, 3] }
        ],
        tileOverrides: [
            { x: 9, y: 0, type: 'sand' }, { x: 10, y: 0, type: 'sand' }, { x: 11, y: 0, type: 'sand' },
            { x: 0, y: 9, type: 'sand' }, { x: 0, y: 10, type: 'sand' }, { x: 0, y: 11, type: 'sand' },
            { x: 20, y: 9, type: 'sand' }, { x: 20, y: 10, type: 'sand' }, { x: 20, y: 11, type: 'sand' }
        ],
    }),

    harbour: defineRoom('harbour', {
        name: 'The Harbour',
        description: 'Salty air and the creak of timber. Lake west, sea cave south, smuggler den hidden east.',
        width: 15, height: 15,
        exits: {"west":"lake_shore","south":"sea_cave","east":"smuggler_den"},
        exitTiles: "0,7,lake_shore,20,10,edge|7,14,sea_cave,6,0,door|14,7,smuggler_den,0,4,door",
        scenery: "5,7,anchor|8,7,anchor|3,4,crate|10,4,crate|1,10,rock|13,10,rock",
        tiles: [
            '...............',
            '.....IIIII.....',
            '.....IIIII.....',
            '.....IIIII.....',
            '.....IIIII.....',
            '.....IIIII.....',
            '.IIIIIIIIIIIII.',
            '.IIIIIIIIIIIII.',
            '.IIIIIIIIIIIII.',
            '...............',
            '...............',
            '...............',
            '...............',
            '...............',
            '...............'
        ],
    }),

    sea_cave: defineRoom('sea_cave', {
        name: 'The Sea Cave',
        description: 'Glistening walls and the sound of waves. Harbour north, dark cave north-west.',
        width: 13, height: 13,
        exits: {"north":"harbour","cave":"cave"},
        exitTiles: "6,0,harbour,7,14,door|1,0,cave,6,12,door",
        scenery: "2,3,shell|9,3,shell|2,8,mushroom|9,8,mushroom|5,5,rock|6,5,rock|4,8,rock",
        enemy: 'crab',
        tiles: [
            'WWWWWW.WWWWWW',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'W...........W',
            'WWWWWWWWWWWWW'
        ],
    }),

    smuggler_den: defineRoom('smuggler_den', {
        name: "Smuggler's Den",
        description: 'A hidden cave filled with contraband. Harbour west.',
        width: 9, height: 9,
        exits: {"west":"harbour"},
        exitTiles: "0,4,harbour,14,7,door",
        scenery: "1,2,crate|5,2,crate|1,5,barrel|5,5,barrel",
        tiles: [
            'WWWWWWWWW',
            'W.......W',
            'W.......W',
            'W.......W',
            '.........',
            'W.......W',
            'W.......W',
            'W.......W',
            'WWWWWWWWW'
        ],
    }),

    mountain_pass: defineRoom('mountain_pass', {
        name: 'The Mountain Pass',
        description: 'Thin air and treacherous paths. A troll guards the heights. Lake south, watchtower north, frozen lake east.',
        width: 21, height: 31,
        exits: {"south":"lake_shore","north":"watchtower","east":"frozen_lake"},
        exitTiles: "10,30,lake_shore,10,0,edge|10,0,watchtower,3,20,edge|20,15,frozen_lake,0,5,edge",
        terrain: { floor: 'stone_floor', density: 12, clutter: ['rock'] },
        enemy: 'mountain_troll',
    }),

    watchtower: defineRoom('watchtower', {
        name: 'The Ancient Watchtower',
        description: 'A tall stone spire overlooking the realm. Pass south.',
        width: 7, height: 21,
        exits: {"south":"mountain_pass"},
        exitTiles: "3,20,mountain_pass,10,0,edge",
        scenery: "2,5,torch|3,10,ladder|2,15,torch",
        tiles: [
            'WWWWWWW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WSSSSSW',
            'WWW.WWW'
        ],
    }),

    frozen_lake: defineRoom('frozen_lake', {
        name: 'The Frozen Lake',
        description: 'A wide expanse of treacherous ice. Mountain pass west.',
        width: 25, height: 11,
        exits: {"west":"mountain_pass"},
        exitTiles: "0,5,mountain_pass,20,15,edge",
        scenery: "12,1,snowflake|6,8,snowflake|18,8,snowflake|1,4,rock|23,5,rock|10,2,rock|15,2,rock",
        tileOverrides: [
            { x: 5, y: 4, type: 'water' }, { x: 6, y: 4, type: 'water' }, { x: 7, y: 4, type: 'water' }, { x: 8, y: 4, type: 'water' }, { x: 9, y: 4, type: 'water' }, { x: 10, y: 4, type: 'water' }, { x: 11, y: 4, type: 'water' }, { x: 12, y: 4, type: 'water' }, { x: 13, y: 4, type: 'water' }, { x: 14, y: 4, type: 'water' }, { x: 15, y: 4, type: 'water' }, { x: 16, y: 4, type: 'water' }, { x: 17, y: 4, type: 'water' }, { x: 18, y: 4, type: 'water' },
            { x: 5, y: 5, type: 'water' }, { x: 6, y: 5, type: 'water' }, { x: 7, y: 5, type: 'water' }, { x: 8, y: 5, type: 'water' }, { x: 9, y: 5, type: 'water' }, { x: 10, y: 5, type: 'water' }, { x: 11, y: 5, type: 'water' }, { x: 12, y: 5, type: 'water' }, { x: 13, y: 5, type: 'water' }, { x: 14, y: 5, type: 'water' }, { x: 15, y: 5, type: 'water' }, { x: 16, y: 5, type: 'water' }, { x: 17, y: 5, type: 'water' }, { x: 18, y: 5, type: 'water' },
            { x: 5, y: 6, type: 'water' }, { x: 6, y: 6, type: 'water' }, { x: 7, y: 6, type: 'water' }, { x: 8, y: 6, type: 'water' }, { x: 9, y: 6, type: 'water' }, { x: 10, y: 6, type: 'water' }, { x: 11, y: 6, type: 'water' }, { x: 12, y: 6, type: 'water' }, { x: 13, y: 6, type: 'water' }, { x: 14, y: 6, type: 'water' }, { x: 15, y: 6, type: 'water' }, { x: 16, y: 6, type: 'water' }, { x: 17, y: 6, type: 'water' }, { x: 18, y: 6, type: 'water' }
        ],
    }),

    ruins: defineRoom('ruins', {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south, a descent leads north.',
        width: 21, height: 21,
        exits: {"south":"forest_edge","north":"ruins_descent"},
        exitTiles: "10,20,forest_edge,10,0,edge|10,0,ruins_descent,5,10,stairs",
        scenery: "8,7,altar|3,3,pillar|16,3,pillar|3,16,pillar|16,16,pillar|3,9,torch|16,9,torch|9,3,torch|9,16,torch|6,6,pillar|13,6,pillar|6,13,pillar|13,13,pillar",
        staticEntities: [{ id: 'sage', x: 8, y: 8 }],
        enemy: 'ruin_shade',
        tiles: [
            'WWWWWWWWWW.WWWWWWWWW',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'W..................W',
            'WWWWWWWWWW.WWWWWWWWW'
        ],
    }),

    ruins_descent: defineRoom('ruins_descent', {
        name: 'The Ruins Descent',
        description: 'A crumbling staircase spiraling down into the earth. Ruins are south, catacombs down.',
        width: 11, height: 11,
        exits: {"south":"ruins","down":"catacombs"},
        exitTiles: "5,10,ruins,10,0,stairs|5,0,catacombs,7,1,up",
        scenery: "4,4,ladder|1,1,rock|8,1,rock|1,8,torch|8,8,torch",
        tileOverrides: [
            { x: 0, y: 0, type: 'wall' }, { x: 1, y: 0, type: 'wall' }, { x: 2, y: 0, type: 'wall' }, { x: 3, y: 0, type: 'wall' }, { x: 4, y: 0, type: 'wall' }, { x: 5, y: 0, type: 'wall' }, { x: 6, y: 0, type: 'wall' }, { x: 7, y: 0, type: 'wall' }, { x: 8, y: 0, type: 'wall' }, { x: 9, y: 0, type: 'wall' }, { x: 10, y: 0, type: 'wall' },
            { x: 0, y: 1, type: 'wall' }, { x: 10, y: 1, type: 'wall' },
            { x: 0, y: 2, type: 'wall' }, { x: 10, y: 2, type: 'wall' },
            { x: 0, y: 3, type: 'wall' }, { x: 10, y: 3, type: 'wall' },
            { x: 0, y: 4, type: 'wall' }, { x: 10, y: 4, type: 'wall' },
            { x: 0, y: 5, type: 'wall' }, { x: 10, y: 5, type: 'wall' },
            { x: 0, y: 6, type: 'wall' }, { x: 10, y: 6, type: 'wall' },
            { x: 0, y: 7, type: 'wall' }, { x: 10, y: 7, type: 'wall' },
            { x: 0, y: 8, type: 'wall' }, { x: 10, y: 8, type: 'wall' },
            { x: 0, y: 9, type: 'wall' }, { x: 10, y: 9, type: 'wall' },
            { x: 0, y: 10, type: 'wall' }, { x: 1, y: 10, type: 'wall' }, { x: 2, y: 10, type: 'wall' }, { x: 3, y: 10, type: 'wall' }, { x: 4, y: 10, type: 'wall' }, { x: 6, y: 10, type: 'wall' }, { x: 7, y: 10, type: 'wall' }, { x: 8, y: 10, type: 'wall' }, { x: 9, y: 10, type: 'wall' }, { x: 10, y: 10, type: 'wall' }
        ],
    }),

    cemetery: defineRoom('cemetery', {
        name: 'The Ancient Cemetery',
        description: 'Weathered headstones and a lingering mist. The forest lies north, the catacombs south, and an old throne room waits to the east.',
        width: 21, height: 21,
        exits: {"north":"forest_depths","south":"catacombs","east":"throne_room"},
        exitTiles: "10,0,forest_depths,12,24,edge|10,20,catacombs,7,1,edge|20,10,throne_room,1,7,edge",
        terrain: { floor: 'forest', density: 10, clutter: ['grave', 'shrub'] },
        sceneryScatter: [
            { type: 'flora', label: 'mushroom', count: [1, 3] }
        ],
    }),

    catacombs: defineRoom('catacombs', {
        name: 'The Catacombs',
        description: 'Endless rows of skulls and dust. A wraith haunts the tombs. Cemetery north, ruins descent up, cell south.',
        width: 15, height: 15,
        exits: {"up":"ruins_descent","south":"dungeon_cell","north":"cemetery"},
        exitTiles: "7,0,ruins_descent,5,1,up|7,14,dungeon_cell,5,0,edge|7,1,cemetery,10,20,edge",
        scenery: "3,4,bones|10,4,bones|3,10,bones|10,10,bones|1,5,candle|1,9,candle|13,5,candle|13,9,candle|7,6,altar",
        enemy: 'wraith',
        tiles: [
            'WWWWWWW.WWWWWWW',
            'WWWWWWW.WWWWWWW',
            'WWWWWWW.WWWWWWW',
            'W.............W',
            'W..GGGGG......W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.W..W..W..W..W',
            'WWWWWWW.WWWWWWW'
        ],
    }),

    dungeon_cell: defineRoom('dungeon_cell', {
        name: 'The Dungeon Cell',
        description: 'Rusty bars and straw. A skeleton rattles in the corner. Catacombs are north, a throne room east.',
        width: 11, height: 11,
        exits: {"north":"catacombs","east":"throne_room"},
        exitTiles: "5,0,catacombs,7,14,edge|10,5,throne_room,0,7,door",
        scenery: "2,2,rock|7,2,rock|2,7,mushroom|7,7,mushroom|1,4,bed",
        enemy: 'skeleton',
        tiles: [
            'WWWWW.WWWWW',
            'W.........W',
            'W.........W',
            'W.........W',
            'W.........W',
            'W..........',
            'W.........W',
            'W.........W',
            'W.........W',
            'W.........W',
            'WWWWWWWWWWW'
        ],
    }),

    throne_room: defineRoom('throne_room', {
        name: 'The Throne Room',
        description: 'A shattered throne under a mountain of dust. Shadows dance here. The cell is west and the cemetery lies beyond the northern arch.',
        width: 15, height: 15,
        exits: {"west":"dungeon_cell","north":"cemetery"},
        exitTiles: "0,7,dungeon_cell,10,5,door|7,0,cemetery,20,10,edge",
        scenery: "6,2,crown|2,2,torch|12,2,torch|2,12,torch|12,12,torch|1,6,pillar|13,6,pillar|6,7,chair",
        tiles: [
            'WWWWWWW.WWWWWWW',
            'W....SSSSS....W',
            'W....SSSSS....W',
            'W....SSSSS....W',
            'W....SSSSS....W',
            'W.............W',
            'W.............W',
            '..............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'W.............W',
            'WWWWWWWWWWWWWWW'
        ],
    }),
};
