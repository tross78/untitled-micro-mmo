import { defineRecipe } from '../define.js';

export const RECIPES = [
    defineRecipe('iron_sword', { id: 'iron_sword', name: 'Iron Sword', inputs: { wood: 1, iron: 2 }, output: 'iron_sword', location: 'market' }),
    defineRecipe('steel_sword', { id: 'steel_sword', name: 'Steel Sword', inputs: { iron: 3, wood: 2 }, output: 'steel_sword', location: 'market' }),
    defineRecipe('leather_armor', { id: 'leather_armor', name: 'Leather Armor', inputs: { wolf_pelt: 3 }, output: 'leather_armor', location: 'market' }),
    defineRecipe('flour', { id: 'flour', name: 'Flour', inputs: { wheat: 2 }, output: 'bread', location: 'mill' }),
];
