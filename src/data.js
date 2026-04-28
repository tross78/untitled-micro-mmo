/**
 * Hearthwick Game Data
 */

export const GAME_NAME = 'hearthwick';

export const ENABLE_ADS = false; // Toggle for Phase 4.4 Ads architecture

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LENGTH = 30; // days per season

export const moodMarkov = {
    'fearful': { fearful: 70, weary: 20, joyful: 10 },
    'weary':   { fearful: 20, weary: 60, joyful: 20 },
    'joyful':  { fearful: 10, weary: 20, joyful: 70 }
};

export const SCARCITY_ITEMS = ['wheat', 'medicine', 'wood', 'iron', 'bread', 'cloth'];

export const MOOD_INITIAL = 'weary';

export const NPCS = {
    barkeep: { 
        name: 'Barkeep', 
        home: 'tavern', 
        role: 'shop', 
        shop: ['ale', 'bread', 'potion'],
        baseDialogue: "Welcome to the Rusty Flagon. Stay a while, have a drink."
    },
    bard: {
        name: 'The Bard',
        home: 'tavern',
        role: 'flavor',
        baseDialogue: "I sing of other worlds... would you like to hear a /vision?"
    },
    merchant: { 
        name: 'Merchant', 
        home: 'market', 
        role: 'shop', 
        shop: ['iron_sword', 'wood', 'iron'],
        baseDialogue: "Finest wares in the realm, or at least in this square."
    },
    sage: { 
        name: 'Sage', 
        home: 'ruins', 
        patrol: ['ruins', 'forest_edge', 'hallway'], 
        role: 'flavor', 
        baseDialogue: "The shadows grow longer with each passing day..."
    },
    guard: {
        name: 'Guard',
        home: 'hallway',
        patrol: ['hallway', 'cellar', 'tavern', 'market'],
        role: 'quest',
        baseDialogue: "Keep the peace, or I'll keep you in the cellar."
    }
};

