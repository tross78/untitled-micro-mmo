import { GAME_NAME } from '../content/data.js';

export const MASTER_PUBLIC_KEY = 'Qu8SC4sndLy3JCD642IaKiynfdp90Oht6W68KQkYSoU=';

export const VIEWPORT_W = 15;  // tiles wide (ALttP style)
export const VIEWPORT_H = 11;  // tiles tall
export const TILE_PX = 16;     // pixels per tile

// Optional build-time arbiter URL fallback.
// Runtime overrides:
// - `?arbiter=https://...`
// - `?arbiter=self` to use the current origin
// - `localStorage.fenhollow_arbiter_url = 'https://...'`
export const ARBITER_URL = '';
// Set this to the ID of a Gist you want to use for discovery (leave empty if not used)
export const GH_GIST_ID = '2e8f42685ce96e29f60da95ed9ca3be9';
// GitHub username that owns the Gist above
export const GH_GIST_USERNAME = 'tross78';

// Derived from MASTER_PUBLIC_KEY so this room is unique to your Pi instance.
// Strip non-alphanumeric chars — base64 contains + and / which can break Trystero's room hashing.
export const APP_ID = GAME_NAME + '-' + MASTER_PUBLIC_KEY.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);

// Torrent signaling relays. ICE/STUN handles the peer connection after
// signaling; these trackers are only for rendezvous and candidate exchange.
// Keep the set aligned with Trystero's torrent defaults for redundancy.
export const TORRENT_TRACKERS = [
    'wss://tracker.webtorrent.dev',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
];

// Optimized STUN list for faster NAT traversal and to avoid Firefox "5+ servers" warning.
export const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];

// TURN is the relay fallback. Reduced to one reliable port to avoid discovery lag.
export const TURN_SERVERS = [
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];

export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_SERVERS];
