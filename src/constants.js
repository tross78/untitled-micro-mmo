export const MASTER_PUBLIC_KEY = 'b+olHCMT7bRyA66bk6VRNJhd9/gRewVPP664Phd3a+s=';
export const APP_ID = 'untitled-micro-mmo-v1';
export const ROOM_NAME = 'lobby';

// nos.lol and snort.social are open relays with no rate limits or signup walls.
// damus.io rate-limits aggressively; nostr.wine requires paid signup; nostr.band is unreliable.
export const NOSTR_RELAYS = [
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
    'wss://offchain.pub',
];

// tracker.btorrent.xyz is hardcoded inside Trystero — its failures are harmless noise.
export const TORRENT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
];