export const QUESTS = {
    // The Militia Chain (Guard)
    find_tavern: {
        id: 'find_tavern', name: 'Find the Tavern', giver: 'guard', receiver: null, type: 'explore',
        description: 'Head to the Rusty Flagon Tavern.', lore: 'The Guard suggests getting your bearings at the local watering hole.',
        objective: { type: 'explore', target: 'tavern' }, prerequisite: null,
        reward: { xp: 10, gold: 0, item: 'potion' }, chain: 'militia'
    },
    wolf_hunt: {
        id: 'wolf_hunt', name: 'Wolf Hunt', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Cull 3 wolves from the Forest Edge.', lore: 'The Guard grumbles about wolf attacks on travelers.',
        objective: { type: 'kill', target: 'forest_wolf', count: 3 }, prerequisite: 'find_tavern',
        reward: { xp: 50, gold: 20 }, chain: 'militia'
    },
    bandit_sweep: {
        id: 'bandit_sweep', name: 'Bandit Sweep', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Slay 5 bandits at the Bandit Camp.', lore: 'The Guard needs the roads cleared of bandit filth.',
        objective: { type: 'kill', target: 'bandit', count: 5 }, prerequisite: 'wolf_hunt',
        reward: { xp: 100, gold: 40, item: 'bandit_mask' }, chain: 'militia'
    },
    cave_troll_bounty: {
        id: 'cave_troll_bounty', name: 'Cave Troll Bounty', giver: 'guard', receiver: 'guard', type: 'kill',
        description: 'Slay the Cave Troll.', lore: 'A massive troll is blocking the southern passage.',
        objective: { type: 'kill', target: 'cave_troll', count: 1 }, prerequisite: 'bandit_sweep',
        reward: { xp: 150, gold: 50, item: 'iron_armor' }, chain: 'militia'
    },
    // The Scholar Chain (Sage)
    ruins_survey: {
        id: 'ruins_survey', name: 'Ruins Survey', giver: 'sage', receiver: 'sage', type: 'explore',
        description: 'Visit the Old Ruins.', lore: 'The Sage wants to know if the shadows are moving.',
        objective: { type: 'explore', target: 'ruins' }, prerequisite: null,
        reward: { xp: 20, gold: 0, item: 'old_tome' }, chain: 'scholar'
    },
    tome_collection: {
        id: 'tome_collection', name: 'Tome Collection', giver: 'sage', receiver: 'sage', type: 'fetch',
        description: 'Bring 2 old tomes to the Sage.', lore: 'Knowledge is scattered among the dust of the ruins.',
        objective: { type: 'fetch', target: 'old_tome', count: 2 }, prerequisite: 'ruins_survey',
        reward: { xp: 60, gold: 0, item: 'magic_staff' }, chain: 'scholar'
    },
    catacomb_delve: {
        id: 'catacomb_delve', name: 'Catacomb Delve', giver: 'sage', receiver: 'sage', type: 'explore',
        description: 'Reach the Catacombs.', lore: 'The deeper ruins hold secrets from a forgotten age.',
        objective: { type: 'explore', target: 'catacombs' }, prerequisite: 'tome_collection',
        reward: { xp: 80, gold: 30 }, chain: 'scholar'
    },
    wraith_banish: {
        id: 'wraith_banish', name: 'Wraith Banishment', giver: 'sage', receiver: 'sage', type: 'kill',
        description: 'Banish the Wraith in the Catacombs.', lore: 'A powerful spirit guards the lowest depths.',
        objective: { type: 'kill', target: 'wraith', count: 1 }, prerequisite: 'catacomb_delve',
        reward: { xp: 200, gold: 50 }, chain: 'scholar'
    },
    // The Trade Chain (Merchant)
    gather_wood: {
        id: 'gather_wood', name: 'Gather Wood', giver: 'merchant', receiver: 'merchant', type: 'fetch',
        description: 'Gather 5 wood bundles.', lore: 'The Market needs fuel for the coming season.',
        objective: { type: 'fetch', target: 'wood', count: 5 }, prerequisite: null,
        reward: { xp: 25, gold: 15 }, chain: 'trade'
    },
    iron_supply: {
        id: 'iron_supply', name: 'Iron Supply', giver: 'merchant', receiver: 'merchant', type: 'fetch',
        description: 'Gather 3 iron ore.', lore: 'We need raw materials for new tools and weapons.',
        objective: { type: 'fetch', target: 'iron', count: 3 }, prerequisite: 'gather_wood',
        reward: { xp: 35, gold: 20 }, chain: 'trade'
    },
    craft_sword: {
        id: 'craft_sword', name: 'Sword Crafting', giver: 'merchant', receiver: 'merchant', type: 'craft',
        description: 'Craft an iron sword at the Market.', lore: 'It is time you learned to forge your own path.',
        objective: { type: 'craft', target: 'iron_sword', count: 1 }, prerequisite: 'iron_supply',
        reward: { xp: 50, gold: 0, item: 'iron_sword' }, chain: 'trade'
    },
    market_recovery: {
        id: 'market_recovery', name: 'Market Recovery', giver: 'merchant', receiver: 'merchant', type: 'deliver',
        description: 'Sell 3 items to the Merchant.', lore: 'Keep the trade flowing in Hearthwick.',
        objective: { type: 'deliver', target: 'merchant', count: 3 }, prerequisite: 'craft_sword',
        reward: { xp: 40, gold: 25 }, chain: 'trade'
    },
    // Barkeep's Requests
    tavern_regular: {
        id: 'tavern_regular', name: 'Tavern Regular', giver: 'barkeep', receiver: 'barkeep', type: 'rest',
        description: 'Rest at the Tavern 3 separate days.', lore: 'A good adventurer knows the value of a warm bed.',
        objective: { type: 'rest', count: 3 }, prerequisite: null,
        reward: { xp: 20, gold: 0, item: 'ale' }, chain: 'barkeep'
    },
    courier_run: {
        id: 'courier_run', name: 'Courier Run', giver: 'barkeep', receiver: 'sage', type: 'deliver',
        description: 'Bring an ale to the Sage at the Ruins.', lore: 'The Sage hasn\'t visited in days. Bring him some cheer.',
        objective: { type: 'deliver', target: 'ale', count: 1 }, prerequisite: null,
        reward: { xp: 30, gold: 0, item: 'potion' }, chain: 'barkeep'
    },
    mountain_trial: {
        id: 'mountain_trial', name: 'Mountain Trial', giver: 'barkeep', receiver: 'barkeep', type: 'kill',
        description: 'Reach the Mountain Pass and survive a Mountain Troll.', lore: 'Only the bravest dare the northern heights.',
        objective: { type: 'kill', target: 'mountain_troll', count: 1 }, prerequisite: 'cave_troll_bounty',
        reward: { xp: 300, gold: 75, item: 'steel_sword' }, chain: 'barkeep'
    }
};

