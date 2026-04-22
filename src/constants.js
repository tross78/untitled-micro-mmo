export const MASTER_PUBLIC_KEY = 'b+olHCMT7bRyA66bk6VRNJhd9/gRewVPP664Phd3a+s=';
// Derived from MASTER_PUBLIC_KEY so this room is unique to your Pi instance.
// Strip non-alphanumeric chars — base64 contains + and / which can break Trystero's room hashing.
export const APP_ID = 'hearthwick-' + MASTER_PUBLIC_KEY.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
export const ROOM_NAME = 'lobby';

// snort.social and primal.net are open relays that work without PoW or web-of-trust.
// nos.lol now requires 28-bit PoW (Trystero sends 12 — rejected).
// offchain.pub requires web-of-trust membership — rejected.
export const NOSTR_RELAYS = [
    'wss://relay.snort.social',
    'wss://relay.primal.net',
];

// tracker.btorrent.xyz is hardcoded inside Trystero — its failures are harmless noise.
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
];

// STUN first (free, no infra), TURN as last resort (relay, swappable).
// openrelay.metered.ca = Metered.ca free tier (20GB/month). Swap credentials here if needed.
export const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
