import { joinRoom } from '@trystero-p2p/torrent';
import { RTCPeerConnection } from '../arbiter/node_modules/werift/lib/index.mjs';
import { ICE_SERVERS } from '../src/infra/constants.js';
import { buildTorrentConfig } from '../src/network/config.js';

/**
 * Headless Load Tester for Hearthwick.
 * Spawns simulated peers to stress-test the shard discovery and P2P mesh.
 */
const NUM_PEERS = process.argv[2] || 5;
const SHARD_NAME = process.argv[3] || 'cellar-1';

console.log(`[LoadTester] Spawning ${NUM_PEERS} headless peers in shard: ${SHARD_NAME}`);

for (let i = 0; i < NUM_PEERS; i++) {
    const config = {
        ...buildTorrentConfig({ iceServers: ICE_SERVERS }),
        rtcPolyfill: RTCPeerConnection,
    };

    const room = joinRoom(config, SHARD_NAME);
    const peerId = `bot-${i}-${Math.random().toString(16).slice(2, 6)}`;

    room.onPeerJoin((id) => {
        console.log(`[Bot ${peerId}] Peer joined: ${id}`);
    });

    // Simulate basic activity
    const [sendPresence] = room.makeAction('presence_single');
    setInterval(() => {
        sendPresence({ name: `Bot-${i}`, location: SHARD_NAME, ts: Date.now() });
    }, 30000);

    console.log(`[LoadTester] Bot ${i} joined.`);
}