export const DIALOGUE_POOLS = {
    fearful: [
        "Did you hear that? Something is coming...",
        "I've double-locked my doors tonight.",
        "The light feels thinner than usual."
    ],
    weary: [
        "Another day, another struggle.",
        "My bones ache with the coming season.",
        "A bit of rest would do us all good."
    ],
    joyful: [
        "A fine day for an adventure!",
        "The air smells of spring and hope.",
        "We shall prevail against the darkness!"
    ]
};

export const CORPORA = {
    barkeep: [
        "Welcome to the Rusty Flagon. Stay a while, have a drink.",
        "The ale is cold and the stories are warm tonight.",
        "I heard a traveler found something strange in the ruins.",
        "A group of goblins was spotted near the forest edge.",
        "The market is looking a bit empty these days, isn't it?",
        "Don't cause any trouble, or the Guard will have your head.",
        "We have the best bread in the three kingdoms.",
        "The Bard's songs always bring a bit of magic to this place.",
        "Watch out for the mountain trolls if you head north.",
        "The cellar is quiet, but sometimes I hear scratching."
    ],
    merchant: [
        "Finest wares in the realm, or at least in this square.",
        "I have iron swords that can cut through a wraith's shadow.",
        "Trade is slow with the bandits blocking the mountain pass.",
        "Looking for wood or iron? I've got plenty, for a price.",
        "A rare tome was brought in by a shade hunter recently.",
        "I'll buy your wolf pelts if they're in good condition.",
        "Don't mind the dust, these items are ancient and powerful.",
        "Gold is the only language everyone in Hearthwick speaks.",
        "I saw a dragon's scale once, but it was too expensive for me.",
        "The ruins descent is no place for an unarmed traveler."
    ],
    sage: [
        "The shadows grow longer with each passing day...",
        "Ancient magic still pulses beneath the catacombs.",
        "I have seen the seasons change a hundred times here.",
        "The Arbiter's seed determines the fate of our world.",
        "Beware the wraith that haunts the shattered throne room.",
        "History is written in the blood of those who fell in the cave.",
        "The light of the tavern is a beacon in this dark forest.",
        "Knowledge is the only weapon that never grows dull.",
        "The forest depths hide secrets better left undisturbed.",
        "A chill wind blows, carrying whispers of a forgotten era."
    ],
    guard: [
        "Keep the peace, or I'll keep you in the cellar.",
        "I've been patrolling these hallways for twenty years.",
        "The bandits are getting bolder near the lake shore.",
        "I need a strong adventurer to cull the forest wolves.",
        "No dueling in the market square, take it to the ruins.",
        "I heard a cave troll is blocking the southern passage.",
        "The sun rises on another day of duty and honor.",
        "Watch your pack, there are thieves among the travelers.",
        "The ruins are restricted after sunset for your own safety.",
        "A goblin's mask was found near the tavern's back door."
    ],
    bard: [
        "I sing of distant shores and forgotten kings.",
        "A melody drifts through the tavern, haunting and sweet.",
        "The old songs carry truths that words alone cannot.",
        "They say music can soothe even the darkest wraith.",
        "I once played for a dragon — it wept, then slept.",
        "Every hero needs a bard to remember their deeds.",
        "The strings whisper of a world beyond the ruins.",
        "My lute has seen more battles than most swords.",
        "Coin for a song? Or a song for a coin?",
        "I have heard legends of a seed that shapes all worlds."
    ],
    ticker: [
        "A chill wind blows from the North...",
        "Someone drops a glass in the Rusty Flagon.",
        "A wolf howls in the distance, echoing through the trees.",
        "The smell of fresh bread wafts from the market square.",
        "A shadow flickers briefly at the edge of the ruins.",
        "The Arbiter's clock ticks steadily toward the next day.",
        "A traveler arrives with tales of a distant mountain pass.",
        "The lake shore is calm, reflecting the grey sky.",
        "Leaves rustle in the forest depths as if something moves.",
        "A golden coin glints in the dust of the hallway."
    ]
};

