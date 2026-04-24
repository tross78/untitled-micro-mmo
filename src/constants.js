export const MASTER_PUBLIC_KEY = 'Qu8SC4sndLy3JCD642IaKiynfdp90Oht6W68KQkYSoU=';
// Derived from MASTER_PUBLIC_KEY so this room is unique to your Pi instance.
// Strip non-alphanumeric chars — base64 contains + and / which can break Trystero's room hashing.
export const APP_ID = 'hearthwick-' + MASTER_PUBLIC_KEY.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
export const ROOM_NAME = 'lobby';

// Only the two most reliable trackers. btorrent.xyz is hardcoded in Trystero anyway.
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
];

// STUN first (free, fast), then Cloudflare TURN (free open beta, low-latency global network).
// openrelay.metered.ca used the public shared credentials — chronically overloaded, removed.
// If Cloudflare TURN exits beta or requires auth, swap in Metered.ca paid credentials here.
export const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:turn.cloudflare.com:3478',               username: 'cloudflare', credential: 'cloudflare' },
    { urls: 'turn:turn.cloudflare.com:443',                username: 'cloudflare', credential: 'cloudflare' },
    { urls: 'turn:turn.cloudflare.com:443?transport=tcp',  username: 'cloudflare', credential: 'cloudflare' },
];
