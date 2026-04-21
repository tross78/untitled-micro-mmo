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

## Implementation Phases (DONE: 1, 2, 3)

### Phase 4: The "Commissioner" (LLM) (CURRENT)
- [ ] Setup `llama.cpp` and RWKV7-0.4B on Pi (ARMv6 build).
- [ ] Create the "Nightly Cron" bash script.
- [ ] Implement "The Ticker" UI element.

### Phase 5: Anti-Cheat & Security
- [ ] Ed25519 Action Signatures for `/move`.
- [ ] deterministic validation in `getMove` action handler.
- [ ] Pi blacklisting and rollback logic.

### Phase 6: Graphical Client (Visuals)
- [ ] Kontra.js renderer.