export const ENEMIES = {
    forest_wolf: { name: 'Forest Wolf', hp: 20, attack: 5,  defense: 1, xp: 15, loot: ['wolf_pelt', 'potion'], color: '#aaa' },
    ruin_shade:  { name: 'Ruin Shade',  hp: 25, attack: 8,  defense: 0, xp: 25, loot: ['old_tome', 'gold', 'potion'], color: '#0af' },
    cave_troll:  { name: 'Cave Troll',  hp: 40, attack: 10, defense: 3, xp: 40, loot: ['iron_key', 'gold', 'iron_sword'], color: '#f0f' },
    bandit:         { name: 'Bandit',         hp: 35, attack: 12, defense: 2, xp: 50, loot: ['bandit_mask', 'gold', 'potion'], color: '#aaa' },
    goblin:         { name: 'Goblin',         hp: 30, attack: 9,  defense: 1, xp: 35, loot: ['gold', 'potion'], color: '#aaa' },
    skeleton:       { name: 'Skeleton',       hp: 45, attack: 15, defense: 5, xp: 75, loot: ['old_tome', 'gold'], color: '#0af' },
    wraith:         { name: 'Wraith',         hp: 60, attack: 20, defense: 0, xp: 120, loot: ['old_tome', 'magic_staff'], color: '#f0f' },
    mountain_troll: { name: 'Mountain Troll', hp: 100, attack: 25, defense: 10, xp: 250, loot: ['iron_key', 'gold', 'steel_sword'], color: '#ff0' },
};

export const ITEMS = {
    wolf_pelt:      { name: 'Wolf Pelt',      type: 'material', price: 5, color: '#aaa' },
    old_tome:       { name: 'Old Tome',       type: 'material', price: 10, color: '#0af' },
    iron_key:       { name: 'Iron Key',       type: 'key',      price: 0, color: '#ff0' },
    gold:           { name: 'Gold (5)',       type: 'gold',       amount: 5, color: '#ff0' },
    potion:         { name: 'Health Potion',  type: 'consumable',  heal: 20, price: 15, color: '#0f0' },
    ale:            { name: 'Ale',            type: 'consumable',  heal: 5,  price: 5, color: '#aaa' },
    bread:          { name: 'Loaf of Bread',  type: 'consumable',  heal: 10, price: 8, color: '#aaa' },
    iron_sword:     { name: 'Iron Sword',     type: 'weapon',      bonus: 3, price: 50, color: '#aaa' },
    steel_sword:    { name: 'Steel Sword',    type: 'weapon',      bonus: 6, price: 150, color: '#0af' },
    magic_staff:    { name: 'Magic Staff',    type: 'weapon',      bonus: 8, price: 300, color: '#f0f' },
    healing_elixir: { name: 'Healing Elixir', type: 'consumable',  heal: 50, price: 40, color: '#0f0' },
    strength_elixir: { name: 'Strength Elixir', type: 'buff',      atkBonus: 5, price: 60, color: '#fa0' },
    bandit_mask:    { name: 'Bandit Mask',    type: 'material',    price: 25, color: '#aaa' },
    wood:           { name: 'Wood Bundle',    type: 'material', price: 2, color: '#aaa' },
    iron:           { name: 'Iron Ore',       type: 'material', price: 10, color: '#aaa' },
    leather_armor:  { name: 'Leather Armor',  type: 'armor',    bonus: 2,  price: 15,  color: '#8b4513' },
    iron_armor:     { name: 'Iron Armor',     type: 'armor',    bonus: 4,  price: 60,  color: '#aaa' },
    warm_cloak:     { name: 'Warm Cloak',     type: 'armor',    bonus: 1,  price: 8,   color: '#a52a2a' },
};

