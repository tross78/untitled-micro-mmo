# **Claude Context & Implementation Notes \- Hearthwick**

## **Architecture**

A serverless P2P browser MMO. Trystero (WebTorrent/WebRTC) for transport, Ed25519 for identity, a Pi Zero W as the Arbiter (state authority). No server-side game logic — the Arbiter only signs world state and validates rollups.

## **Source Layout**

| File | Purpose |
| :---- | :---- |
| src/main.js | Main orchestrator — initialization and UI event binding. |
| src/rules.js | Pure deterministic simulation (combat, world, sharding, NPCs). |
| src/data.js | Externalized game data (locations, enemies, NPCs, items, quests). |
| src/store.js | Centralized shared mutable state and persistence. |
| src/networking.js | Trystero P2P logic, shard management, and rollup sync. |
| src/commands.js | Command interpreter and game-loop logic (combat, NPCs, bank). |
| src/crypto.js | Universal Ed25519 sign/verify. |
| src/packer.js | Binary serialization for high-frequency messages. |
| src/iblt.js | Invertible Bloom Lookup Table for set reconciliation. |
| src/constants.js | Identity-derived APP\_ID, tracker/STUN/TURN URLs. |
| src/autocomplete.js | getSuggestions(input, context) — pure autocomplete. |
| src/ads.js | Foundational architecture for optional rewarded ads. |
| src/ui.js | Juiced logging and visual effects (shake, CRT glow). |
| arbiter/index.js | Pi Zero: state authority, day tick, rollup validation, fraud/ban. |
| src/\*.test.js | Comprehensive test suite for all modules. |

**Production build:** npm run build — esbuild bundles src/main.js into a single dist/main.js.

## **Key Implementation Details**

### **Seed-Based Determinism**

* World state is world\_seed \+ day only (Yjs is gone).  
* All randomness uses seededRNG(hashStr(...)) (mulberry32 variant). **Never use Math.random().**  
* Integer math only in simulation (no floats in damage/XP).

### **Universal Cryptography (src/crypto.js)**

* **Browser:** window.crypto.subtle (WebCrypto). verifyMessage requires a CryptoKey from importKey().  
* **Node (Pi):** node:crypto. verifyMessage accepts a raw Base64 string or Buffer.  
* Player identity: Ed25519 key pair generated on first visit, stored in localStorage under hearthwick\_keys\_v3.  
* ph (8-char hex) \= (hashStr(pubKeyBase64) \>\>\> 0).toString(16).padStart(8,'0'). It is NOT a key — never pass it to verifyMessage.

### **Memory Optimization (Pi Zero W)**

* 512MB RAM constraint. Arbiter logic must be O(1) or O(log n) per event.  
* Nightly sequential pattern: pm2 stop arbiter → run llama.cpp → pm2 start arbiter.

## **Current Status**

### **Phase 4: UX — Mobile & Input (COMPLETE)**

* Autocomplete engine (src/autocomplete.js) with getSuggestions(input, context)  
* Suggestion chips UI (up to 4, tappable, Tab-cycles on desktop)  
* /move \<dir\> autocomplete shows valid exits; tapping moves immediately  
* Mobile layout: env(safe-area-inset-bottom), position: fixed input bar  
* Quick-action bar: look / attack / rest / inventory (visible on pointer: coarse only)  
* visualViewport resize handler for virtual keyboard reflow

### **Phase 4.1: Developer Tidy Up & Modularity (COMPLETE)**

* Split the large src/main.js monolith into smaller, logical modules.  
* Maintained a compact production build via esbuild.

### **Phase 4.2: Data Externalization (COMPLETE)**

* Extracted game name, locations, and entities into src/data.js.

### **Phase 4.3: Gameplay Improvements (COMPLETE)**

* Added NPC system (Barkeep, Merchant, Sage, Guard).  
* Implemented Quests, Daily Fight limits, and a Bank in the Cellar.

### **Phase 4.4: Ads Architecture (COMPLETE)**

* Implemented foundational architecture with optional rewarded "visions" via the Bard.

### **Phase 4.5: UI/UX Modernization (COMPLETE)**

* "Juiced Retro" aesthetic: CRT glow, fade-in animations, and screen shake on damage.  
* Sparse emoji support for stats and alerts.

### **Phase 4.6: Scaling & Regression Audit (COMPLETE)**

* Deep architectural review for 50k player scale.  
* Implemented debounced saveLocalState to prevent UI micro-stutters.  
* Fixed NPC dialogue "flicker" via per-day deterministic stability.  
* Documented 50k scaling roadmap in scaling-50k-architecture.md.

### **Phase 4.7: Input Refinement (COMPLETE)**

* Implemented dynamic, context-aware **Action Buttons** (A Dark Room style).  
* Buttons automatically update based on room exits, enemies, NPCs, and current state.  
* Refined the command parser to be case-insensitive and make the leading / optional.  
* Maintained legacy CLI text input and chip suggestions for chat and power users.

### **Phase 4.8: UI Chip Interface & Secure P2P Progression (COMPLETE)**

* Migrated to a mobile-first, drill-down chip interface.
* Expanded world map with 8 new balanced indoor/outdoor environments.
* Added new enemies and loot.
* Implemented strict Peer Validation (PvE) via signed `action_log` packets.
* Added deterministic combat verification and shadow-tracking to prevent local state hacking.

### **Phase 4.9: Consistency & Quality of Life (COMPLETE)**

