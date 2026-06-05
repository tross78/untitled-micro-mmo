import { defineNpc } from '../define.js';

export const NPCS = {
    barkeep: defineNpc('barkeep', {
        name: 'Barkeep',
        sprite: 'barkeep',
        palette: 'npcWarm',
        home: 'tavern', 
        role: 'shop', 
        shop: ['ale', 'bread', 'potion', 'warm_cloak'],
        baseDialogue: "Welcome to the Rusty Flagon. Stay a while, have a drink. You look like you could use a rest."
    }),
    bard: defineNpc('bard', {
        name: 'The Bard',
        sprite: 'bard',
        palette: 'npcSong',
        home: 'tavern',
        role: 'flavor',
        baseDialogue: "The old songs still carry the shape of this land. Sit a while and listen."
    }),
    merchant: defineNpc('merchant', {
        name: 'Merchant',
        sprite: 'merchant',
        palette: 'npcTrade',
        home: 'market',
        role: 'shop',
        shop: ['iron_sword', 'wood', 'iron', 'wheat'],
        baseDialogue: "Finest wares in the realm, or at least in this square."
    }),
    herbalist: defineNpc('herbalist', {
        name: 'Herbalist',
        sprite: 'herbalist',
        palette: 'npcLeaf',
        home: 'herbalist_hut',
        role: 'shop',
        shop: ['potion', 'healing_elixir', 'strength_elixir'],
        baseDialogue: "The forest provides all we need, if you know where to look."
    }),
    sage: defineNpc('sage', {
        name: 'Sage',
        sprite: 'sage',
        palette: 'npcSage',
        home: 'ruins',
        patrol: ['ruins', 'forest_edge', 'hallway'],
        role: 'quest',
        baseDialogue: "The shadows grow longer with each passing day...",
        locationDialogue: {
            ruins: "The descent to the north is no place for the unprepared. I have seen strong fighters go down and not return. Go when you are ready, not before.",
            forest_edge: "The ruins lie north of the forest. Old stones, old shadows. If you seek them, arm yourself well first.",
        },
    }),
    guard: defineNpc('guard', {
        name: 'Guard',
        sprite: 'guard',
        palette: 'npcGuard',
        home: 'hallway',
        patrol: ['hallway', 'cellar', 'tavern', 'market', 'crossroads'],
        role: 'quest',
        baseDialogue: "Keep the peace, or I'll keep you in the cellar. Head north to the tavern if you're looking for work.",
        locationDialogue: {
            forest_edge: "The depths to the east get darker and meaner the further in you go. Goblins, bandits — worse things too. I wouldn't head in there without a decent weapon and something to eat.",
        },
    }),
    cellar_guard: defineNpc('cellar_guard', {
        name: 'Guard',
        sprite: 'guard',
        palette: 'npcGuard',
        home: 'cellar',
        role: 'flavor',
        baseDialogue: "New here? Head through the door to the north. The tavern's where people find work around these parts."
    }),
    watchman: defineNpc('watchman', {
        name: 'Watchman',
        sprite: 'guard',
        palette: 'npcGuard',
        home: 'watchtower',
        role: 'flavor',
        baseDialogue: "From up here I can see smoke over the forest. The bandits have been closer than usual this season.",
        locationDialogue: {
            watchtower: "The mountain pass gets quiet before something moves through it. Keep your ears open down there.",
        },
    }),
    miller: defineNpc('miller', {
        name: 'Miller Bram',
        sprite: 'merchant',
        palette: 'npcTrade',
        home: 'mill',
        role: 'flavor',
        baseDialogue: "Grain from the crossroads, flour for the town. Same work, every day.",
        locationDialogue: {
            mill: "The wheel needs a new pin, but the smith is busy. You see anything useful out there, bring it back.",
        },
    }),
    librarian: defineNpc('librarian', {
        name: 'Archivist',
        sprite: 'sage',
        palette: 'npcSage',
        home: 'library',
        role: 'shop',
        shop: ['old_tome'],
        baseDialogue: "Knowledge is the only thing the ruins did not take.",
        locationDialogue: {
            library: "The old texts mention something below the catacombs. I do not recommend looking.",
        },
    }),
    fisherman: defineNpc('fisherman', {
        name: 'Old Fisher',
        sprite: 'bard',
        palette: 'npcSong',
        home: 'harbour',
        role: 'flavor',
        baseDialogue: "That sea cave to the south is not safe. Something lives in the tide pool.",
        locationDialogue: {
            harbour: "Best fishing is at the lake shore. Too cold here, and the smugglers make the dock unpleasant.",
        },
    }),
    grocer: defineNpc('grocer', {
        name: 'Grocer',
        sprite: 'merchant',
        palette: 'npcWarm',
        home: 'market',
        role: 'flavor',
        baseDialogue: "Turnips, onions, barley — fresh off the morning cart. Coin first, then you squeeze.",
    }),
    town_crier: defineNpc('town_crier', {
        name: 'Town Crier',
        sprite: 'bard',
        palette: 'npcSong',
        home: 'market',
        role: 'flavor',
        baseDialogue: "Hear it, hear it! The roads east run thick with wolves, and the watchtower wants able hands.",
    }),
};
