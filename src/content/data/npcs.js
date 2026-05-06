import { defineNpc } from '../define.js';

export const NPCS = {
    barkeep: defineNpc('barkeep', { 
        name: 'Barkeep', 
        sprite: 'barkeep',
        palette: 'npcWarm',
        home: 'tavern', 
        role: 'shop', 
        shop: ['ale', 'bread', 'potion'],
        baseDialogue: "Welcome to the Rusty Flagon. Stay a while, have a drink. You look like you could use a rest."
    }),
    bard: defineNpc('bard', {
        name: 'The Bard',
        sprite: 'guard',
        palette: 'npcSong',
        home: 'tavern',
        role: 'flavor',
        baseDialogue: "The old songs still carry the shape of this land. Sit a while and listen."
    }),
    merchant: defineNpc('merchant', { 
        name: 'Merchant', 
        sprite: 'guard',
        palette: 'npcTrade',
        home: 'market', 
        role: 'shop', 
        shop: ['iron_sword', 'wood', 'iron', 'wheat'],
        baseDialogue: "Finest wares in the realm, or at least in this square."
    }),
    herbalist: defineNpc('herbalist', {
        name: 'Herbalist',
        sprite: 'guard',
        palette: 'npcLeaf',
        home: 'herbalist_hut',
        role: 'shop',
        shop: ['potion', 'healing_elixir', 'strength_elixir'],
        baseDialogue: "The forest provides all we need, if you know where to look."
    }),
    sage: defineNpc('sage', { 
        name: 'Sage', 
        sprite: 'guard',
        palette: 'npcSage',
        home: 'ruins', 
        patrol: ['ruins', 'forest_edge', 'hallway'], 
        role: 'flavor', 
        baseDialogue: "The shadows grow longer with each passing day..."
    }),
    guard: defineNpc('guard', {
        name: 'Guard',
        sprite: 'guard',
        palette: 'npcGuard',
        home: 'hallway',
        patrol: ['hallway', 'cellar', 'tavern', 'market', 'crossroads'],
        role: 'quest',
        baseDialogue: "Keep the peace, or I'll keep you in the cellar. Head north to the tavern if you're looking for work."
    })
};
