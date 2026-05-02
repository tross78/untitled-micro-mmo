import { defineItem } from '../define.js';

export const ITEMS = {
    wolf_pelt:      defineItem('wolf_pelt',      { name: 'Wolf Pelt',      type: 'material', price: 5, color: '#aaa' }),
    old_tome:       defineItem('old_tome',       { name: 'Old Tome',       type: 'material', price: 10, color: '#0af' }),
    iron_key:       defineItem('iron_key',       { name: 'Iron Key',       type: 'key',      price: 0, color: '#ff0' }),
    gold:           defineItem('gold',           { name: 'Gold (5)',       type: 'gold',       amount: 5, color: '#ff0' }),
    potion:         defineItem('potion',         { name: 'Health Potion',  type: 'consumable',  heal: 20, price: 15, color: '#0f0' }),
    ale:            defineItem('ale',            { name: 'Ale',            type: 'consumable',  heal: 5,  price: 5, color: '#aaa' }),
    bread:          defineItem('bread',          { name: 'Loaf of Bread',  type: 'consumable',  heal: 10, price: 8, color: '#aaa' }),
    iron_sword:     defineItem('iron_sword',     { name: 'Iron Sword',     type: 'weapon',      bonus: 3, price: 50, color: '#aaa' }),
    steel_sword:    defineItem('steel_sword',    { name: 'Steel Sword',    type: 'weapon',      bonus: 6, price: 150, color: '#0af' }),
    magic_staff:    defineItem('magic_staff',    { name: 'Magic Staff',    type: 'weapon',      bonus: 8, price: 300, color: '#f0f' }),
    healing_elixir: defineItem('healing_elixir', { name: 'Healing Elixir', type: 'consumable',  heal: 50, price: 40, color: '#0f0' }),
    strength_elixir: defineItem('strength_elixir', { name: 'Strength Elixir', type: 'buff',      atkBonus: 5, price: 60, color: '#fa0' }),
    bandit_mask:    defineItem('bandit_mask',    { name: 'Bandit Mask',    type: 'material',    price: 25, color: '#aaa' }),
    wheat:          defineItem('wheat',          { name: 'Wheat Bundle',   type: 'material', price: 2, color: '#ddc36b' }),
    wood:           defineItem('wood',           { name: 'Wood Bundle',    type: 'material', price: 2, color: '#aaa' }),
    iron:           defineItem('iron',           { name: 'Iron Ore',       type: 'material', price: 10, color: '#aaa' }),
    leather_armor:  defineItem('leather_armor',  { name: 'Leather Armor',  type: 'armor',    bonus: 2,  price: 15,  color: '#8b4513' }),
    iron_armor:     defineItem('iron_armor',     { name: 'Iron Armor',     type: 'armor',    bonus: 4,  price: 60,  color: '#aaa' }),
    warm_cloak:     defineItem('warm_cloak',     { name: 'Warm Cloak',     type: 'armor',    bonus: 1,  price: 8,   color: '#a52a2a' }),
};
