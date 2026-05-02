import { STUN_SERVERS, TORRENT_TRACKERS, APP_ID } from '../infra/constants.js';

export const ROLLUP_INTERVAL = 10000;
export const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;
export const NETWORK_STALL_MS = 60000;
export const NETWORK_HEAL_COOLDOWN_MS = 30000;

export const buildTorrentConfig = (rtcConfig) => ({
    appId: APP_ID,
    relayUrls: TORRENT_TRACKERS,
    rtcConfig: rtcConfig || { iceServers: STUN_SERVERS }
});

export const isUsingTurnFallback = (rtcConfig) => {
    const iceServers = rtcConfig?.iceServers || [];
    return iceServers.some(server => {
        const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
        return urls.some(url => typeof url === 'string' && url.startsWith('turn:'));
    });
};
