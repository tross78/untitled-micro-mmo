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
        questId: 'wolf_hunt',
        baseDialogue: "Keep the peace, or I'll keep you in the cellar."
    }
};

export const QUESTS = {
    wolf_hunt: {
        name: 'Wolf Hunt',
        description: 'Cull 3 wolves at the Forest Edge.',
        target: 'forest_wolf',
        count: 3,
        reward: { xp: 50, gold: 20 }
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

export const ENEMIES = {
    forest_wolf: { name: 'Forest Wolf', hp: 20, attack: 5,  defense: 1, xp: 15, loot: ['wolf_pelt', 'potion'] },
    ruin_shade:  { name: 'Ruin Shade',  hp: 25, attack: 8,  defense: 0, xp: 25, loot: ['old_tome', 'gold', 'potion'] },
    cave_troll:  { name: 'Cave Troll',  hp: 40, attack: 10, defense: 3, xp: 40, loot: ['iron_key', 'gold', 'iron_sword'] },
};

export const ITEMS = {
    wolf_pelt:  { name: 'Wolf Pelt',     type: 'material', price: 5 },
    old_tome:   { name: 'Old Tome',      type: 'material', price: 10 },
    iron_key:   { name: 'Iron Key',      type: 'key',      price: 0 },
    gold:       { name: 'Gold (5)',       type: 'gold',       amount: 5 },
    potion:     { name: 'Health Potion', type: 'consumable',  heal: 20, price: 15 },
    ale:        { name: 'Ale',           type: 'consumable',  heal: 5,  price: 5 },
    bread:      { name: 'Loaf of Bread', type: 'consumable',  heal: 10, price: 8 },
    iron_sword: { name: 'Iron Sword',    type: 'weapon',      bonus: 3, price: 50 },
    wood:       { name: 'Wood Bundle',   type: 'material', price: 2 },
    iron:       { name: 'Iron Ore',      type: 'material', price: 10 },
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
};

export const INSTANCE_CAP = 50;

export const world = {
    cellar: {
        name: 'The Cellar',
        description: 'A damp cellar. Crates line the walls. A door leads north.',
        exits: { north: 'hallway' },
        enemy: null,
    },
    hallway: {
        name: 'The Hallway',
        description: 'A narrow passage. The cellar is south, the tavern north, the forest east.',
        exits: { south: 'cellar', north: 'tavern', east: 'forest_edge' },
        enemy: null,
    },
    tavern: {
        name: 'The Rusty Flagon',
        description: 'Smoke and low voices. The market is east, the hallway south.',
        exits: { south: 'hallway', east: 'market' },
        enemy: null,
    },
    market: {
        name: 'The Market Square',
        description: 'Stalls and haggling. The tavern is west.',
        exits: { west: 'tavern' },
        enemy: null,
    },
    forest_edge: {
        name: 'The Forest Edge',
        description: 'Twisted pines. A wolf watches from the dark. The hallway is west, ruins north, a cave south.',
        exits: { west: 'hallway', north: 'ruins', south: 'cave' },
        enemy: 'forest_wolf',
    },
    ruins: {
        name: 'The Old Ruins',
        description: 'Cold stone and shifting shadows. A shade drifts between the pillars. The forest is south.',
        exits: { south: 'forest_edge' },
        enemy: 'ruin_shade',
    },
    cave: {
        name: 'The Dark Cave',
        description: 'Low ceilings, dripping water. A cave troll blocks the passage. The forest is north.',
        exits: { north: 'forest_edge' },
        enemy: 'cave_troll',
    },
};
