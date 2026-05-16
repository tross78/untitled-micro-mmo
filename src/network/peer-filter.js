// @ts-check

/**
 * Filter peer ids down to those directly connected on a specific Trystero room.
 * Global-room peers are not valid targets for shard-room sends.
 *
 * @param {{ getPeers?: () => Record<string, unknown> } | null | undefined} room
 * @param {string[]} ids
 * @returns {string[]}
 */
export const filterConnectedPeerIds = (room, ids) => {
    const peers = room?.getPeers?.() || {};
    return ids.filter(id => !!peers[id]);
};
