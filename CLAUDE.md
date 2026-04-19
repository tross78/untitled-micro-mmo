# Claude Context & Implementation Notes - Micro-MMO

## Architecture Summary
A "botnet-style" P2P MMO using Trystero for zero-cost signaling and a Raspberry Pi Zero W as a trusted arbiter. Text-based (MUD) first, graphics later.

## Critical Design Decisions
- **No Native Chat:** Following the Blaseball model. Communication happens via actions/events and external community tools.
- **Trackerless Signaling:** Trystero abstracts WebRTC matchmaking via public BitTorrent trackers and Nostr relays.
- **Micro-LLM on Pi Zero W:** Using `llama.zero` (ARMv6) to generate "Commissioner-style" global narrative events at 0.5 tokens/sec.
- **Security:** Each client runs the same deterministic ruleset. Peers validate each other's actions locally before state merging.

## Dependency Management
- **Yjs:** Replaced Automerge for bundle size efficiency. Provides the CRDT layer for world/player state.
- **Trystero:** Primary networking layer. Use BitTorrent strategy for $0 cost.
- **Nacl:** For Ed25519 signing (security/anti-cheat).
- **Esbuild:** Bundle size is currently **125.9KB**. Target is <150KB.

## Current Environment
- **Node v18+**
- **Esbuild** for bundling
- **Bootstrap Bundle:** 125.9KB (Target: <150KB)
- **Repo Root:** `/Users/tysonross/Documents/GitHub/untitled-micro-mmo`

---

## Roadmap & Implementation Phases

### Phase 1: Text-MUD Foundations (DONE)
- Focus: Establishing P2P connectivity without central servers.
- [x] Basic Trystero room matchmaking using BitTorrent DHT.
- [x] Command-line interface (`/move`, `/look`, `/who`).
- [x] Bundle cleanup (removed chat, removed unused WebTorrent imports).

### Phase 2: Persistence & Local State (DONE)
- Focus: Making the world feel real across sessions.
- [x] Implement `Yjs` for synchronizing the inventory and global world flags (e.g., "Door is unlocked").
- [x] Add `localStorage` hooks to save/load player name and location automatically.
- [x] Implement a "State Discovery" protocol where new joiners receive the full `Yjs` doc from existing peers via `encodeStateAsUpdate`.

### Phase 3: The "Commissioner" (Arbiter Node)
- Focus: The Raspberry Pi Zero W integration.
- [ ] Create `arbiter/index.js` which joins the Trystero network as a headless peer.
- [ ] Implement the "Master Signature" system: The client only accepts certain world-state changes if they are signed by the Arbiter's private key.
- [ ] Setup the `llama.zero` binary on the Pi to generate text events based on a slow, persistent prompt.

### Phase 4: Security & Determinism
- Focus: Preventing "Hackers" and client modification.
- [ ] Extract all game logic (room definitions, valid moves, combat math) into `src/rules.js`.
- [ ] Every action received from a peer must be passed through `rules.js` locally. If it fails, the peer is ignored or blacklisted.
- [ ] Implement Ed25519 signatures for all player-driven actions.

### Phase 5: Narrative UI & Polishing
- Focus: Immersion.
- [ ] Add the "Ticker" element to the UI.
- [ ] Implement screen-shake/color flash effects for global events (Blaseball style).
- [ ] Transition to graphical tiles using Kontra.js if the text foundation is robust.
