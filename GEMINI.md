# Gemini CLI Project Mandates - Micro-MMO

## Project Vision
A serverless, P2P micro-MMO with near-zero infrastructure costs (<$5/mo), scaling to 1M concurrent users via Trystero and WebRTC.

## Core Mandates
- **Bundle Size:** Keep the bootstrap JS bundle (`dist/main.js`) under 150KB. Current: **125.9KB**.
- **Networking:** Exclusively use Trystero for P2P signaling to avoid server costs.
- **State Management:** Use Yjs CRDTs for eventual consistency across the mesh.
- **Security:** Every player action must eventually be cryptographically signed. The Arbiter Node (Raspberry Pi) is the final authority.
- **Aesthetic:** Minimalist, text-driven "Blaseball" feel. No native chat.

## Current Iteration (v0.3.0 - The Trusted Arbiter)
- [x] **Master Keypair:** Ed25519 keys generated for the Arbiter.
- [x] **Arbiter Client:** Node.js headless client in `arbiter/` using `werift` WebRTC polyfill.
- [x] **Signed Events:** The Arbiter broadcasts signed world events every 60s.
- [x] **Cryptographic Verification:** Web clients verify Arbiter signatures using the public key in `src/constants.js`.
- [x] **Auto-Deploy:** GitHub Actions configured to push code to the Pi via Tailscale.

## Roadmap & Future Iterations

### Iteration 4: Narrative Engine (Micro-LLM)
- [ ] **`llama.zero` Build:** Compile ARMv6-optimized LLM runner on the Raspberry Pi Zero W.
- [ ] **Global Ticker:** Implement a dedicated ticker UI element in `index.html`.
- [ ] **LLM Orchestration:** The Arbiter uses the LLM to generate unique narrative strings at 0.5 tok/sec.

### Iteration 5: Security & Anti-Cheat
- [ ] **Action Signatures:** Implement Ed25519 signing for all player-driven movements.
- [ ] **Deterministic Ruleset:** Enforce validation of all incoming peer movements using `src/rules.js`.
- [ ] **Blacklisting:** The Arbiter broadcasts signed bans for peers sending invalid cryptographic actions.

### Iteration 6: Visual Layer (Phase 2 Bootstrap)
- [ ] **Kontra.js Integration:** Render the text-state into a minimalist 2D grid/tile representation.
- [ ] **Asset Pipelining:** WebTorrent distribution of tiny (<20KB) asset bundles.
