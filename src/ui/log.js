import { bus } from '../state/eventbus.js';
import { getHealthBar } from './helpers.js';

const output = document.getElementById('output');

let lastLogMsg = '';
let lastLogColor = '';
let lastLogCount = 1;
let lastLogEl = null;

export const injectLog = (msg, color = '#0f0') => {
    if (!output) {
        console.log(`[LOG] ${msg}`);
        return;
    }
    if (msg === lastLogMsg && color === lastLogColor && lastLogEl) {
        lastLogCount++;
        const baseMsg = msg.replace(/\s+\(x\d+\)$/, '');
        lastLogEl.innerHTML = `${baseMsg} (x${lastLogCount})`;
        return;
    }
    const line = document.createElement('div');
    line.className = 'log-line';
    line.style.color = color;
    line.innerHTML = msg;
    output.appendChild(line);
    lastLogMsg = msg;
    lastLogColor = color;
    lastLogCount = 1;
    lastLogEl = line;
    output.scrollTop = output.scrollHeight;
    if (output.childNodes.length > 500) {
        output.removeChild(output.firstChild);
    }
};

export const initLogHandlers = () => {
    bus.on('log', ({ msg, color }) => injectLog(msg, color));
    bus.on('combat:hit', ({ attacker, target, damage, crit, targetHP, targetMaxHP }) => {
        let msg = crit ? `<b>CRITICAL HIT!</b> ${attacker} hit ${target} for ${damage}.` : `${attacker} hit ${target} for ${damage}.`;
        if (targetHP !== undefined) msg += ` ${getHealthBar(targetHP, targetMaxHP)}`;
        injectLog(msg, attacker === 'You' ? '#0f0' : '#f55');
    });
    bus.on('combat:dodge', ({ attacker, target }) => injectLog(`${target} dodged ${attacker}'s attack!`, '#0af'));
    bus.on('combat:death', ({ entity }) => injectLog(`${entity} has been defeated!`, '#ff0'));
    bus.on('player:levelup', ({ level }) => injectLog(`LEVEL UP! You are now level ${level}! ✨`, '#ff0'));
    bus.on('npc:speak', ({ npcName, text }) => injectLog(`[Talk] ${npcName}: "${text}"`, '#0ff'));
    bus.on('item:pickup', ({ item }) => injectLog(`You picked up ${item.name}.`, '#ff0'));
    bus.on('quest:progress', ({ name, current, total }) => injectLog(`[Quest] ${name} progress: ${current}/${total}`, '#ff0'));
    bus.on('quest:complete', ({ name, rewards }) => {
        injectLog(`[Quest] COMPLETED: ${name}!`, '#0f0');
        injectLog(`[Quest] Reward: ${rewards.xp} XP, ${rewards.gold} Gold`, '#ff0');
    });
    bus.on('chat:say', ({ name, text }) => injectLog(`[Chat] ${name}: "${text}"`, '#fff'));
    bus.on('world:timeOfDay', ({ day, timeOfDay }) => {
        const label = timeOfDay === 'night' ? 'Night falls' : 'Dawn breaks';
        injectLog(`[World] ${label} — Day ${day}.`, '#0af');
    });
};
