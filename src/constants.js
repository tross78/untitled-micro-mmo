import { GAME_NAME } from './data.js';

export const MASTER_PUBLIC_KEY = 'Qu8SC4sndLy3JCD642IaKiynfdp90Oht6W68KQkYSoU=';

// Set this to the trycloudflare.com URL printed by `cloudflared tunnel --url http://localhost:3001`
// Leave empty string to skip HTTP bootstrap and rely on P2P only.
export const ARBITER_URL = '';
// Set this to the ID of a Gist you want to use for discovery (leave empty if not used)
export const GH_GIST_ID = 'bb6903724e5f89a8ad354c66b01d2b59';
// GitHub username that owns the Gist above
export const GH_GIST_USERNAME = 'tross78';

// Derived from MASTER_PUBLIC_KEY so this room is unique to your Pi instance.
// Strip non-alphanumeric chars — base64 contains + and / which can break Trystero's room hashing.
export const APP_ID = GAME_NAME + '-' + MASTER_PUBLIC_KEY.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);

// Stable high-uptime trackers (WebTorrent-compatible)
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.files.fm:7073/announce',
    'wss://tracker.gbitt.info:443/announce',
    'wss://tracker.open-internet.nl:443/announce',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz'
];

// Expanded STUN list for better browser-to-browser NAT traversal.
export const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
];

// TURN is the relay fallback for symmetric NAT (both peers behind NAT, e.g. Pi + mobile).
export const TURN_SERVERS = [
    { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_SERVERS];
