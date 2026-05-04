import { defineRecipe } from '../define.js';

export const RECIPES = [
    defineRecipe('iron_sword', { id: 'iron_sword', name: 'Iron Sword', inputs: { wood: 1, iron: 2 }, output: 'iron_sword', location: 'market' }),
    defineRecipe('steel_sword', { id: 'steel_sword', name: 'Steel Sword', inputs: { iron: 3, wood: 2 }, output: 'steel_sword', location: 'market' }),
    defineRecipe('leather_armor', { id: 'leather_armor', name: 'Leather Armor', inputs: { wolf_pelt: 3 }, output: 'leather_armor', location: 'market' }),
    defineRecipe('bread', { id: 'bread', name: 'Bread', inputs: { wheat: 2 }, output: 'bread', location: 'mill' }),
    defineRecipe('healing_elixir', { id: 'healing_elixir', name: 'Healing Elixir', inputs: { potion: 1, herbs: 2, red_mushroom: 1 }, output: 'healing_elixir', location: 'herbalist_hut' }),
    defineRecipe('strength_elixir', { id: 'strength_elixir', name: 'Strength Elixir', inputs: { healing_elixir: 1, herbs: 2, red_mushroom: 2 }, output: 'strength_elixir', location: 'herbalist_hut' }),
];
