# Scaling Architecture — 50k Players

## 1. Arbiter Bottlenecks (The Pi Zero W)
**The Problem:** A Pi Zero W (single core) cannot verify 100+ Ed25519 signatures per second. At 50,000 players (1,000 shards), a 10s rollup interval generates exactly this load.
**The Solution:**
- **Load-Adaptive Rollups:** The Arbiter will monitor its own event loop lag. If lag > 1s, it broadcasts a "Slow Down" signal, instructing clients to increase `ROLLUP_INTERVAL` (e.g., from 10s to 60s).
- **Probabilistic Verification:** Instead of verifying 100% of rollups, the Arbiter verifies 10% randomly. However, if a **Fraud Proof** is received, the Arbiter enters "High Alert" and verifies 100% of rollups for that shard and proposer for the next hour.
- **Worker Offloading:** (Future) Use a Pi 4 or 5 as the primary Arbiter to leverage multi-core verification.

## 2. GitHub Gist & Discovery
**The Problem:** GitHub API rate limits will block 50,000 players. Raw Gist URLs are cached, leading to stale discovery.
**The Solution:**
- **DHT Beaconing:** Move the "source of truth" for discovery from the Gist to the BitTorrent DHT. The Arbiter will announce its latest signed state hash to a specific DHT key.
- **Gist as Cold-Start Only:** Clients only hit the Gist if they have 0 peers after 30 seconds.
- **Gist Sharding:** Distribute the beacon across 5-10 different Gists, with clients picking one based on their `selfId` hash.

## 3. Tracker & Signaling Load
**The Problem:** 50,000 players on `wss://tracker.openwebtorrent.com` will result in an IP ban for the game.
**The Solution:**
- **Tracker Sharding:** Instead of one `APP_ID`, use `APP_ID + shard_index`. This splits the 50k players into 1,000 independent swarms, each with only 50 peers. Trackers see 1,000 small swarms instead of one massive, "noisy" swarm.
- **Private Trackers:** Deploy a cluster of `bittorrent-tracker` instances on low-cost VPS (DigitalOcean/Hetzner) to handle signaling.

## 4. Local Storage Performance
**The Problem:** `JSON.stringify(localPlayer)` on every combat turn causes micro-stutters when inventory/quest history is large.
**The Solution:**
- **Debounced Persistence:** Implement a 5-second debounce on `saveLocalState`. State is "dirty" in memory and committed to `localStorage` only during idle time.
- **Persistence Priority:** Critical actions (Level Up, Buying a rare item) bypass the debounce and save immediately.

## 5. Collision Probabilities
**The Problem:** 32-bit `ph` (8-char hex) collisions occur at ~77k players (Birthday Paradox).
**The Solution:**
- **Cosmetic Only:** Ensure `ph` is NEVER used for logic. All state reconciliation (IBLT) and signatures MUST use the full Ed25519 public key or the 20-byte Trystero Peer ID.
- **Map Keys:** Always use Trystero `peerId` as the key in the `players` Map.

## 6. NPC Day Transitions
**The Problem:** NPCs moving deterministically on day-flip can "teleport" away from a player.
**The Solution:**
- **Global Event Sync:** When the Arbiter broadcasts the new Day State, clients trigger a `onDayFlip` hook. This hook refreshes the current room description and NPC list, giving players immediate feedback ("The Guard departs for the Hallway as the sun rises").