* Persistent Status Bar added to UI for constant vital monitoring.
* Full UI drill-down chips for banking and quest management.
* Auto-equip logic in combat math for optimal gear usage.
* Added item stat displays directly on chips.
* Implemented developer tools: `window.devReset()`, cheat commands (`/addxp`, `/addgold`, `/spawnitem`), and a network debug log toggle.

### **Phase 4.9.5: Gameplay Depth & UI Flourishes (COMPLETE)**

* Combat mechanics: Critical Hits (~10%), Dodges (~7%), and a `Flee` command.
* UI Immersion: ASCII health bars and color-coded entities (enemies/items).
* Gameplay loops: "Well Rested" buff from the Tavern, temporary stat buffs (Strength Elixir), and scaling enemy threat based on the Arbiter's `threatLevel`.
* Context-sensitive "Repeat Action" memory chip.

### **Phase 5: Stochastic NPC Dialogue (Markov) (COMPLETE)**

* Implemented a custom deterministic, seeded Markov chain generator (`src/markov.js`).
* Added character voice corpora for Barkeep, Merchant, Sage, and Guard (`src/data.js`).
* Added "The Ticker", a subtle fading sub-header UI for procedurally generated ambient world lore synced across all peers.

### **Phase 6: Advanced Anti-Cheat & Secure Trading — TODO**

* Ed25519 signatures on `/move` actions.
* Deterministic move validation in `getMove` handler to prevent teleportation.
* Secure multi-sig `trade_commit` protocol for P2P item/gold exchanges.
* Arbiter side: Enhanced fraud proofs and rollback logic for compromised game instances.

### **Phase 7: Graphical Foundations & Fixed Spatial Entities — TODO**

* Decouple the DOM-based UI into a generic event-driven EventBus system.
* Implement a 2D grid/tile-based coordinate system alongside the existing room graph.
* Move from "entities exist in a room" to "entities have fixed, trackable spatial coordinates (x, y)".
* Expand `/move` to handle micro-movements within rooms and proximity-based interactions.

### **Phase 8: Full Graphical Client — TODO**

* Renderer Integration: Integrate a lightweight 2D renderer (e.g., Kontra.js or PixiJS).
* Tilemaps & Sprites: Replace the text log with rendered rooms, animated sprites, and real-time P2P position interpolation.

### **Phase 9: A/B Testing & Analytics — TODO**

* Implement anonymous, privacy-respecting telemetry for player retention and balancing.
* Add A/B testing hooks for UI layouts and combat stats driven by the Arbiter seed.

### **Phase 10: Marketing & Launch Prep — TODO**

* Onboarding/Tutorial: A smooth, visually guided "first session" experience.
* SEO & Meta Optimization for social sharing.
* Finalize monetization (refined rewarded ads) and promotional materials.

## **Key Gaps (not yet implemented)**

* **Arbiter election** — Pi is always assumed to be the sole Arbiter. No electArbiter logic exists.

## **Packer Layouts**

Presence packet (96 bytes):

\[0-15\]  Name (UTF-8, null-padded, byte-truncated to 16\)  
\[16\]  Location (index into ROOM\_MAP)  
\[17-20\] PH (4 bytes from 8-char hex)  
\[21\]   Level (Uint8)  
\[22-25\] XP (Uint32BE)  
\[26-31\] TS (48-bit: Uint16BE high word at 26, Uint32BE low word at 28\)  
\[32-95\] Signature (64 bytes, Ed25519)

DuelCommit packet (70 bytes):

\[0\]    Round (Uint8)  
\[1\]    Damage (Uint8)  
\[2-5\]  Day (Uint32BE)  
\[6-69\] Signature (64 bytes)

All multi-byte DataView fields are big-endian. Always pass false explicitly.

## **Fraud Proof Format**

JavaScript

// witness.presence must include disputedRoot to prevent replay attacks  
{  
  rollup: { rollup, signature, publicKey },  
  witness: {  
    id: selfId,  
    presence: { name, location, ph, level, xp, ts, disputedRoot: rollup.root },  
    signature: string,   // Ed25519 sig over JSON.stringify(presence)  
    publicKey: string,   // Base64 public key of the witness  
  }  
}

Arbiter checks presence.disputedRoot \=== rollup.root before accumulating the report.

## **Proposer Election**

JavaScript

const all \= Array.from(players.keys()).concat(selfId).sort();  
const slot \= Math.floor(Date.now() / ROLLUP\_INTERVAL) % all.length;  
// Primary: all\[slot\] \=== selfId  
// Fallback: if lastRollupReceivedAt \> 1.5× interval, all\[(slot+1) % all.length\] \=== selfId

* Don't propose if alone (all.length \< 2\) — prevents Arbiter spam.  
* createMerkleRoot is **lazy-imported** inside the rollup interval. Don't move it to top-level imports.  
* buildLeafData() in networking.js filters selfId from players before pushing self explicitly — prevents double-leaf fraud false-positives.

## **Arbiter Notes**

* Day tick: scheduleTick() (recursive setTimeout targeting last\_tick \+ 86400000). On restart it loops to catch up all missed days before scheduling the next real tick.  
* Rate limiting: one rollup per public key per ROLLUP\_INTERVAL \* 0.8 ms (lastRollupTime map).  
* Ban persistence: worldState.bans \= Array.from(bans) written before every schedulePersist().  
* Peer join: sends state only to the new peer (sendState(packet, \[peerId\])), not a full broadcast.  
* Maps lastRollupTime and fraudCounts are purged hourly to prevent unbounded growth on Pi Zero.  
* doReset() clears fraudCounts and lastRollupTime. 