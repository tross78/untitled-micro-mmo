import { levelBonus } from '../rules.js';
import { ITEMS } from '../data.js';
import { worldState } from '../store.js';
import { log } from '../ui.js';

export const refreshStatusBar = (localPlayer, world) => {
    const statusLeft = document.getElementById('status-left');
    const statusCenter = document.getElementById('status-center');
    const statusRight = document.getElementById('status-right');
    if (!statusLeft || !statusCenter || !statusRight) return;

    const loc = world[localPlayer.location];
    if (!loc) return;

    const bonus = levelBonus(localPlayer.level);
    const maxHp = (localPlayer.maxHp || 50) + (bonus.maxHp || 0) + (localPlayer.buffs?.rested ? 5 : 0);
    const hpPct = localPlayer.hp / maxHp;
    const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
    statusLeft.innerHTML = `Lvl ${localPlayer.level} <span style="color:${hpColor}">HP ${localPlayer.hp}/${maxHp}</span>`;

    const eqWepId = localPlayer.equipped?.weapon;
    const eqArmId = localPlayer.equipped?.armor;
    const wepTag = eqWepId && ITEMS[eqWepId] ? ` ⚔️${ITEMS[eqWepId].name}` : '';
    const armTag = eqArmId && ITEMS[eqArmId] ? ` 🛡️${ITEMS[eqArmId].name}` : '';
    const poisoned = (localPlayer.statusEffects || []).find(s => s.id === 'poisoned') ? ' ☠️' : '';
    const rested = (localPlayer.statusEffects || []).find(s => s.id === 'well_rested') ? ' 😴' : '';
    statusCenter.textContent = `${loc.name}${wepTag}${armTag}${poisoned}${rested}`;

    const fightsLeft = localPlayer.forestFights ?? 15;
    statusRight.textContent = `${localPlayer.gold}g  ⚡${fightsLeft}`;
};

export const printStatus = () => {
    log(`\n--- WORLD STATUS ---`, '#ffa500');
    log(`Season: ${worldState.season.toUpperCase()} ${worldState.seasonNumber} 🍂`, '#ffa500');
    log(`Day: ${worldState.day} ☀️`, '#ffa500');
    log(`Mood: ${worldState.mood.toUpperCase()} 🕯️`, '#ffa500');
    if (worldState.scarcity.length > 0) {
        log(`Scarcity: ${worldState.scarcity.join(', ')} ⚠️`, '#f55');
    }
    if (worldState.lastTick) {
        const nextTick = worldState.lastTick + (24 * 60 * 60 * 1000);
        const diff = nextTick - Date.now();
        if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            log(`Next day in ${h}h ${m}m ⏳`, '#ffa500');
        }
    }
    log(`World Seed: ${worldState.seed ? worldState.seed.slice(0, 12) + '...' : 'Finding peers...'}`, '#ffa500');
    log(`--------------------\n`, '#ffa500');
};
