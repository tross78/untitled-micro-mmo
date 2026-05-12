import { worldState, localPlayer, setHasSyncedWithArbiter, hasSyncedWithArbiter, setBans, bansHash, WORLD_STATE_KEY, arbiterLastSeenAt } from '../state/store.js';
import { saveLocalState } from '../state/persistence.js';
import { deriveWorldState, getTimeOfDay } from '../rules/index.js';
import { log, printStatus } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { getArbiterUrl } from '../infra/runtime.js';
import { ARBITER_URL } from '../infra/constants.js';

const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);

const OFFLINE_DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_DAY_KEY = 'hearthwick_offline_day_ts';

// 8.6c: emit named bus events so UI and NPCs can react to world events
const _emitDayEvent = (ws) => {
    if (!ws.event) return;
    bus.emit('world:event', { event: ws.event, scarcity: ws.scarcity, surplus: ws.surplus, weather: ws.weather });
    const labels = {
        market_surplus:  '[Event] Market Surplus — prices drop on materials and consumables.',
        scarcity_spike:  '[Event] Scarcity Spike — some goods are harder to find today.',
        bounty_hunt:     '[Event] Bounty Hunt — the Guard is paying extra for bandit contraband.',
        wandering_trader:'[Event] Wandering Trader — a merchant has appeared with rare wares.',
        wolf_pack:       '[Event] Wolf Pack — more wolves are active in the forest today.',
        ancient_tremor:  '[Event] Ancient Tremor — the catacombs are unsettled; enemies hit harder.',
        wandering_boss:  `[Event] WANDERING BOSS — a ${ws.event.target} has been spotted nearby!`,
    };
    const msg = labels[ws.event.type];
    if (msg) log(msg, '#fa0');
};

const applyNewDay = () => {
    worldState.day = (worldState.day || 1) + 1;
    const derived = deriveWorldState(worldState.seed || 0, worldState.day);
    Object.assign(worldState, {
        mood: derived.mood, season: derived.season, seasonNumber: derived.seasonNumber,
        threatLevel: derived.threatLevel, scarcity: derived.scarcity, surplus: derived.surplus,
        event: derived.event, weather: derived.weather,
    });
    localStorage.setItem(WORLD_STATE_KEY, JSON.stringify({ seed: worldState.seed, day: worldState.day, lastTick: worldState.lastTick || 0 }));
    localPlayer.currentEnemy = null;
    localPlayer.forestFights = 15;
    localPlayer.combatRound = 0;
    if (localPlayer.statusEffects) localPlayer.statusEffects = localPlayer.statusEffects.filter(e => e.id !== 'well_rested');
    if (localPlayer.buffs) { localPlayer.buffs.rested = false; localPlayer.buffs.activeElixir = null; }
    log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
    _emitDayEvent(worldState);
    printStatus();
    bus.emit('world:timeOfDay', { day: worldState.day, timeOfDay: 'day' });
    saveLocalState(localPlayer);
};

export const initOfflineDayTick = () => {
    // 8.95k: always apply missed days on page load, even when arbiter is configured
    const stored = parseInt(localStorage.getItem(OFFLINE_DAY_KEY) || '0', 10);
    const now = Date.now();
    if (!stored) {
        localStorage.setItem(OFFLINE_DAY_KEY, String(now));
    } else if (now - stored >= OFFLINE_DAY_MS) {
        const daysPassed = Math.floor((now - stored) / OFFLINE_DAY_MS);
        for (let i = 0; i < daysPassed; i++) applyNewDay();
        localStorage.setItem(OFFLINE_DAY_KEY, String(stored + daysPassed * OFFLINE_DAY_MS));
    }

    if (runtimeArbiterUrl()) return; // arbiter handles ongoing interval ticks

    // Check once per hour while tab is open
    setInterval(() => {
        // Only defer to arbiter if it has been heard from in the last 5 minutes
        if (hasSyncedWithArbiter && arbiterLastSeenAt > 0 && (Date.now() - arbiterLastSeenAt) < 5 * 60 * 1000) return;
        const ts = parseInt(localStorage.getItem(OFFLINE_DAY_KEY) || '0', 10);
        if (Date.now() - ts >= OFFLINE_DAY_MS) {
            const daysPassed = Math.floor((Date.now() - ts) / OFFLINE_DAY_MS);
            for (let i = 0; i < daysPassed; i++) applyNewDay();
            localStorage.setItem(OFFLINE_DAY_KEY, String(ts + daysPassed * OFFLINE_DAY_MS));
        }
    }, 60 * 60 * 1000);
};

export const updateSimulation = (state) => {
    if (!state) return;
    
    const personalFields = ['ph', 'name', 'xp', 'level', 'gold', 'inventory', 'quests', 'hp', 'maxHp'];
    personalFields.forEach(f => { if (f in state) delete state[f]; });

    if (state.type === 'ban') {
        log(`[Arbiter] Proposer banned: ${state.target.slice(0, 8)}`, '#f55');
        return;
    }

    const arbiterUrl = runtimeArbiterUrl();
    if (state.bans && state.bans !== bansHash && arbiterUrl) {
        fetch(`${arbiterUrl}/bans`)
            .then(r => r.ok ? r.json() : [])
            .then(list => setBans(list, state.bans))
            .catch(() => {});
    }

    const newSeed = state.world_seed;
    const newDay = state.day || 1;
    const newTick = state.last_tick || 0;
    const firstSync = !hasSyncedWithArbiter;

    if (newSeed !== worldState.seed || newDay !== worldState.day || newTick !== worldState.lastTick) {
        const isNewDay = newDay > worldState.day && hasSyncedWithArbiter;
        worldState.seed = newSeed;
        worldState.day = newDay;
        worldState.lastTick = newTick;
        localStorage.setItem(WORLD_STATE_KEY, JSON.stringify({ seed: newSeed, day: newDay, lastTick: newTick }));
        const derived = deriveWorldState(newSeed, newDay);
        Object.assign(worldState, {
            mood: derived.mood,
            season: derived.season,
            seasonNumber: derived.seasonNumber,
            threatLevel: derived.threatLevel,
            scarcity: derived.scarcity,
            surplus: derived.surplus,
            event: derived.event,
            weather: derived.weather
        });

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            _emitDayEvent(worldState);
            localPlayer.currentEnemy = null;
            localPlayer.forestFights = 15;
            localPlayer.combatRound = 0;
            if (localPlayer.statusEffects) {
                localPlayer.statusEffects = localPlayer.statusEffects.filter(effect => effect.id !== 'well_rested');
            }
            if (localPlayer.buffs) {
                localPlayer.buffs.rested = false;
                localPlayer.buffs.activeElixir = null;
            }
            printStatus();
            bus.emit('world:timeOfDay', { day: worldState.day, timeOfDay: 'day' });
        }
    }

    if (firstSync) {
        setHasSyncedWithArbiter(true);
        log(`\n[System] Connected — Day ${worldState.day}, ${worldState.mood.toUpperCase()}.`, '#0f0');
        printStatus();
        bus.emit('world:timeOfDay', { day: worldState.day, timeOfDay: getTimeOfDay() });
    }
};
