# Claude Context & Implementation Notes - Hearthwick

## Architecture: "Hearthwick" Micro Cosy Metaverse
A serverless P2P MMO using Yjs for state, Trystero for signaling, and a Pi Zero W for narrative generation (RWKV7).

## Key Implementation Details

### Seed-Based Determinism
- Simulation state is `world_seed` + `event_log` (append-only Y.Array).
- All randomness uses `mulberry32` seeded with `hash(world_seed + day_number)`.
- **CRITICAL:** Integer math only. NO FLOATS. This prevents desync between x86 and ARM.

### Memory Optimization (Pi Zero W)
- **Problem:** 512MB RAM cannot run Node.js (Trystero/Yjs) and RWKV7 (llama.cpp) at the same time.
- **Solution:** Cron-based sequential window.
  - 1. `pm2 stop arbiter`
  - 2. Run inference (30 mins)
  - 3. `pm2 start arbiter`
  - 4. Broadcast delta to peers.

### Security Model
- Player actions signed with Ed25519 (WebCrypto).
- Peers validate logic locally before merging CRDT ops.
- Arbiter (Pi) performs "Official" signing of world snapshots and player progress.

### Networking
- Primary: `@trystero-p2p/torrent` (BitTorrent trackerless).
- Sharding: World sharded into rooms (max 20 peers per mesh).

## Implementation Phases (Revised)

### Phase 1: Text-MUD Core (In Progress)
- [x] Trystero + Yjs foundations.
- [x] Basic movement logic.
- [ ] **NEXT:** Implement `seededRNG` and `world_seed`.
- [ ] **NEXT:** Refactor logic for integer-only math.
- [ ] **NEXT:** WebCrypto Ed25519 integration (replacing tweetnacl in client).

### Phase 2: Persistence & Narrative Sim
- [ ] Transition tables for narrative arcs (Escalation, Mystery, Rivalry, etc.).
- [ ] Markov chain for town mood (daily drift).
- [ ] signed player snapshots in `localStorage`.

### Phase 3: The "Commissioner" (LLM)
- [ ] Setup `llama.cpp` and RWKV7-0.4B on Pi.
- [ ] Create the "Nightly Cron" bash script.
- [ ] JSON output grammar for LLM (Headline, News, Rumour).

### Phase 4: Anti-Cheat & PWA
- [ ] Enforce peer validation (Rules.js check on receive).
- [ ] PWA manifest and offline caching.
- [ ] GitHub Pages `state.json` fallback.

### Phase 5: Graphical Client (Visuals)
- [ ] Kontra.js renderer.
- [ ] Simple tile system reading from Yjs world doc.
