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

## Scaling Refactor (complete — v0.6.0)
- Yjs fully removed; global state is Arbiter-signed JSON
- Instance sharding via dynamic Trystero room IDs (`getShardName`)
- IBLT sketch reconciliation for ephemeral presence sync
- Binary packing (`packer.js`): move (2B), presence (96B), duelCommit (70B)
- Rotating time-slot proposer election with fallback
- O(1) fraud proofs (single signed witness, threshold accumulation)
- Arbiter: ban persistence, rate limiting, drift-corrected day tick, health endpoint
- 161 tests passing

## Implementation Phases (DONE: 1, 2, 3, Scaling)

### Phase 4: UX — Mobile & Input (CURRENT)

#### Input Model
The slash-command model works on desktop but breaks on mobile: the `/` prefix is awkward on a phone keyboard, autocorrect corrupts command names, and there is no affordance for what commands or arguments are valid.

Proposed model: **command word without slash + Tab/suggestion autocomplete**.
- Player types `use` → UI shows matching items from inventory inline
- Player types `move` → UI shows valid exit directions for current room
- Player types `attack` → UI shows current enemy if present
- Slash still accepted as an alias so existing habits aren't broken

#### Tasks
- [ ] **Autocomplete engine** (`src/autocomplete.js`) — pure function `getSuggestions(input, context)` returning ranked candidates. Context includes `localPlayer.inventory`, `world[location].exits`, `players` map, current enemy. No DOM dependency so it is fully testable.
- [ ] **Suggestion UI** — show up to 4 candidates above the input bar as tappable chips. Tapping a chip fills the input and submits. On desktop, Tab cycles through candidates, Enter submits.
- [ ] **`/use <item>`** — autocomplete resolves item display names from inventory (e.g. typing `use pot` completes to `use potion`). Player never needs to know the internal item ID.
- [ ] **`/move <dir>`** — autocomplete shows only valid exits for the current room. Tapping a direction chip moves immediately without pressing Enter.
- [ ] **`/duel <name>`** — autocomplete resolves visible player names from the `players` map.
- [ ] **Mobile layout** — fix input staying above keyboard on iOS/Android (`env(safe-area-inset-bottom)`, `position: fixed` input bar). Output area scrolls independently.
- [ ] **Touch-friendly quick-action bar** — row of icon buttons for the four highest-frequency actions: look, attack, rest, inventory. Visible only on `pointer: coarse` devices (CSS media query). Each button dispatches the same `handleCommand` path as typed input.
- [ ] **Virtual keyboard handling** — detect `visualViewport` resize events and reflow the output area height so the input is never obscured by the on-screen keyboard.

#### Design constraints
- No new dependencies. Autocomplete is vanilla JS + DOM.
- Autocomplete state is derived entirely from existing `localPlayer`, `world`, and `players` — no new network calls.
- `getSuggestions` must be a pure function so it can be unit tested without a DOM.

### Phase 5: The "Commissioner" (LLM)
- [ ] Setup `llama.cpp` and RWKV7-0.4B on Pi (ARMv6 build).
- [ ] Create the "Nightly Cron" bash script.
- [ ] Implement "The Ticker" UI element.

### Phase 6: Anti-Cheat & Security
- [ ] Ed25519 Action Signatures for `/move`.
- [ ] Deterministic validation in `getMove` action handler.
- [ ] Pi blacklisting and rollback logic.

### Phase 7: Graphical Client (Visuals)
- [ ] Kontra.js renderer.
