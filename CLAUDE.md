# Claude Context & Implementation Notes - Hearthwick

## Architecture
A serverless P2P MMO using Yjs for state, Trystero for signaling, and a Pi Zero W for narrative generation (RWKV7).

## Key Implementation Details

### Seed-Based Determinism
- Simulation state is `world_seed` + `event_log` (Y.Array).
- All randomness uses `mulberry32` with integer math only.

### Universal Cryptography (`src/crypto.js`)
- **Browser:** `window.crypto.subtle` (WebCrypto).
- **Node (Pi):** `crypto` module (via `await import('crypto')`).
- Player identity: Ed25519 generated on first visit, stored in `localStorage`.

### Memory Optimization (Pi Zero W)
- 512MB RAM constraint.
- Nightly sequential pattern: `pm2 stop arbiter` -> run `llama.cpp` -> `pm2 start arbiter`.

## Known Bugs Fixed
- **`move` event `from` field** was always equal to `to` — captured `prevLoc` before mutation.
- **Mood never propagated** — `updateSimulation()` now calls `yworld.set('town_mood', ...)` after seeded RNG step.
- **`verifyMessage` Node path** — raw 32-byte public key wrapped in SubjectPublicKeyInfo DER for OpenSSL 3.
- **`signMessage` Node path** — raw 32-byte seed (or first 32 bytes of 64-byte tweetnacl key) wrapped in PKCS8 DER.
- **Arbiter relay DNS** — preflight filters `0.0.0.0`-resolving relays before passing to Trystero.
- **`dotenv` path** — explicit `import.meta.url`-relative path.
- **Double Yjs broadcast** — `ydoc.on('update')` was registered once per room; now a single listener sends over both meshes.
- **`sendMove` dead code** — now wired in `handleCommand('move')` and broadcasts over both transports.
- **Arbiter `Math.random()`** — `broadcastNews` now uses `seededRNG(hashStr(worldSeed + day + 'news'))`.
- **`y-protocols`** — removed unused dependency.

## Key Gaps (not yet implemented)
- **Arbiter election** (`electArbiter`) — Pi currently always assumed arbiter.
- **Arc machines not wired** — `arcTransitions`/`transitionArc` defined in `rules.js` but no `arcs` Y.Map in doc, never activated.
- **Season system absent** — no `season`, `season_number`, `season_seed` in world state.

## Phase 3 Features (complete)
- Combat system: `/attack`, `/stats`, `/inventory`, `/use <item>`, `/rest`
- 6 rooms: cellar, hallway, tavern, market, forest_edge, ruins
- Enemies: forest_wolf, ruin_shade, cave_troll
- Loot: wolf_pelt, old_tome, iron_key, gold, potion, iron_sword
- XP/levelling with stat scaling
- Death respawn to cellar at half HP
- Combat events in `/news` (player_kill, player_death)
- 26 determinism/regression tests (all passing)

## Implementation Phases (DONE: 1, 2, 3)

### Phase 4: The "Commissioner" (LLM) (CURRENT)
- [ ] Setup `llama.cpp` and RWKV7-0.4B on Pi (ARMv6 build).
- [ ] Create the "Nightly Cron" bash script.
- [ ] Implement "The Ticker" UI element.

### Phase 5: Anti-Cheat & Security
- [ ] Ed25519 Action Signatures for `/move`.
- [ ] Deterministic validation in `getMove` action handler.
- [ ] Pi blacklisting and rollback logic.

### Phase 6: Graphical Client (Visuals)
- [ ] Kontra.js renderer.
