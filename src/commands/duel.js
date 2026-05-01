import { selfId } from '../transport.js';
import { activeChannels, localPlayer } from '../store.js';
import { log } from '../ui.js';
import { bus } from '../eventbus.js';
import { hashStr, seededRNG, levelBonus, resolveAttack } from '../rules.js';
import { gameActions } from '../networking.js';
import { playerKeys } from '../identity.js';
import { signMessage } from '../crypto.js';
import { saveLocalState } from '../persistence.js';
import { DEFAULT_PLAYER_STATS } from '../data.js';
import { getPlayerEntry } from './helpers.js';

export async function startStateChannel(targetId, targetName, day) {
    if (activeChannels.has(targetId)) return;
    const timeoutId = setTimeout(() => {
        if (activeChannels.has(targetId)) {
            log(`[DUEL] Combat with ${targetName} timed out.`, '#555');
            activeChannels.delete(targetId);
        }
    }, 30000);
    activeChannels.set(targetId, {
        opponentName: targetName,
        day,
        round: 0,
        myHistory: [],
        theirHistory: [],
        timeoutId,
    });
    
    if (selfId < targetId) {
        await resolveRound(targetId);
    }
}

export async function resolveRound(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    const myLen = chan.myHistory.length;
    const theirLen = chan.theirHistory.length;

    if (myLen === 3 && theirLen === 3) {
        finishDuel(targetId);
        return;
    }

    let shouldSend = false;
    if (myLen < theirLen && myLen < 3) {
        shouldSend = true;
    } else if (myLen === theirLen && myLen < 3 && selfId < targetId) {
        shouldSend = true;
    }

    if (shouldSend) {
        const round = myLen + 1;
        const seed = hashStr(selfId + targetId + chan.day + round);
        const rng = seededRNG(seed);
        
        const myBonus = levelBonus(localPlayer.level);
        const myAtk = localPlayer.attack + myBonus.attack;
        
        const opponent = getPlayerEntry(targetId);
        const opBonus = levelBonus(opponent?.level || 1);
        const opDef = (opponent?.defense ?? DEFAULT_PLAYER_STATS.defense) + opBonus.defense;

        const dmg = resolveAttack(myAtk, opDef, rng).damage;

        const commit = { round, dmg, day: chan.day };
        const signature = await signMessage(JSON.stringify(commit), playerKeys.privateKey);
        
        chan.myHistory.push(commit);
        gameActions.sendDuelCommit({ commit, signature }, targetId);

        if (chan.myHistory.length === 3 && chan.theirHistory.length === 3) {
            finishDuel(targetId);
        }
    }
}

function finishDuel(targetId) {
    const chan = activeChannels.get(targetId);
    if (!chan) return;

    let totalMyDmg = chan.myHistory.reduce((a, b) => a + b.dmg, 0);
    let totalTheirDmg = chan.theirHistory.reduce((a, b) => a + b.dmg, 0);
    
    log(`\n--- DUEL RESULT vs ${chan.opponentName} ---`, '#ff0');
    log(`You dealt: ${totalMyDmg} | Opponent dealt: ${totalTheirDmg}`, '#aaa');
    
    if (totalMyDmg > totalTheirDmg) {
        log(`You WIN! (+10 XP) 🏆`, '#0f0');
        localPlayer.xp += 10;
        saveLocalState(localPlayer);
    } else if (totalMyDmg < totalTheirDmg) {
        log(`You LOSE. 💀`, '#f55');
    } else {
        log(`It's a DRAW. 🤝`, '#aaa');
    }
    
    clearTimeout(chan.timeoutId);
    activeChannels.delete(targetId);
}
