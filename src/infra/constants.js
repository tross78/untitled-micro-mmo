import { GAME_NAME } from '../content/data.js';

export const MASTER_PUBLIC_KEY = 'o3aLY6pfkQd7zlcYRa5cQN/HLYMKh5EpXOVy+4Dulm8=';

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

// Stable suffix that makes this game instance's rooms unique across the tracker.
// Intentionally NOT derived from MASTER_PUBLIC_KEY — key rotations must not
// change room names, which would disconnect all existing players.
export const APP_ID = GAME_NAME + '-Qu8SC4sn';

// Torrent signaling relays. ICE/STUN handles the peer connection after
// signaling; these trackers are only for rendezvous and candidate exchange.
// Verified 2026-05-20:
//   tracker.openwebtorrent.com — healthy (~765ms)
//   tracker.webtorrent.dev     — returns "Invalid request" (broken, removed 2026-05-20)
//   tracker.btorrent.xyz       — SSL cert mismatch (domain sold/hijacked, removed)
//   tracker.files.fm:7073      — returns HTTP 403 (removed; was crashing arbiter)
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
];

// Optimized STUN list for faster NAT traversal and to avoid Firefox "5+ servers" warning.
export const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];

// TURN is the relay fallback. UDP port 443 for most networks; TCP variant for
// networks that block UDP (common on restrictive corporate/school wifi).
export const TURN_SERVERS = [
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_SERVERS];
