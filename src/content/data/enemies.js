import { defineEnemy } from '../define.js';

export const ENEMIES = {
    forest_wolf: defineEnemy('forest_wolf', { name: 'Forest Wolf', hp: 18, attack: 5,  defense: 1, xp: 14, loot: ['wolf_pelt', 'herbs'], color: '#aaa' }),
    ruin_shade:  defineEnemy('ruin_shade',  { name: 'Ruin Shade',  hp: 24, attack: 8,  defense: 0, xp: 24, loot: ['old_tome', 'gold', 'potion'], color: '#0af' }),
    cave_troll:  defineEnemy('cave_troll',  { name: 'Cave Troll',  hp: 38, attack: 10, defense: 3, xp: 42, loot: ['iron_key', 'gold', 'iron_sword'], color: '#f0f' }),
    bandit:      defineEnemy('bandit',      { name: 'Bandit',         hp: 32, attack: 11, defense: 2, xp: 45, loot: ['bandit_mask', 'gold', 'potion'], color: '#aaa' }),
    goblin:      defineEnemy('goblin',      { name: 'Goblin',         hp: 28, attack: 8,  defense: 1, xp: 32, loot: ['gold', 'potion', 'red_mushroom'], color: '#aaa' }),
    skeleton:    defineEnemy('skeleton',    { name: 'Skeleton',       hp: 45, attack: 15, defense: 5, xp: 75, loot: ['old_tome', 'gold'], color: '#0af' }),
    wraith:      defineEnemy('wraith',      { name: 'Wraith',         hp: 60, attack: 20, defense: 0, xp: 120, loot: ['old_tome', 'magic_staff'], color: '#f0f' }),
    mountain_troll: defineEnemy('mountain_troll', { name: 'Mountain Troll', hp: 90, attack: 22, defense: 9, xp: 220, loot: ['iron_key', 'gold', 'steel_sword'], color: '#ff0' }),
    crab:        defineEnemy('crab',        { name: 'Giant Crab',     hp: 28, attack: 7,  defense: 5, xp: 28, loot: ['gold', 'potion'], color: '#fa0' }),
    throne_guardian: defineEnemy('throne_guardian', { name: 'Throne Guardian', hp: 150, attack: 30, defense: 12, xp: 1000, loot: ['ancient_crown', 'gold', 'potion'], color: '#ff0' }),
};
