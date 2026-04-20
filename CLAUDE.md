# Claude Context & Implementation Notes - Micro-MMO

## Architecture Summary
A "botnet-style" P2P MMO using Trystero for zero-cost signaling and a Raspberry Pi Zero W as a trusted arbiter. Text-based (MUD) first, graphics later.

## Critical Design Decisions
- **No Native Chat:** Following the Blaseball model. Communication happens via actions/events and external community tools.
- **Trackerless Signaling:** Trystero abstracts WebRTC matchmaking via public BitTorrent trackers and Nostr relays.
- **Micro-LLM on Pi Zero W:** Using `llama.zero` (ARMv6) to generate "Commissioner-style" global narrative events at 0.5 tokens/sec.
- **Security:** Each client runs the same deterministic ruleset. Peers validate each other's actions locally before state merging.

## Dependency Management
- **Yjs:** Providing the CRDT layer for world/player state.
- **Trystero:** Primary networking layer. Use BitTorrent strategy for $0 cost.
- **werift:** WebRTC polyfill for the headless Node.js Arbiter.
- **tweetnacl:** For Ed25519 signing (security/anti-cheat).
- **Esbuild:** Bundle size is currently **125.9KB**. Target is <150KB.

## Current Environment
- **Node v18+**
- **Esbuild** for bundling
- **Bootstrap Bundle:** 125.9KB (Target: <150KB)
- **Repo Root:** `/Users/tysonross/Documents/GitHub/untitled-micro-mmo`

---

## Roadmap & Implementation Phases

### Phase 1: Text-MUD Foundations (DONE)
- [x] Basic Trystero room matchmaking using BitTorrent DHT.
- [x] Command-line interface (`/move`, `/look`, `/who`).
- [x] Bundle cleanup (removed chat, removed unused WebTorrent imports).

### Phase 2: Persistence & Local State (DONE)
- [x] Implement `Yjs` for synchronizing the inventory and global world flags (e.g., "Door is unlocked").
- [x] Add `localStorage` hooks to save/load player name and location automatically.
- [x] Implement a "State Discovery" protocol where new joiners receive the full `Yjs` doc from existing peers.

### Phase 3: The "Commissioner" (Arbiter Node) (DONE)
- [x] Create `arbiter/index.js` which joins the Trystero network as a headless peer using `werift`.
- [x] Master Key Generation: Ed25519 keypair used to sign official broadcasts.
- [x] Signed Event Loop: The Arbiter periodically broadcasts signed narrative events.
- [x] Client Verification: Clients use the Master Public Key in `src/constants.js` to verify events before display.

### Phase 4: Narrative Engine (Micro-LLM)
- [ ] Setup the `llama.zero` binary on the Pi (ARMv6 optimization).
- [ ] Connect the LLM output to the Arbiter's signed broadcast loop.
- [ ] Add the "Ticker" UI element to `index.html`.

### Phase 5: Security & Anti-Cheat
- [ ] Extract all game logic (room definitions, valid moves, combat math) into `src/rules.js`.
- [ ] Implement Ed25519 signatures for all player-driven actions.
- [ ] Peers validate each other's movements against `src/rules.js` and public keys.
