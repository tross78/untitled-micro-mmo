import { localPlayer, players, pendingDuel, setPendingDuel, worldState } from '../state/store.js';
import { log } from '../ui/index.js';
import { bus } from '../state/eventbus.js';
import { gameActions } from '../network/index.js';
import { saveLocalState } from '../state/persistence.js';
import { getPlayerName, getTag, getPlayerEntry } from './helpers.js';

export const handleSocialCommands = async (command, args) => {
    switch (command) {
        case 'who': {
            const nearby = Array.from(players.keys()).filter(id => !players.get(id).ghost).map(id => getPlayerName(id));
            if (nearby.length === 0) {
                bus.emit('log', { msg: `You are alone here.`, color: '#555' });
            } else {
                bus.emit('log', { msg: `Nearby: ${nearby.join(', ')}`, color: '#aaa' });
            }
            return true;
        }

        case 'say': {
            const text = args.slice(1).join(' ').trim();
            if (!text) return true;
            gameActions.sendEmote({ room: localPlayer.location, text: `says: "${text}"` });
            bus.emit('chat:say', { name: 'You', text });
            return true;
        }

        case 'wave':
        case 'bow':
        case 'cheer': {
            const emoteText = command === 'wave' ? 'waves hello.' : command === 'bow' ? 'bows respectfully.' : 'cheers loudly!';
            gameActions.sendEmote({ room: localPlayer.location, text: emoteText });
            log(`[Social] You ${emoteText}`);
            return true;
        }

        case 'rename': {
            const newName = args.slice(1).join(' ').trim();
            if (!newName) { bus.emit('log', { msg: `Usage: /rename <name>` }); return true; }
            if (newName.length > 14) { bus.emit('log', { msg: `Name too long (max 14 characters).` }); return true; }
            localPlayer.name = newName;
            saveLocalState(localPlayer);
            bus.emit('log', { msg: `You are now known as ${newName}` });
            return true;
        }

        case 'duel': {
            const rawArg = args.slice(1).join(' ');
            if (!rawArg) return true;
            const ids = Array.from(players.keys()).filter(id => !players.get(id).ghost);
            const getNameOnly = (id) => (getPlayerEntry(id)?.name || '').toLowerCase();
            const lower = rawArg.toLowerCase();
            const targetId = (players.has(rawArg) ? rawArg : null)
                          ?? ids.find(id => getNameOnly(id) === lower)
                          ?? ids.find(id => getNameOnly(id).includes(lower));
            if (!targetId) { log(`Player not found.`); return true; }
            log(`[DUEL] Challenging ${getPlayerName(targetId)}...`, '#ff0');
            gameActions.sendDuelChallenge({ target: targetId, fromName: localPlayer.name });
            return true;
        }

        case 'accept': {
            if (!pendingDuel || Date.now() > pendingDuel.expiresAt) { log(`No pending challenge.`); return true; }
            log(`[DUEL] Accepting challenge from ${pendingDuel.challengerName}...`, '#0f0');
            gameActions.sendDuelAccept({ target: pendingDuel.challengerId, fromName: localPlayer.name });
            setPendingDuel(null);
            return { type: 'duel_accept', targetId: pendingDuel.challengerId, targetName: pendingDuel.challengerName, day: pendingDuel.day };
        }

        case 'decline': {
            log(`[DUEL] Challenge declined.`);
            setPendingDuel(null);
            return true;
        }
    }
    return false;
};
