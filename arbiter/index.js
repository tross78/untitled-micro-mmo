import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'world_state.bin');

async function startArbiter() {
    const { joinRoom: joinNostr, selfId: nostrSelfId } = await import('@trystero-p2p/nostr');
    const { joinRoom: joinTorrent, selfId: torrentSelfId } = await import('@trystero-p2p/torrent');
    const { RTCPeerConnection } = await import('werift');
    const Y = await import('yjs');
    const { signMessage } = await import('../src/crypto.js');
    const { APP_ID, ROOM_NAME } = await import('../src/constants.js');
    const dotenv = await import('dotenv');

    dotenv.config({ path: new URL('.env', import.meta.url).pathname });
    const MASTER_SECRET_KEY = process.env.MASTER_SECRET_KEY;
    if (!MASTER_SECRET_KEY) {
        console.error('ERROR: MASTER_SECRET_KEY not found in .env');
        process.exit(1);
    }

    // --- STATE ---
    const ydoc = new Y.Doc();
    const yworld = ydoc.getMap('world');
    const yplayers = ydoc.getMap('players');
    const yevents = ydoc.getArray('event_log');

    // Load persisted state if available
    if (existsSync(STATE_FILE)) {
        try {
            const bin = readFileSync(STATE_FILE);
            Y.applyUpdate(ydoc, bin, 'persist');
            console.log('[Arbiter] Loaded persisted world state.');
        } catch (e) {
            console.warn('[Arbiter] Failed to load state file, starting fresh:', e.message);
        }
    }

    if (!yworld.has('world_seed')) {
        console.log('[Arbiter] Initializing new world seed...');
        ydoc.transact(() => {
            yworld.set('world_seed', 'h3arthw1ck-' + Math.random().toString(16).slice(2));
            yworld.set('day', 1);
            yworld.set('town_mood', 'weary');
            yworld.set('season', 'spring');
            yworld.set('season_number', 1);
            yworld.set('threat_level', 0);
            yworld.set('market_scarcity', []);
        }, 'init');
    }

    // Register both transport selfIds as Arbiter
    yplayers.set(nostrSelfId, 'Arbiter');
    yplayers.set(torrentSelfId, 'Arbiter');

    // Persist state to disk, debounced
    let persistTimer = null;
    const schedulePersist = () => {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            try {
                writeFileSync(STATE_FILE, Y.encodeStateAsUpdate(ydoc));
            } catch (e) {
                console.warn('[Arbiter] Failed to persist state:', e.message);
            }
        }, 2000);
    };

    // --- LOG TRIMMING ---
    const MAX_LOG_SIZE = 500;
    yevents.observe(() => {
        if (yevents.length > MAX_LOG_SIZE) {
            yevents.delete(0, yevents.length - MAX_LOG_SIZE);
        }
    });

    // Persist on any local change
    ydoc.on('update', (_, origin) => {
        if (origin !== 'remote') schedulePersist();
    });

    // --- NETWORKING ---
    const { lookup } = await import('dns/promises');

    async function filterReachable(urls) {
        const results = await Promise.allSettled(
            urls.map(url => lookup(new URL(url).hostname))
        );
        return urls.filter((_, i) => {
            const r = results[i];
            return r.status === 'fulfilled' && r.value.address !== '0.0.0.0';
        });
    }

    const { NOSTR_RELAYS: ALL_NOSTR_RELAYS, TORRENT_TRACKERS: ALL_TORRENT_TRACKERS } = await import('../src/constants.js');

    const [reachableRelays, reachableTrackers] = await Promise.all([
        filterReachable(ALL_NOSTR_RELAYS),
        filterReachable(ALL_TORRENT_TRACKERS),
    ]);

    console.log(`[Arbiter] Reachable Nostr relays: ${reachableRelays.length}/${ALL_NOSTR_RELAYS.length}`);
    console.log(`[Arbiter] Reachable trackers: ${reachableTrackers.length}/${ALL_TORRENT_TRACKERS.length}`);

    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80',            username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443',           username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ];

    const baseConfig = {
        appId: APP_ID,
        rtcPolyfill: RTCPeerConnection,
        rtcConfig: { iceServers },
    };

    const nostrConfig = {
        ...baseConfig,
        relayUrls: reachableRelays.length ? reachableRelays : ALL_NOSTR_RELAYS,
    };
    const torrentConfig = {
        ...baseConfig,
        trackerUrls: reachableTrackers.length ? reachableTrackers : ALL_TORRENT_TRACKERS,
    };

    console.log(`[Arbiter] Joining mesh (nostr: ${nostrSelfId}, torrent: ${torrentSelfId})...`);

    const room = joinNostr(nostrConfig, ROOM_NAME);
    const torrentRoom = joinTorrent(torrentConfig, ROOM_NAME);

    const setupArbiterRoom = (r, name) => {
        const [sendSync, getSync] = r.makeAction('sync');
        const [sendOfficialEvent] = r.makeAction('official_event');

        getSync((update, peerId) => {
            Y.applyUpdate(ydoc, update, 'remote');
            console.log(`[Arbiter][${name}] Synced state from peer ${peerId}`);
        });

        r.onPeerJoin(peerId => {
            console.log(`[Arbiter][${name}] Peer joined: ${peerId}`);
            sendSync(Y.encodeStateAsUpdate(ydoc), peerId);
        });

        return { sendSync, sendOfficialEvent };
    };

    const nostr = setupArbiterRoom(room, 'Nostr');
    const torrent = setupArbiterRoom(torrentRoom, 'Torrent');

    ydoc.on('update', (update, origin) => {
        if (origin !== 'remote') {
            nostr.sendSync(update);
            torrent.sendSync(update);
        }
    });

    console.log('[Arbiter] Started.');

    // --- DAY TICK: Pi owns all world state ---
    const { hashStr, seededRNG, nextMood, getSeason, getSeasonNumber, rollScarcity } = await import('../src/rules.js');

    function advanceDay() {
        const currentDay = yworld.get('day') || 1;
        const nextDay = currentDay + 1;
        const worldSeed = yworld.get('world_seed') || 'default';
        const rng = seededRNG(hashStr(worldSeed + nextDay + 'daytick'));

        const currentMood = yworld.get('town_mood') || 'weary';
        const newMood = nextMood(currentMood, rng);
        const newSeason = getSeason(nextDay);
        const newSeasonNum = getSeasonNumber(nextDay);
        const scarcity = rollScarcity(rng, newSeason);
        // Threat level drifts: +1 every 7 days, capped at 5
        const currentThreat = yworld.get('threat_level') || 0;
        const newThreat = nextDay % 7 === 0 ? Math.min(5, currentThreat + 1) : currentThreat;

        ydoc.transact(() => {
            yworld.set('day', nextDay);
            yworld.set('town_mood', newMood);
            yworld.set('season', newSeason);
            yworld.set('season_number', newSeasonNum);
            yworld.set('threat_level', newThreat);
            yworld.set('market_scarcity', scarcity);
        }, 'daytick');

        console.log(`[Arbiter] Day ${nextDay} — ${newSeason}, mood: ${newMood}, threat: ${newThreat}, scarce: ${scarcity.join(',') || 'none'}`);
        broadcastNews(nextDay);
    }

    // --- NEWS LOOP ---
    const NARRATIVE_EVENTS = [
        "A thick fog rolls into the town square.",
        "The tavern was unusually quiet last night.",
        "A rogue merchant was spotted near the ruins.",
        "The crops seem to be growing well this season.",
        "Faint music was heard coming from the cellar.",
        "A strange owl was seen watching the hallway."
    ];

    async function broadcastNews(day) {
        day = day || yworld.get('day') || 1;

        // Deduplicate: check if we already have a narrative event for this day
        const alreadyBroadcast = yevents.toArray().some(e => e.type === 'narrative' && e.day === day);
        if (alreadyBroadcast) return;

        const worldSeed = yworld.get('world_seed') || 'default';
        const rng = seededRNG(hashStr(worldSeed + day + 'news'));
        const event = NARRATIVE_EVENTS[rng(NARRATIVE_EVENTS.length)];
        const signature = await signMessage(event, MASTER_SECRET_KEY);

        console.log(`[Arbiter] Day ${day} News: ${event}`);

        try {
            nostr.sendOfficialEvent({ event, signature });
            torrent.sendOfficialEvent({ event, signature });
        } catch (e) {
            console.warn('[Arbiter] Broadcast partially failed:', e.message);
        }

        yevents.push([{ type: 'narrative', day, event, time: Date.now() }]);
    }

    // Tick day every 60s for testing (change to 86400000 for production)
    setInterval(advanceDay, 60000);

    // Initial news on startup (don't advance day, just announce current day)
    setTimeout(() => broadcastNews(), 10000);
}

const SURVIVABLE_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);
const SURVIVABLE_MESSAGES = ['unsupported', 'DECODER', 'SSL', 'certificate', 'server response', 'socket hang up', 'ECONNRESET'];

const isSurvivable = (err) =>
    SURVIVABLE_ERRORS.has(err.code) ||
    SURVIVABLE_MESSAGES.some(m => err.message?.includes(m));

process.on('uncaughtException', (err) => {
    console.error('[Arbiter] Uncaught Exception:', err.message);
    if (isSurvivable(err)) {
        console.log('[Arbiter] Networking error (relay/TLS), continuing...');
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[Arbiter] Unhandled Rejection:', err.message);
    if (!isSurvivable(err)) process.exit(1);
});

startArbiter().catch(err => {
    console.error('[Arbiter] Failed to start:', err);
});