export const DEFAULT_PLAYER_STATS = {
    hp: 50, maxHp: 50,
    attack: 10, defense: 3,
    xp: 0, level: 1,
    gold: 0, bankedGold: 0,
    inventory: [],
    quests: {}, // id -> { progress, completed }
    forestFights: 15, // L.O.R.D style daily limit
    combatRound: 0,
    currentEnemy: null,
    actionIndex: 0,
    buffs: { rested: false, activeElixir: null },
    x: 5, y: 5, // Spatial Coordinates
};

export const INSTANCE_CAP = 50;

export const RECIPES = [
    { id: 'iron_sword', name: 'Iron Sword', inputs: { wood: 1, iron: 2 }, output: 'iron_sword', location: 'market' },
    { id: 'steel_sword', name: 'Steel Sword', inputs: { iron: 3, wood: 2 }, output: 'steel_sword', location: 'market' },
    { id: 'leather_armor', name: 'Leather Armor', inputs: { wolf_pelt: 3 }, output: 'leather_armor', location: 'market' },
];

export const world = {
    cellar: {
        name: 'The Cellar',
        description: 'A damp cellar. Crates line the walls. A door leads north.',
        width: 10, height: 10,
        exits: { north: 'hallway' },
        exitTiles: [{ x: 5, y: 0, dest: 'hallway', destX: 5, destY: 8 }],
        staticEntities: [],
        scenery: [{ x: 2, y: 2, label: 'C' }, { x: 8, y: 7, label: 'C' }, { x: 1, y: 8, label: 'C' }],
        enemy: null,
    },
    hallway: {
        name: 'The Hallway',
        description: 'A narrow passage. The cellar is south, the tavern north, the forest east.',
        width: 11, height: 10,
        exits: { south: 'cellar', north: 'tavern', east: 'forest_edge' },
        exitTiles: [
            { x: 5, y: 9, dest: 'cellar', destX: 5, destY: 1 },
            { x: 5, y: 0, dest: 'tavern', destX: 5, destY: 8 },
            { x: 10, y: 5, dest: 'forest_edge', destX: 1, destY: 5 },
        ],
        staticEntities: [{ id: 'guard', x: 2, y: 2 }],
        scenery: [{ x: 4, y: 4, label: 'P' }, { x: 6, y: 4, label: 'P' }],
        enemy: null,
    },
    tavern: {
        name: 'The Rusty Flagon',
        description: 'Smoke and low voices. The market is east, the hallway south.',
        width: 12, height: 10,
        exits: { south: 'hallway', east: 'market' },
        exitTiles: [
            { x: 5, y: 9, dest: 'hallway', destX: 5, destY: 1 },
            { x: 11, y: 5, dest: 'market', destX: 1, destY: 5 },
        ],
        staticEntities: [
            { id: 'barkeep', x: 10, y: 2 },
            { id: 'bard', x: 2, y: 2 }
        ],
        scenery: [
            { x: 4, y: 4, label: 'T' }, { x: 8, y: 4, label: 'T' },
            { x: 4, y: 6, label: 'T' }, { x: 8, y: 6, label: 'T' }
        ],
        enemy: null,
    },
    market: {
        name: 'The Market Square',
        description: 'Stalls and haggling. The tavern is west.',
        width: 15, height: 15,
        exits: { west: 'tavern' },
        exitTiles: [{ x: 0, y: 7, dest: 'tavern', destX: 10, destY: 5 }],
        staticEntities: [{ id: 'merchant', x: 8, y: 8 }],
        scenery: [
            { x: 5, y: 5, label: 'S' }, { x: 11, y: 5, label: 'S' },
            { x: 5, y: 11, label: 'S' }, { x: 11, y: 11, label: 'S' },
            { x: 8, y: 2, label: 'F' }
        ],
        enemy: null,
    },
    forest_edge: {
        name: 'The Forest Edge',
        description: 'Twisted pines. A wolf watches from the dark. The hallway is west, ruins north, cave south, depths east.',
        width: 20, height: 20,
        exits: { west: 'hallway', north: 'ruins', south: 'cave', east: 'forest_depths' },
        exitTiles: [
            { x: 0, y: 10, dest: 'hallway', destX: 9, destY: 5 },
            { x: 10, y: 0, dest: 'ruins', destX: 10, destY: 18 },
            { x: 10, y: 19, dest: 'cave', destX: 5, destY: 1 },
            { x: 19, y: 10, dest: 'forest_depths', destX: 1, destY: 10 },
        ],
        staticEntities: [],
        scenery: [
            { x: 3, y: 3, label: 't' }, { x: 15, y: 4, label: 't' },
            { x: 5, y: 16, label: 't' }, { x: 17, y: 14, label: 't' }
        ],
        enemy: 'forest_wolf',
        enemyX: 12, enemyY: 5
    },
    forest_depths: {
        name: 'The Forest Depths',
        description: 'Ancient trees block the sky. Goblins lurk in the brush. The edge is west, a lake east, a camp north.',
        width: 25, height: 25,
        exits: { west: 'forest_edge', east: 'lake_shore', north: 'bandit_camp' },
        exitTiles: [
            { x: 0, y: 12, dest: 'forest_edge', destX: 18, destY: 10 },
            { x: 24, y: 12, dest: 'lake_shore', destX: 1, destY: 10 },
            { x: 12, y: 0, dest: 'bandit_camp', destX: 10, destY: 18 },
        ],
        staticEntities: [],
        scenery: [
            { x: 5, y: 5, label: 't' }, { x: 18, y: 6, label: 't' },
            { x: 10, y: 15, label: 't' }, { x: 22, y: 20, label: 't' }
        ],
        enemy: 'goblin',
        enemyX: 15, enemyY: 15
    },
    lake_shore: {
        name: 'The Lake Shore',
        description: 'Still water reflects the grey sky. The forest is west, mountains rise to the north.',
        width: 20, height: 20,
        exits: { west: 'forest_depths', north: 'mountain_pass' },
        exitTiles: [
            { x: 0, y: 10, dest: 'forest_depths', destX: 23, destY: 12 },
            { x: 10, y: 0, dest: 'mountain_pass', destX: 10, destY: 18 },
        ],
        staticEntities: [],
        scenery: [{ x: 5, y: 5, label: 'w' }, { x: 6, y: 5, label: 'w' }],
        enemy: null,
    },
    bandit_camp: {
        name: 'The Bandit Camp',
        description: 'Tents and a guttering fire. Bandits watch the trail. The forest is south.',
        width: 15, height: 15,
        exits: { south: 'forest_depths' },
        exitTiles: [{ x: 7, y: 14, dest: 'forest_depths', destX: 12, destY: 1 }],
        staticEntities: [],
        scenery: [{ x: 7, y: 7, label: 'F' }], // Fire
        enemy: 'bandit',
        enemyX: 10, enemyY: 5
    },
    mountain_pass: {
        name: 'The Mountain Pass',
        description: 'Thin air and treacherous paths. A troll guards the heights. The lake is south.',
        width: 20, height: 30,
        exits: { south: 'lake_shore' },
        exitTiles: [{ x: 10, y: 29, dest: 'lake_shore', destX: 10, destY: 1 }],
        staticEntities: [],
        scenery: [{ x: 5, y: 10, label: 'R' }, { x: 15, y: 20, label: 'R' }], // Rocks
        enemy: 'mountain_troll',
        enemyX: 10, enemyY: 10
    },
    ruins: {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south, a descent leads north.',
        width: 20, height: 20,
        exits: { south: 'forest_edge', north: 'ruins_descent' },
        exitTiles: [
            { x: 10, y: 19, dest: 'forest_edge', destX: 10, destY: 1 },
            { x: 10, y: 0, dest: 'ruins_descent', destX: 5, destY: 8 },
        ],
        staticEntities: [{ id: 'sage', x: 10, y: 10 }],
        scenery: [{ x: 5, y: 5, label: 'P' }, { x: 15, y: 15, label: 'P' }],
        enemy: 'ruin_shade',
        enemyX: 5, enemyY: 10
    },
    ruins_descent: {
        name: 'The Ruins Descent',
        description: 'A crumbling staircase spiraling down into the earth. Ruins are south, catacombs down.',
        width: 10, height: 10,
        exits: { south: 'ruins', down: 'catacombs' },
        exitTiles: [
            { x: 5, y: 9, dest: 'ruins', destX: 10, destY: 1 },
            { x: 5, y: 0, dest: 'catacombs', destX: 5, destY: 13, type: 'down' },
        ],
        staticEntities: [],
        scenery: [{ x: 2, y: 5, label: 'S' }],
        enemy: 'skeleton',
        enemyX: 8, enemyY: 5
    },
    catacombs: {
        name: 'The Catacombs',
        description: 'Endless rows of skulls and dust. A wraith haunts the tombs. Descent is up, a cell north.',
        width: 15, height: 15,
        exits: { up: 'ruins_descent', north: 'dungeon_cell' },
        exitTiles: [
            { x: 7, y: 14, dest: 'ruins_descent', destX: 5, destY: 1, type: 'up' },
            { x: 7, y: 0, dest: 'dungeon_cell', destX: 5, destY: 8 },
        ],
        staticEntities: [],
        scenery: [{ x: 3, y: 3, label: 'X' }, { x: 12, y: 12, label: 'X' }], // Tombs
        enemy: 'wraith',
        enemyX: 7, enemyY: 7
    },
    dungeon_cell: {
        name: 'The Dungeon Cell',
        description: 'Rusty bars and straw. A skeleton rattles in the corner. Catacombs are south, a throne room east.',
        width: 10, height: 10,
        exits: { south: 'catacombs', east: 'throne_room' },
        exitTiles: [
            { x: 5, y: 9, dest: 'catacombs', destX: 7, destY: 1 },
            { x: 9, y: 5, dest: 'throne_room', destX: 1, destY: 5 },
        ],
        staticEntities: [],
        scenery: [{ x: 1, y: 1, label: '#' }],
        enemy: 'skeleton',
        enemyX: 5, enemyY: 5
    },
    throne_room: {
        name: 'The Throne Room',
        description: 'A shattered throne under a mountain of dust. Shadows dance here. The cell is west.',
        width: 15, height: 15,
        exits: { west: 'dungeon_cell' },
        exitTiles: [{ x: 0, y: 7, dest: 'dungeon_cell', destX: 8, destY: 5 }],
        staticEntities: [],
        scenery: [{ x: 7, y: 2, label: 'H' }], // Throne
        enemy: 'wraith',
        enemyX: 7, enemyY: 10
    },
    cave: {
        name: 'The Dark Cave',
        description: 'Low ceilings, dripping water. A cave troll blocks the passage. The forest is north.',
        width: 12, height: 12,
        exits: { north: 'forest_edge' },
        exitTiles: [{ x: 6, y: 0, dest: 'forest_edge', destX: 10, destY: 18 }],
        staticEntities: [],
        scenery: [{ x: 3, y: 3, label: '*' }], // Stalactite
        enemy: 'cave_troll',
        enemyX: 6, enemyY: 6
    },
};
