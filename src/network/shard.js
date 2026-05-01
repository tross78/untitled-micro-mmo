import { getShardName } from '../rules.js';
import { localPlayer, shardEnemies, players, activeChannels } from '../store.js';
import { joinRoom as joinTorrent } from '../transport.js';
import { buildTorrentConfig } from './config.js';
import { INSTANCE_CAP } from '../data.js';
import { log } from '../ui.js';

const preJoinCache = new Map();
let currentInstance = 1;

export const getCurrentInstance = () => currentInstance;
export const setCurrentInstance = (val) => { currentInstance = val; };

export const preJoinShard = (location, instanceId, rtcConfig) => {
    const shard = getShardName(location, instanceId ?? currentInstance);
    const currentShard = getShardName(localPlayer.location, currentInstance);
    if (shard === currentShard || preJoinCache.has(shard)) return;
    
    const room = joinTorrent(
        buildTorrentConfig(rtcConfig),
        shard
    );
    const timeout = setTimeout(() => {
        room.leave();
        preJoinCache.delete(shard);
    }, 30000);
    preJoinCache.set(shard, { room, timeout });
};

export const getPreJoined = (shard) => {
    const pj = preJoinCache.get(shard);
    if (pj) {
        clearTimeout(pj.timeout);
        preJoinCache.delete(shard);
    }
    return pj;
};

export const clearShardState = (location) => {
    players.clear();
    shardEnemies.delete(location);
    localPlayer.currentEnemy = null;
    for (const [, chan] of activeChannels) clearTimeout(chan.timeoutId);
    activeChannels.clear();
};
