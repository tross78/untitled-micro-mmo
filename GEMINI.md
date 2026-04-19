# Gemini CLI Project Mandates - Micro-MMO

## Project Vision
A serverless, P2P micro-MMO with near-zero infrastructure costs (<$5/mo), scaling to 1M concurrent users via Trystero and WebRTC.

## Core Mandates
- **Bundle Size:** Keep the bootstrap JS bundle (`dist/main.js`) under 150KB (revised to accommodate Yjs). Current: **125.9KB**.
- **Networking:** Exclusively use Trystero for P2P signaling to avoid server costs.
- **State Management:** Use Yjs CRDTs for eventual consistency across the mesh.
- **Security:** Every player action must eventually be cryptographically signed. The Arbiter Node (Raspberry Pi) is the final authority.
- **Aesthetic:** Minimalist, text-driven "Blaseball" feel. No native chat.

## Current Iteration (v0.2.0 - Persistence & CRDT)
- [x] **Zero-Cost Signaling:** Trystero integrated using the BitTorrent DHT strategy.
- [x] **Yjs Integration:** Lightweight CRDT added for world and player state.
- [x] **Persistence:** `localStorage` integration for player location and name.
- [x] **State Syncing:** Automatic Yjs update broadcasting via Trystero.
- [x] **Event Ticker:** Basic world-event observation (Blaseball style).
- [x] **No Chat:** Removed built-in chat to focus on simulation/narrative (Blaseball style).

## Roadmap & Future Iterations

### Iteration 3: The Trusted Arbiter (Pi Zero W)
- [ ] **Arbiter Protocol:** Create `arbiter/` Node.js script to "lurk" in rooms as a headless client.
- [ ] **Master Key Signing:** The Arbiter signs official "truth" messages to prevent state hijacking.
- [ ] **Conflict Resolution:** If peers disagree on state, they defer to the Arbiter's signed hash.

### Iteration 4: Narrative Engine (Micro-LLM)
- [ ] **`llama.zero` Build:** Compile ARMv6-optimized LLM runner on the Raspberry Pi Zero W.
- [ ] **Global Ticker:** Implement the "Blaseball Ticker" UI in the client.
- [ ] **Narrative Events:** The Arbiter broadcasts signed stories (e.g., "A thick fog rolls into the Hallway") generated at 0.5 tok/sec.

### Iteration 5: Security & Anti-Cheat
- [ ] **Nacl Signatures:** Implement Ed25519 signing for all player movements.
- [ ] **Deterministic Ruleset:** Move room-exit logic to a shared module (`src/rules.js`) for cross-validation by all peers.
- [ ] **Blacklisting:** The Arbiter broadcasts signed bans for peers sending invalid cryptographic actions.

### Iteration 6: Visual Layer (Phase 2 Bootstrap)
- [ ] **Kontra.js Integration:** Render the text-state into a minimalist 2D grid/tile representation.
- [ ] **Asset Pipelining:** WebTorrent distribution of tiny (<20KB) asset bundles.
