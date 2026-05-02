import { ENEMIES } from '../content/data.js';

export function resolveAttack(attackStat, defenseStat, rng, isNight = false) {
    const isDodge = rng(100) < 7;
    if (isDodge) return { damage: 0, isCrit: false, isDodge: true };

    const isCrit = rng(100) < 10;
    const base = Math.max(1, attackStat - defenseStat);
    let damage = (rng(base * 2) + 1) | 0;
    if (isCrit) damage *= 2;
    if (isNight) damage = Math.floor(damage * 1.2);
    
    return { damage, isCrit, isDodge: false };
}

export function rollLoot(enemyType, rng) {
    const enemy = ENEMIES[enemyType];
    if (!enemy) return [];
    return enemy.loot.filter(() => (rng(100) | 0) < 60);
}

export function xpToLevel(xp) {
    return (Math.floor(Math.sqrt((xp / 10) | 0)) + 1) | 0;
}

export function levelBonus(level) {
    return {
        attack:  (level - 1) * 2,
        defense: (level - 1) | 0,
        maxHp:   (level - 1) * 10,
    };
}
