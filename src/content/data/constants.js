export const GAME_NAME = 'hearthwick';

export const ENABLE_ADS = false; // Toggle for Phase 4.4 Ads architecture

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LENGTH = 30; // days per season

export const moodMarkov = {
    'fearful': { fearful: 70, weary: 20, joyful: 10 },
    'weary':   { fearful: 20, weary: 60, joyful: 20 },
    'joyful':  { fearful: 10, weary: 20, joyful: 70 }
};

export const SCARCITY_ITEMS = ['wheat', 'wood', 'iron', 'bread', 'herbs', 'red_mushroom'];

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
    barkeep: {
        base: [
            "Welcome to the Rusty Flagon, ${playerName}. Stay a while.",
            "The ale is cold and the stories are warm tonight.",
            "I heard a traveler found something strange in the ruins.",
            "A group of goblins was spotted near the forest edge.",
            "The market is looking a bit empty these days, isn't it?",
            "Don't cause any trouble, or the Guard will have your head.",
            "We have the best bread in the three kingdoms.",
            "The Bard's songs always bring a bit of magic to this place.",
            "Watch out for the mountain trolls if you head north.",
            "The cellar is quiet, but sometimes I hear scratching.",
            "It is day ${day} of the Arbiter's count, and we are still here.",
            "My father built this tavern before the ${season} snows came.",
            "If you need work, ask around. Someone always needs a hand.",
            "The fire is warm, ${playerName}. Sit down and rest.",
            "I've seen many like you pass through these doors."
        ],
        scarcity: [
            "Prices are up. It is getting very hard to find ${scarcityItem} today.",
            "I had to water down the ale. Can't get enough ${scarcityItem}.",
            "Watch your purse. Scarcity makes thieves out of honest folks.",
            "We are rationing bread. The market has no ${scarcityItem} left.",
            "The merchants say ${scarcityItem} is completely sold out.",
            "Even the Guard is complaining about the cost of ${scarcityItem}.",
            "I miss the days when ${scarcityItem} was cheap and plentiful.",
            "Times are tough, ${playerName}. We must make do.",
            "If you have any ${scarcityItem}, you could sell it for a fortune.",
            "This ${season} has been cruel to our supply lines."
        ],
        time_night: [
            "The tavern is loud tonight. Drink up, ${playerName}.",
            "Lock the doors if you go out. The dark hides many things.",
            "Nights like this make me glad I stay behind the bar.",
            "Did you hear that howl? The forest wakes at night.",
            "Pour another round! We drink to keep the dark away.",
            "The shadows stretch long in the corners of the room.",
            "Only fools and guards are out walking the streets now.",
            "A good fire and a good ale. The best defense against the night.",
            "I've barred the cellar door. The scratching gets louder at night.",
            "Rest your weary bones, ${playerName}. Morning will come."
        ],
        post_quest_tavern_regular: [
            "Good to see a familiar face, ${playerName}!",
            "Your usual stool is waiting for you by the fire.",
            "You've been resting well. It shows in your stance.",
            "A tavern is only as good as its regulars, my friend.",
            "I saved a fresh loaf of bread just for you.",
            "The Bard was asking if you'd be coming by tonight.",
            "You know your way around here now. Feels like home, doesn't it?",
            "We need more folks like you in Hearthwick.",
            "I'll pour you a drink on the house next time.",
            "You've survived another ${season}. Let's drink to that."
        ]
    },
    merchant: {
        base: [
            "Finest wares in the realm, or at least in this square.",
            "I have iron swords that can cut through a wraith's shadow.",
            "Trade is slow with the bandits blocking the mountain pass.",
            "Looking for wood or iron? I've got plenty, for a price.",
            "A rare tome was brought in by a shade hunter recently.",
            "I'll buy your wolf pelts if they're in good condition.",
            "Don't mind the dust, these items are ancient and powerful.",
            "Gold is the only language everyone in Hearthwick speaks.",
            "I saw a dragon's scale once, but it was too expensive for me.",
            "The ruins descent is no place for an unarmed traveler.",
            "Welcome, ${playerName}. Have a look at my goods.",
            "A wise adventurer knows when to buy and when to sell.",
            "My prices are fair. Do not listen to the Barkeep's lies.",
            "The ${season} is a fine time for commerce, wouldn't you say?",
            "I trade in goods, not in gossip."
        ],
        scarcity: [
            "I cannot keep ${scarcityItem} on the shelves. It is gone in seconds.",
            "If you want ${scarcityItem}, you will have to pay the premium.",
            "Do not ask for a discount. Scarcity drives the market.",
            "The supply lines are cut. ${scarcityItem} is a rare luxury now.",
            "Even I cannot source enough ${scarcityItem} for the town.",
            "I bought the last shipment of ${scarcityItem} at double the price.",
            "This ${season} is ruining my profit margins.",
            "If you find any ${scarcityItem} out there, bring it to me.",
            "Desperate times mean desperate prices, ${playerName}.",
            "I am nearly out of stock. Buy what you can while you can."
        ],
        surplus: [
            "The market is flooded! Everything is cheap today.",
            "I have far too much ${surplusItem}. Please, take it off my hands.",
            "A surplus means bargains for you, ${playerName}. Buy now!",
            "I am practically giving ${surplusItem} away at these prices.",
            "The supply wagons finally arrived. We have plenty of ${surplusItem}.",
            "My storeroom is full of ${surplusItem}. I need to clear space.",
            "It is a good day to be a buyer in Hearthwick.",
            "Take advantage of the surplus. It will not last forever.",
            "I can offer you a fantastic deal on ${surplusItem} today.",
            "A bounty of goods! The Arbiter smiles upon us this day."
        ],
        post_quest_gather_wood: [
            "Thank you for the wood, ${playerName}. The market is warmer now.",
            "You are a reliable supplier. I like doing business with you.",
            "We have enough fuel for the ${season} because of your efforts.",
            "If you find more resources, you know who to sell them to.",
            "The fires are burning bright thanks to the wood you gathered.",
            "A merchant remembers those who help keep the stalls open.",
            "Your work is appreciated, friend. Need anything else?",
            "I have new stock if you have the coin you earned.",
            "Reliability is a rare commodity. You have it.",
            "The market thrives on trade, and you are a good trader."
        ]
    },
    sage: {
        base: [
            "The shadows grow longer with each passing day...",
            "Ancient magic still pulses beneath the catacombs.",
            "I have seen the seasons change a hundred times here.",
            "The Arbiter's seed determines the fate of our world.",
            "Beware the wraith that haunts the shattered throne room.",
            "History is written in the blood of those who fell in the cave.",
            "The light of the tavern is a beacon in this dark forest.",
            "Knowledge is the only weapon that never grows dull.",
            "The forest depths hide secrets better left undisturbed.",
            "A chill wind blows, carrying whispers of a forgotten era.",
            "You seek answers, ${playerName}. The ruins may have them.",
            "We are but dust in the wind of the Arbiter's design.",
            "The day ${day} marks a turning point, though few can see it.",
            "Do not trust the shadows in the ${season} twilight.",
            "I study the past to understand the future."
        ],
        scarcity: [
            "The lack of ${scarcityItem} is a sign. The balance is shifting.",
            "Scarcity is the earth's way of testing our resilience.",
            "When ${scarcityItem} fades, other hidden things emerge.",
            "Do not let the panic of the town distract you from the truth.",
            "The ancients knew of times like these. They built the catacombs.",
            "Hunger and want breed dark thoughts in weak minds.",
            "This ${season} will test the very foundations of Hearthwick.",
            "Observe how the people react to the loss of ${scarcityItem}.",
            "True wealth is not measured in ${scarcityItem}, but in wisdom.",
            "The cycle of plenty and famine is as old as the world."
        ],
        time_night: [
            "The stars are hidden tonight. The signs are unreadable.",
            "Darkness is merely the absence of light, yet it holds such power.",
            "The spirits of the ruins are restless when the sun falls.",
            "I hear the whispers of the past more clearly at night.",
            "Do not wander far, ${playerName}. The night is not your friend.",
            "The nocturnal creatures are waking. The forest is theirs now.",
            "I study by candlelight, seeking truths in the shadows.",
            "The Arbiter's eye sees even in the pitch black.",
            "The cold of the night seeps into my old bones.",
            "Look to the sky. The answers are written there, if you can see them."
        ],
        post_quest_ruins_survey: [
            "You have seen the ruins, ${playerName}. You know the truth.",
            "The shadows you witnessed are but a fraction of what lies below.",
            "Your survey confirmed my fears. The ancient ones stir.",
            "You are braver than most to walk among those broken stones.",
            "The knowledge you brought back is invaluable. Thank you.",
            "We must prepare for what comes next. The ruins are waking.",
            "Do not let the horrors you saw corrupt your spirit.",
            "You have taken the first step into the deep history of this place.",
            "The sage's path is lonely, but I am glad to have your help.",
            "Now you understand why I watch the ruins so closely."
        ]
    },
    guard: {
        base: [
            "Keep the peace, or I'll keep you in the cellar.",
            "I've been patrolling these hallways for twenty years.",
            "The bandits are getting bolder near the lake shore.",
            "I need a strong adventurer to cull the forest wolves.",
            "No dueling in the market square, take it to the ruins.",
            "I heard a cave troll is blocking the southern passage.",
            "The sun rises on another day of duty and honor.",
            "Watch your pack, there are thieves among the travelers.",
            "The ruins are restricted after sunset for your own safety.",
            "A goblin's mask was found near the tavern's back door.",
            "State your business, ${playerName}. I have my eye on you.",
            "We maintain order so the town can survive the ${season}.",
            "Move along if you have nothing to report.",
            "The Arbiter's law is absolute. I enforce it.",
            "It's quiet today. I prefer it when it's quiet."
        ],
        time_night: [
            "Curfew is approaching. Get to the tavern or get inside.",
            "The night watch is double-staffed. We take no chances.",
            "I can't see past my own torch in this dark.",
            "Bandits love the night. Keep your weapon drawn.",
            "The howling keeps me awake. I hate the night shift.",
            "Stand in the light where I can see you.",
            "The shadows play tricks on a guard's eyes.",
            "If you hear something in the dark, don't investigate.",
            "The gates are closed until dawn. Stay safe.",
            "A long, cold night ahead. Let's hope it's uneventful."
        ],
        season_winter: [
            "The cold makes the blade brittle. Be careful out there.",
            "Winter brings hungry wolves closer to the town borders.",
            "I can barely feel my fingers holding this halberd.",
            "The snow covers the tracks of thieves. It's frustrating.",
            "We light extra fires in the square during the winter.",
            "A harsh winter tests the strength of the town's walls.",
            "The lake is frozen solid. Things walk across it now.",
            "Stay warm, ${playerName}. The cold is a silent killer.",
            "My breath freezes in the air. I hate winter patrols.",
            "The bandits are desperate in the cold. They will attack."
        ],
        post_quest_wolf_hunt: [
            "You thinned the pack, ${playerName}. We owe you.",
            "The patrols are safer thanks to your wolf culling.",
            "I saw the pelts you brought back. Good work.",
            "You handle a weapon well. The town needs people like you.",
            "The howling has died down since your hunt.",
            "We have fewer casualties this week because of you.",
            "A reliable fighter is hard to find. You proved yourself.",
            "The woods are still dangerous, but you made a difference.",
            "I'll buy you an ale at the tavern when my shift ends.",
            "Keep your blade sharp. We might need you again."
        ]
    },
    bard: {
        base: [
            "I sing of distant shores and forgotten kings.",
            "A melody drifts through the tavern, haunting and sweet.",
            "The old songs carry truths that words alone cannot.",
            "They say music can soothe even the darkest wraith.",
            "I once played for a dragon — it wept, then slept.",
            "Every hero needs a bard to remember their deeds.",
            "The strings whisper of a world beyond the ruins.",
            "My lute has seen more battles than most swords.",
            "Coin for a song? Or a song for a coin?",
            "I have heard legends of a seed that shapes all worlds.",
            "Ah, ${playerName}! Care to hear a tale of bravery?",
            "The ${season} always inspires new melodies in my heart.",
            "Music is the only magic that everyone can understand.",
            "I am composing a ballad about day ${day}. It lacks a rhyme.",
            "Listen to the rhythm of the town. It is a song itself."
        ],
        scarcity: [
            "A sad song for a sad time. ${scarcityItem} is gone.",
            "I sing of empty plates and hollow stomachs.",
            "Scarcity makes the heart grow weary. Music helps.",
            "When ${scarcityItem} is rare, smiles are rarer still.",
            "The town's rhythm is disjointed. Panic breaks the tempo.",
            "I play softly today. The people need comfort, not noise.",
            "A ballad of famine. It is not popular, but it is true.",
            "The strings weep for the loss of our prosperity.",
            "I barter my songs for scraps when times are this hard.",
            "May the Arbiter return our plenty soon."
        ],
        time_night: [
            "The night brings out the deepest sorrows in my voice.",
            "A lullaby for the weary town. Sleep well, Hearthwick.",
            "The shadows dance to the tune of my lute.",
            "I play to drown out the howling from the forest.",
            "Music sounds sweeter when the world is quiet and dark.",
            "The tavern fires crackle in time with my strings.",
            "Night is the time for ghost stories and dark ballads.",
            "A song of the moon, cold and distant in the sky.",
            "My fingers are tired, but the night is long.",
            "Listen to the silence between the notes. That is the night."
        ],
        season_summer: [
            "A lively jig for the warm summer days!",
            "The sun shines bright, and so does my music.",
            "Summer brings travelers, and travelers bring coin.",
            "I sing of blooming fields and clear blue skies.",
            "The heat makes the strings stretch, but the tune remains.",
            "A joyful chorus to celebrate the season of plenty.",
            "Let us dance while the summer sun still holds.",
            "The lake shimmers like a polished lute in the sun.",
            "My best songs are born in the warmth of summer.",
            "Rejoice, for the harsh winter is but a memory!"
        ]
    },
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
    dailyBountyClaimed: 0,
    combatRound: 0,
    currentEnemy: null,
    actionIndex: 0,
    buffs: { rested: false, activeElixir: null },
    x: 5, y: 5, // Spatial Coordinates
    ph: null,
    visitedRooms: [],
};

export const INSTANCE_CAP = 50;
