import { worldState, localPlayer, setHasSyncedWithArbiter, hasSyncedWithArbiter, setBans, bansHash, WORLD_STATE_KEY } from '../state/store.js';
import { deriveWorldState, getTimeOfDay } from '../rules/index.js';
import { log, printStatus } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { getArbiterUrl } from '../infra/runtime.js';
import { ARBITER_URL } from '../infra/constants.js';

const runtimeArbiterUrl = () => getArbiterUrl(ARBITER_URL);

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
            event: derived.event,
            weather: derived.weather
        });

        if (isNewDay) {
            log(`\n[EVENT] THE SUN RISES ON DAY ${worldState.day}.`, '#0ff');
            localPlayer.currentEnemy = null;
            localPlayer.forestFights = 15;
            localPlayer.combatRound = 0;
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
