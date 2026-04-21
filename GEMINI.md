# Gemini CLI Project Mandates - Hearthwick (Micro-MMO)

## Project Vision
A **micro cosy metaverse** — a living, persistent fantasy world (Stardew Valley meets L.O.R.D.) with Blaseball-style community storytelling. $0/month infrastructure goal.

## Core Mandates
- **Bundle Size:** Keep bootstrap JS < 100KB (Phase 1) / < 175KB (Full Yjs). Current: **154.1KB**.
- **Determinism:** All game logic MUST be deterministic. Reconstructable from `world_seed` + `event_log`. 
- **Math:** **Integer math only.** No floats to avoid platform drift.
- **Randomness:** Use `seededRNG` (mulberry32) derived from `daily_seed`. Never use `Math.random()`.
- **Memory:** Pi Zero W constraint (512MB). Arbiter and LLM (RWKV7) must run in sequence via cron, never simultaneously.
- **Security:** Ed25519 action signatures (WebCrypto) + Peer validation + Pi Arbiter rollback.

## Current Iteration (v0.4.0 - Hearthwick Pivot)
- [x] Initial Text-MUD foundations with Trystero (@trystero-p2p/torrent).
- [x] Yjs CRDT state syncing.
- [x] Raspberry Pi Node.js v18 environment setup.
- [x] Arbiter signing foundation (tweetnacl).
- [x] Auto-deploy pipeline (Tailscale + SSH).

## Roadmap & Iterations

### Iteration 1.5: Seed & Determinism (CURRENT)
- [ ] Implement `seededRNG` (mulberry32) and `world_seed` generation.
- [ ] Refactor `rules.js` for integer math and event-log sourcing.
- [ ] Implement `event_log` (Y.Array) append logic.

### Iteration 2: Persistence & Local State
- [ ] WebCrypto Ed25519 key generation on first visit.
- [ ] Signed player snapshots stored in `localStorage`.
- [ ] GitHub Pages `state.json` cold recovery fetch.

### Iteration 3: Narrative Simulation
- [ ] Transition tables for Arcs (Plain JS).
- [ ] Markov mood chains for the town.
- [ ] Season clock logic.

### Iteration 4: Narrative Engine (Micro-LLM)
- [ ] RWKV7-0.4B setup on Pi.
- [ ] Cron logic: stop Node -> run llama.cpp -> apply delta -> start Node.
- [ ] "The Ticker" UI element in the client.

### Iteration 5: Security & Anti-Cheat
- [ ] deterministic validation of peer moves in `src/main.js`.
- [ ] Arbiter rollback and blacklist broadcast.
- [ ] PWA Manifest for standalone installation.

### Iteration 6: Visuals
- [ ] Kontra.js integration.
- [ ] 2D Zelda-style tile rendering from Yjs state.
