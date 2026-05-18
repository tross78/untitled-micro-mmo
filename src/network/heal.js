// @ts-check

/**
 * Count shard peers that are both directly connected on the shard room and
 * have sent a fully verified signed presence packet.
 *
 * @param {Set<string>} shardKnownPeers
 * @param {Map<string, any>} players
 * @returns {number}
 */
export const countUsableShardPeers = (shardKnownPeers, players) => {
    let count = 0;
    for (const id of shardKnownPeers) {
        const peer = players.get(id);
        if (peer?.publicKey && peer?.presenceVerifiedAt && !peer.ghost && !peer.stale) count++;
    }
    return count;
};

/**
 * Decide whether a scheduled event-driven heal should run.
 *
 * @param {number} usableShardPeers
 * @param {number} sinceLastHealMs
 * @param {number} cooldownMs
 * @returns {boolean}
 */
export const shouldRunEventHeal = (usableShardPeers, sinceLastHealMs, cooldownMs) => {
    return usableShardPeers === 0 && sinceLastHealMs >= cooldownMs;
};
