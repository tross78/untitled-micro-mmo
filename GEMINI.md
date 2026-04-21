# Gemini CLI Project Mandates - Hearthwick (Micro-MMO)

## Project Vision
A **micro cosy metaverse** — a living, persistent fantasy world (Stardew Valley meets L.O.R.D.) with Blaseball-style community storytelling. $0/month infrastructure goal.

## Core Mandates
- **Bundle Size:** Current: **121.1KB**. Target: < 175KB.
- **Determinism:** Seeded RNG (mulberry32) + `event_log`. 
- **Math:** **Integer math only.**
- **Memory:** Pi Zero W constraint (512MB). Sequential Node/LLM execution.
- **Security:** Ed25519 signatures (WebCrypto in browser).

## Current Iteration (v0.5.0 - Phase 3 complete)
- [x] Phase 1-3 DONE. Phase 4 is current.
- [x] Combat system: `/attack`, `/stats`, `/inventory`, `/use`, `/rest`
- [x] 6 rooms: cellar → hallway → tavern/forest_edge → market/ruins
- [x] Enemies (forest_wolf, ruin_shade, cave_troll) with XP, loot, seeded damage rolls
- [x] Player persistence: HP, XP, level, gold, inventory saved to localStorage
- [x] Death respawns to cellar at half HP; kill/death events appear in `/news`
- [x] Double Yjs broadcast fixed — single `ydoc.on('update')` listener per process
- [x] `sendMove` now wired and broadcasts over both Nostr + torrent transports
- [x] Arbiter `broadcastNews` uses seeded RNG (no more `Math.random()`)
- [x] 26 determinism/regression tests passing (`npm test`)

## Known Gaps (carry into Phase 4)
- Arbiter election (`electArbiter`) not implemented — Pi assumed permanent arbiter.
- Arc machines (`arcTransitions`) defined in `rules.js` but not wired to Yjs doc.
- Season system (`season`, `season_number`, `season_seed`) absent from world state.

## Bundle Size
- Target: < 175KB. Check after next build.

## Roadmap & Iterations

### Iteration 4: Narrative Engine (Micro-LLM) (CURRENT)
- [ ] **`llama.cpp` Setup:** Compile specialized ARMv6 build on Pi Zero W.
- [ ] **Model Download:** RWKV7-0.4B (Q4_K_M).
- [ ] **The Cron Window:** Sequential stop/run/start logic on Pi.
- [ ] **"The Ticker" UI:** Visual element in client for news.

### Iteration 5: Security & Anti-Cheat
- [ ] **Action Signing:** Sign every player `/move` with their private key.
- [ ] **Validation:** Peers verify signatures and deterministic logic in `getMove`.
- [ ] **Arbiter Oversight:** Pi detects and rollbacks invalid states.
