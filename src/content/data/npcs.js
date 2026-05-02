import { defineNpc } from '../define.js';

export const NPCS = {
    barkeep: defineNpc('barkeep', { 
        name: 'Barkeep', 
        home: 'tavern', 
        role: 'shop', 
        shop: ['ale', 'bread', 'potion'],
        baseDialogue: "Welcome to the Rusty Flagon. Stay a while, have a drink."
    }),
    bard: defineNpc('bard', {
        name: 'The Bard',
        home: 'tavern',
        role: 'flavor',
        baseDialogue: "I sing of other worlds... would you like to hear a /vision?"
    }),
    merchant: defineNpc('merchant', { 
        name: 'Merchant', 
        home: 'market', 
        role: 'shop', 
        shop: ['iron_sword', 'wood', 'iron'],
        baseDialogue: "Finest wares in the realm, or at least in this square."
    }),
    herbalist: defineNpc('herbalist', {
        name: 'Herbalist',
        home: 'herbalist_hut',
        role: 'shop',
        shop: ['potion', 'healing_elixir', 'strength_elixir'],
        baseDialogue: "The forest provides all we need, if you know where to look."
    }),
    sage: defineNpc('sage', { 
        name: 'Sage', 
        home: 'ruins', 
        patrol: ['ruins', 'forest_edge', 'hallway'], 
        role: 'flavor', 
        baseDialogue: "The shadows grow longer with each passing day..."
    }),
    guard: defineNpc('guard', {
        name: 'Guard',
        home: 'hallway',
        patrol: ['hallway', 'cellar', 'tavern', 'market', 'watchtower'],
        role: 'quest',
        baseDialogue: "Keep the peace, or I'll keep you in the cellar."
    })
};
