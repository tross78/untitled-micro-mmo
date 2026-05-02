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
    ph: null,
};

export const INSTANCE_CAP = 50;
