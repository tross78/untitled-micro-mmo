import { defineEnemy } from '../define.js';

export const ENEMIES = {
    forest_wolf: defineEnemy('forest_wolf', { name: 'Forest Wolf', hp: 20, attack: 5,  defense: 1, xp: 15, loot: ['wolf_pelt', 'potion'], color: '#aaa' }),
    ruin_shade:  defineEnemy('ruin_shade',  { name: 'Ruin Shade',  hp: 25, attack: 8,  defense: 0, xp: 25, loot: ['old_tome', 'gold', 'potion'], color: '#0af' }),
    cave_troll:  defineEnemy('cave_troll',  { name: 'Cave Troll',  hp: 40, attack: 10, defense: 3, xp: 40, loot: ['iron_key', 'gold', 'iron_sword'], color: '#f0f' }),
    bandit:      defineEnemy('bandit',      { name: 'Bandit',         hp: 35, attack: 12, defense: 2, xp: 50, loot: ['bandit_mask', 'gold', 'potion'], color: '#aaa' }),
    goblin:      defineEnemy('goblin',      { name: 'Goblin',         hp: 30, attack: 9,  defense: 1, xp: 35, loot: ['gold', 'potion'], color: '#aaa' }),
    skeleton:    defineEnemy('skeleton',    { name: 'Skeleton',       hp: 45, attack: 15, defense: 5, xp: 75, loot: ['old_tome', 'gold'], color: '#0af' }),
    wraith:      defineEnemy('wraith',      { name: 'Wraith',         hp: 60, attack: 20, defense: 0, xp: 120, loot: ['old_tome', 'magic_staff'], color: '#f0f' }),
    mountain_troll: defineEnemy('mountain_troll', { name: 'Mountain Troll', hp: 100, attack: 25, defense: 10, xp: 250, loot: ['iron_key', 'gold', 'steel_sword'], color: '#ff0' }),
    crab:        defineEnemy('crab',        { name: 'Giant Crab',     hp: 30, attack: 7,  defense: 5, xp: 30, loot: ['gold', 'potion'], color: '#fa0' }),
};
