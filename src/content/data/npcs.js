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
        role: 'flavor',
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
    })
};
