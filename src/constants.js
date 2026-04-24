export const MASTER_PUBLIC_KEY = 'Qu8SC4sndLy3JCD642IaKiynfdp90Oht6W68KQkYSoU=';

// Set this to the trycloudflare.com URL printed by `cloudflared tunnel --url http://localhost:3001`
// Leave empty string to skip HTTP bootstrap and rely on P2P only.
export const ARBITER_URL = '';
// Derived from MASTER_PUBLIC_KEY so this room is unique to your Pi instance.
// Strip non-alphanumeric chars — base64 contains + and / which can break Trystero's room hashing.
export const APP_ID = 'hearthwick-' + MASTER_PUBLIC_KEY.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
export const ROOM_NAME = 'lobby';

// Only the two most reliable trackers. btorrent.xyz is hardcoded in Trystero anyway.
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
];

// STUN is always tried first (free, fast, works when at least one peer has a public IP).
// TURN is the relay fallback for symmetric NAT (both peers behind NAT, e.g. Pi + mobile).
//
// TO UPGRADE: register at https://dashboard.metered.ca/auth/signup (free tier, no CC needed),
// create a TURN credential pair, and replace the openrelay entries below with:
//   { urls: 'turn:relay.metered.ca:80',  username: '<your-user>', credential: '<your-cred>' }
//   { urls: 'turn:relay.metered.ca:443', username: '<your-user>', credential: '<your-cred>' }
// Personal credentials are not shared with the public, so negotiation is 5–10s vs 30–90s.
export const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
