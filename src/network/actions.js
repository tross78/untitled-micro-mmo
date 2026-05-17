// @ts-check
// Shard action dispatch table — thin wrappers that sign/pack outgoing messages
// and forward them to the raw shard handles returned by setupShard.
import {
    packMove, packPresenceBatch, packActionLog,
    packDuelCommit, packTradeCommit,
} from './packer.js';
import { packSignedPresence } from './presence.js';
import { sendHLC } from './hlc.js';
import { hashStr } from '../rules/index.js';
import { signMessage } from '../security/crypto.js';
import { localPlayer } from '../state/store.js';
import { playerKeys } from '../security/identity.js';

/**
 * Build the public-facing shardActions API from a raw shard handle `r`.
 * @param {object} r - return value of setupShard(room)
 * @returns {object} shardActions
 */
export const buildShardActions = (r) => ({
    sendMove: async (data) => {
        if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return;
        const moveData = { from: data.from, to: data.to, x: data.x || 0, y: data.y || 0, ts: Date.now() };
        r.sendMove(packMove({ ...moveData, signature: await signMessage(JSON.stringify(moveData), playerKeys.privateKey) }));
    },
    sendMoveTo: async (data, targetPeerIds) => {
        if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return;
        if (!targetPeerIds || targetPeerIds.length === 0) return;
        const moveData = { from: data.from, to: data.to, x: data.x || 0, y: data.y || 0, ts: Date.now() };
        const packed = packMove({ ...moveData, signature: await signMessage(JSON.stringify(moveData), playerKeys.privateKey) });
        r.sendMove(packed, targetPeerIds);
    },
    sendMonsterDmg: (data) => r.sendMonsterDmg(data),
    sendActionLog: (data) => r.sendActionLog(packActionLog(data)),
    sendPresenceSingle: (data, target) => {
        if (!playerKeys || !localPlayer.ph || localPlayer.ph === '00000000') return;
        packSignedPresence({ ...data, hlc: sendHLC() }).then(p => { if (target) r.sendPresenceSingle(p, target); else r.plumSend(p); });
    },
    sendPresenceBatch: (data, target) => {
        const packed = packPresenceBatch(data);
        target ? r.sendPresenceBatch(packed, target) : r.sendPresenceBatch(packed);
    },
    sendIdentity: (data, target) => target ? r.sendIdentity(data, target) : r.sendIdentity(data),
    relayState: (data) => r.sendRelay(data),
    sendRollupLocal: (data) => r.sendRollupLocal(data),
    sendDuelChallenge: (data) => r.sendDuelChallenge(data),
    sendDuelAccept: (data) => r.sendDuelAccept(data),
    sendDuelCommit: (data, target) => r.sendDuelCommit(packDuelCommit({ ...data.commit, signature: data.signature }), target),
    sendTradeOffer: (data, target) => r.sendTradeOffer(data, target),
    sendTradeAccept: (data, target) => r.sendTradeAccept(data, target),
    sendTradeCommit: (data, target) => r.sendTradeCommit(packTradeCommit(data), target),
    sendTradeFinal: (data) => r.sendTradeFinal(data),
    sendSketch: (data, target) => target ? r.sendSketch(data, target) : r.sendSketch(data),
    sendRequest: (data, target) => r.sendRequest(data, target),
    sendPresenceDelta: (data, target) => target ? r.sendPresenceDelta(data, target) : r.sendPresenceDelta(data),
    processPresence: async (packed, peerId) => await r.processPresenceSingle(packed, peerId),
    sendCommitAction: ({ seq, type, target, nonce }) => r.sendCommit({ seq, commit: (hashStr(`${type}|${target}|${nonce}`) >>> 0).toString(16).padStart(8, '0') }),
    sendRevealAction: (data) => r.sendReveal(data),
});
