import { localPlayer, players, worldState, hasSyncedWithArbiter } from '../state/store.js';
import { ITEMS } from '../engine/data.js';
import { levelBonus, getShardName } from '../rules/index.js';
import { log, printStatus } from '../ui/index.js';
import { globalRooms, rooms, currentInstance } from '../network/index.js';
import { escapeHtml, getTag } from './helpers.js';

export const handleMiscCommands = async (command, args) => {
    switch (command) {
        case 'status':
            printStatus();
            return true;

        case 'help':
            log('--- Movement: /look, /move <dir>, /map', '#ffa500');
            log('--- Combat:   /attack, /rest, /stats, /inventory, /use <item>', '#ffa500');
            log('--- Social:   /who, /talk <npc>, /wave, /bow, /cheer, /duel <name>, /accept, /decline', '#ffa500');
            log('--- NPC/Shop: /buy <item>, /sell <item>, /quest, /bank', '#ffa500');
            log('--- World:    /status, /rename <name>, /net, /clear', '#ffa500');
            return true;

        case 'net': {
            const gPeers = globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0;
            const sPeers = rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0;
            const shardName = getShardName(localPlayer.location, currentInstance);
            log(`\n--- NETWORK STATUS ---`, '#0af');
            log(`Global Room: global (${gPeers} peers)`);
            log(`Shard Room: ${shardName} (${sPeers} peers)`);
            log(`Arbiter Sync: ${hasSyncedWithArbiter ? 'YES' : 'NO'}`);
            log(`Identity: ${localPlayer.name}#${getTag(localPlayer.ph)}`);
            log(`----------------------\n`, '#0af');
            return true;
        }

        case 'score': {
            const list = Array.from(players.values());
            list.push({ name: localPlayer.name, level: localPlayer.level, xp: localPlayer.xp, ph: localPlayer.ph });
            list.sort((a, b) => b.level - a.level || b.xp - a.xp);
            log(`\n--- TOP ADVENTURERS ---`, '#ffa500');
            list.slice(0, 10).forEach((p, i) => {
                const name = escapeHtml(p.name || `Peer-${getTag(p.ph)}`);
                log(`${i + 1}. ${name}#${getTag(p.ph)} - Level ${p.level} (${p.xp} XP)`, '#ffa500');
            });
            log(`-----------------------\n`, '#ffa500');
            return true;
        }

        case 'stats': {
            const bonus = levelBonus(localPlayer.level);
            const maxHp = localPlayer.maxHp + bonus.maxHp;
            const hpPct = localPlayer.hp / maxHp;
            const hpColor = hpPct < 0.25 ? '#f55' : hpPct < 0.5 ? '#fa0' : '#0f0';
            const xpForLevel = (l) => (l - 1) ** 2 * 10;
            const xpNeeded = xpForLevel(localPlayer.level + 1) - localPlayer.xp;
            const eqWep = localPlayer.equipped?.weapon ? ITEMS[localPlayer.equipped.weapon]?.name : null;
            const eqArm = localPlayer.equipped?.armor ? ITEMS[localPlayer.equipped.armor]?.name : null;
            log(`\n--- ${escapeHtml(localPlayer.name).toUpperCase()} ---`, '#ffa500');
            log(`Level: ${localPlayer.level}  XP: ${localPlayer.xp} (${xpNeeded} to next level) ✨`, '#ffa500');
            log(`HP: ${localPlayer.hp} / ${maxHp} ❤️`, hpColor);
            log(`Attack: ${localPlayer.attack + bonus.attack} ⚔️  Defense: ${localPlayer.defense + bonus.defense} 🛡️`, '#ffa500');
            log(`Equipped: ⚔️ ${eqWep || 'none'}  🛡️ ${eqArm || 'none'}`, '#0af');
            log(`Gold: ${localPlayer.gold} 💰  Bank: ${localPlayer.bankedGold} 🏦`, '#ffa500');
            log(`Daily Fights Remaining: ${localPlayer.forestFights} ⚡`, '#0af');
            if (localPlayer.statusEffects?.length > 0) {
                const effectNames = { poisoned: '☠️ Poisoned', well_rested: '😴 Well Rested' };
                const effects = localPlayer.statusEffects.map(s => effectNames[s.id] || s.id).join(', ');
                log(`Status: ${effects}`, '#fa0');
            }
            return true;
        }

        case 'clear': {
            const output = document.getElementById('output');
            if (output) output.innerHTML = '';
            return true;
        }
    }
    return false;
};
