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
| src/ui.js | Action button renderer, status bar, radar. |
| src/renderer.js | 2D canvas renderer — tiles, sprites, HUD, dialogue, overlays. |
| src/graphics.js | Procedural tile/sprite drawing primitives (ALttP palette). |
| src/input.js | ACTION constants and InputManager (keyboard + gamepad). |
| arbiter/index.js | Pi Zero: state authority, day tick, rollup validation, fraud/ban. |
| src/\*.test.js | Comprehensive test suite for all modules. |

**Production build:** npm run build — esbuild bundles src/main.js into a single dist/main.js.

## **Post-Implementation Verification Protocol**

Run this checklist after implementing any phase. Do not mark a phase complete until all checks pass.

### **1. Build**
```
npm run build
```
Must produce `dist/main.js` with zero errors and zero warnings. Note the bundle size — flag if it grows more than 20KB unexpectedly.

### **2. Test suite**
```
npm test
```
All suites must pass. Zero regressions. If a test is newly broken, fix the root cause — do not delete or skip the test. If new behaviour is untested, add tests before marking the phase done.

### **3. Static checks — things the test suite cannot catch**

After any change to these files, manually verify the following:

**`src/renderer.js`**
- `renderWorld()` is called with a valid `state` object and does not throw when `worldState.seed` is `''` (offline/first-load case).
- All overlay functions (`showDialogue`, `showToast`, `showItemFanfare`, `showRoomBanner`, `triggerHitFlash`) are exported and callable without crashing when the canvas has not yet been initialised.
- Canvas click handler: NPC tile → `{type:'npc', id}`, enemy tile → `{type:'enemy'}`, empty tile → `null`. Verify the `npcTiles` Map is rebuilt on every render call, not cached between calls.
- Dialogue open state (`isDialogueOpen()`) blocks canvas click-through correctly.

**`src/commands.js`**
- Kill quest progress uses `q.objective.target` / `q.objective.count`, never flat `q.target` / `q.count`.
- `statusEffects` is always accessed with optional chaining (`?.find`, `?.filter`) or guarded with `if (!localPlayer.statusEffects) localPlayer.statusEffects = []` before mutation.
- `forestFights` is checked before allowing combat. Combat at night is blocked (check `getTimeOfDay()`).
- All `bus.emit()` calls use the canonical payload shapes listed in §Bus Event Payloads below.

**`src/data.js`**
- Every `exitTile` entry: `destX < world[dest].width` and `destY < world[dest].height`. The rules.test.js suite enforces this — do not remove that test.
- Every room referenced in `exits` exists as a key in `world`.

**`src/graphics.js`**
- No calls to `Math.random()`. All randomness via `tileRng(seed)`.
- `generateCharacterSprite` and any new designed sprite functions operate on `OffscreenCanvas` — must not reference `document` or `window` (test environment is Node).

**`src/audio.js`**
- All exported play functions are no-ops when `AudioContext` is unavailable (Node/test environment). Guard: `if (!audioCtx) return`.

**`src/networking.js` / `arbiter/index.js`**
- No `Math.random()` in simulation paths. Arbiter logic remains O(1) or O(log n) per event.

### **4. Bus event payload shapes**

All `bus.emit()` calls must match these shapes exactly. Listeners in `main.js` destructure these — a shape mismatch causes silent undefined bugs.

| Event | Payload |
|-------|---------|
| `combat:hit` | `{ attacker, target, damage, crit }` |
| `combat:dodge` | `{ attacker, target }` |
| `combat:death` | `{ entity, loot }` |
| `player:levelup` | `{ level }` |
| `player:move` | `{ from, to }` |
| `item:pickup` | `{ item }` — full item object from ITEMS |
| `npc:speak` | `{ npcName, text }` |
| `quest:progress` | `{ name, current, total }` |
| `quest:complete` | `{ name, rewards }` |
| `input:action` | `{ action, type: 'down'|'up' }` |

### **5. Regression smoke-list**

Check that these gameplay paths still work end-to-end after any phase:

- [ ] Player loads with empty `worldState.seed` — NPCs visible, exits visible, no crash.
- [ ] `talk <npcId>` triggers dialogue box on canvas (not log).
- [ ] `attack` with an enemy present decreases enemy HP; kill quest progress updates.
- [ ] `move north` (and other dirs) transitions room, room name banner appears on canvas.
- [ ] `rest` in the tavern applies well-rested buff without crashing if `statusEffects` is undefined.
- [ ] `craft` command at a valid location shows recipe list; crafted item appears in inventory.
- [ ] `vision` command works without ENABLE\_ADS — fallback meditation path grants +3 fights.
- [ ] Picking up an item shows item fanfare overlay on canvas.
- [ ] Level up shows level-up overlay on canvas.
- [ ] Backtick toggles radar dev view. Tilde reveals debug log. Neither crashes.
- [ ] Bandit Camp is reachable from Forest Depths and player spawns within room bounds.
- [ ] `npm run build` after the smoke-list still produces zero errors.

---

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

### **Phase 7: Graphical Foundations & Spatial Entities — COMPLETE**

* EventBus (`src/eventbus.js`) replaces all `window.dispatchEvent` custom events.
* 2D tile coordinate system (x, y) per room — all entities have spatial positions.
* `stepPlayer()` handles tile-by-tile movement with room-edge transitions.
* Canvas renderer (`src/renderer.js`) draws tiles, sprites, exits, scenery, HUD strip.
* Procedural pixel-art sprites via `src/graphics.js` (ALttP-inspired palette).
* `InputManager` (`src/input.js`) — keyboard + gamepad → ACTION constants → bus.
* Exit tiles replace portals; void tiles render correctly for sub-viewport rooms.
* NPC and enemy canvas click detection — click sprite to interact/attack.

### **Phase 7.5: Graphical Groundwork, Audio, Persistence — COMPLETE**

* Audio system (`src/audio.js`) — procedural Web Audio tones for hit, crit, level-up, pickup, portal, death.
* IndexedDB persistence layer (`src/persistence.js`).
* Radar dev view — backtick toggles between canvas and ASCII radar.

### **Phase 7.75: Zelda-Style Canvas Feedback — COMPLETE**

Direction: eliminate the MUD text log from normal gameplay. All moment-to-moment feedback moves onto the canvas. The log (`~` to reveal) becomes a debug/power-user tool only.

**Completed this phase:**
* Scenery emoji labels — replaced opaque single chars (t, C, P…) with 📦🌲🏛🔥 etc.
* Craft ⚒️ button in action menu at locations with available recipes.
* Vision 🔮 works without ENABLE\_ADS — falls back to +3 fights via meditation flavour text.
* Daily fights (⚡) shown in status bar at all times.
* Night/dusk/dawn canvas tint + time-of-day icon in canvas corner.
* Keyboard shortcut reference in Config menu.
* Exit tile out-of-bounds bug fixed — bandit\_camp destY corrected; regression test added.
* Regression test suite expanded: kill quest objective path, empty-seed NPC visibility, statusEffects crash paths, canvas click resolution, shortName article stripping.
* **NPC dialogue box** — on `npc:speak` bus event, render a Zelda-style bottom panel on the canvas (dark bar, NPC name, wrapped text, ▼ dismiss prompt). Space/click to advance. Replaces log lines.
* **Item fanfare overlay** — on `item:pickup`, flash "You got [Item]!" centered on canvas for ~1.5s (like Link raising a found item). Auto-dismisses.
* **Level-up overlay** — on `player:levelup`, brief full-canvas card ("⬆ Level 4!") for ~2s.
* **Room name banner** — on `player:move` (room change), fade-in location name at canvas top for 2s. Replaces `look` log header.
* **In-canvas HUD strip** — draw HP, gold 💰, ⚡ fights inside the canvas (top or bottom strip). Remove the HTML `#status-bar` element — HUD lives on canvas only.
* **Combat hit flash** — on `combat:hit`, tint enemy sprite red for ~200ms via canvas overlay rect. On enemy dodge, show brief "MISS" float text. No damage numbers.
* **Log hidden by default** — revert `#debug-console` to `display:none`. Canvas events cover all gameplay moments. `~` reveals for debugging.
* **Remove `> command` echo** — strip `log(\`> ${cmdOrAction}\`)` from main.js button handler.
* **Ambient Ticker** — moved from HTML element to canvas overlay (top strip, italicized lore text).

### **Phase 7.8: State of the Game — Retrospective & Pre-Phase 8 Tuning — COMPLETE**

This phase is a deliberate pause before the large Phase 8 graphical push. No new systems. Take stock of what's here, what hurts, and what is genuinely interesting about the project so we can sharpen our focus before the next sprint.

---

#### **What works well**

**Canvas overlay pipeline.** The progression from HTML log → chip UI → full canvas feedback (7.75) landed cleanly. Dialogue boxes, toasts, item fanfares, room banners, hit flashes, and the ambient ticker all coexist without conflict. The pattern of bus events driving canvas overlays is the right architecture and scales to Phase 8 without redesign.

**Procedural everything.** No external asset files. Sprites, tiles, and audio are all generated at runtime from seeded RNG and WebAudio oscillators. This is genuinely rare in a browser game and means the entire game ships as a single bundled JS file. That constraint has been a creative forcing function, not a limitation.

**P2P serverless architecture.** Ed25519 identity, Trystero transport, a Pi Zero W as Arbiter — this is not a tutorial project. The design is principled: the Arbiter only signs and validates; it does not simulate. Rollup/fraud-proof/proposer-election logic is solid. The architecture could support thousands of players without a cloud bill.

**Seeded determinism.** Keeping all simulation logic in `seededRNG(hashStr(...))` means two peers with the same seed will always produce the same world. This is load-bearing for P2P trust and is worth protecting in every future phase.

**Event bus.** Replacing `window.dispatchEvent` with the typed `bus` was the right call. Payloads are documented, shapes are enforced in tests, and new systems can subscribe without touching existing code.

---

#### **What isn't so good**

**Two input paradigms, unresolved tension.** The game has a command interpreter (MUD heritage) and a chip/button UI (mobile-first) running in parallel. They were never fully unified. The chip UI covers the happy path; the CLI handles edge cases. This ambiguity leaks into the UX — power users type, casual players tap, and neither path feels complete. Phase 8's canvas D-pad will displace the chip UI, but the CLI layer will need a clear decision: keep as a debug tool (like the log) or surface it intentionally.

**Teleporting movement.** Player position snaps tile-to-tile with no interpolation. Every other piece of the canvas pipeline is polished; this stands out. Even a 100ms linear lerp (no physics, no easing) would make the world feel inhabited rather than mechanical.

**NPCs don't exist spatially.** NPCs have positions in data but they never move. They are statues with dialogue. One or two tiles of idle wandering, even deterministic (seeded per-day), would make the world feel alive at almost no implementation cost.

**Combat is shallow.** Hit, crit, dodge, flee. The fight counter creates a resource loop but there's no tactical decision inside a fight. This is fine for a pre-Phase 8 state but risks feeling thin once visuals improve and players notice there's nothing to do but watch the numbers.

**The world is small.** A handful of rooms. Phase 4.8 expanded it, but most rooms are variations on the same grammar (grass, enemy, exit). There are no environmental puzzles, no rooms that feel distinct from each other beyond the name banner.

**Phase 6 is still TODO.** Ed25519 signatures on movement, secure trading, deterministic move validation — none of this exists yet. The fraud-proof architecture is built but not wired to the simulation paths. Until it is, a determined bad actor can teleport or dupe gold.

---

#### **What is genuinely innovative — and how to emphasise it**

**"No server, no sprites, no bullshit."** The combination of serverless P2P + procedural graphics + procedural audio in a browser MMO is novel. Other browser MMOs either use WebSockets to a game server or load sprite atlases. This game does neither. That should be the lead when anyone asks what it is.

*How to emphasise it:* The bundle size is a living proof-point. Keep it visible (log it on build). Consider a small `?debug` HUD overlay that shows peers connected, Arbiter latency, and bundle size — not for players, but for anyone evaluating the tech.

**The Pi Zero W Arbiter.** A $15 computer as the sole authoritative game server for a potentially large player base is a great story. The nightly Arbiter → llama.cpp → Arbiter handoff (for future NPC AI) is a clever architectural trick.

*How to emphasise it:* Document it visually in the README. A simple diagram of the P2P topology with the Pi at the center is more compelling than paragraphs.

**Seeded shared world.** All players on the same day see the same procedurally generated world without any server sync for world state. This is the core P2P insight.

*How to emphasise it:* Make it legible to the player — show the current world seed and day in the debug view (already partially there). Consider a "world fingerprint" visible in the UI: a short hash that changes daily, so players know when they're in sync.

---

#### **What to do before Phase 8**

These are small, targeted improvements that reduce Phase 8 scope and make the current build feel more complete. None require architectural changes.

1. **Sprite movement lerp.** Add `prevX/prevY/moveStart` tracking per entity in `renderer.js`. On each `renderWorld()` call, interpolate draw position for 100ms after a move. Logical position updates immediately — this is purely visual. (~50 lines in renderer.js, no new data structures.)

2. **Two or three authored sprite silhouettes.** The player character, the wolf enemy, and a guard NPC are the most-seen entities. Give each a hand-defined pixel array in `graphics.js` (8×16, 4 columns = 4 frames). Keep the procedural color tinting from `seededRNG`. This immediately distinguishes "is that me or another player?" without touching the procedural tile system.

3. **NPC idle wander.** One seeded `npcWanderOffset(npcId, day, tick)` function returns a ±1 tile delta. Apply it in `renderWorld()` when drawing NPC sprites. NPCs stay within their room, drift a tile or two, then drift back. No pathfinding, no bus events, no gameplay impact — purely cosmetic.

4. **World: one distinct room.** Add one room that uses `tileOverrides` to feel deliberately designed — a library, a dungeon cell, a market stall. Not for gameplay, just to prove the authored set-dressing system works and to give Phase 8 a reference point for what "authored" looks like next to "procedural."

5. **Unify the input model decision.** Decide explicitly: the CLI text input is a debug/power-user tool (hidden by default, `~` to reveal, like the log). Document this in `CLAUDE.md`. This lets Phase 8 build the D-pad without hedging against two input systems.

6. **Phase 6 minimal viable wire-up.** Sign `move` actions with the player's Ed25519 key and validate on receipt. Not the full fraud-proof/rollback system — just enough so the architecture claim is partially true and Phase 6 can be marked partial-complete rather than fully TODO.

---

### **Phase 8: Full Zelda-Style Graphical Client — TODO**

Target feel: ALttP / Link's Awakening. No visible text log during play. All feedback is spatial, animated, and momentary.

**Sprite system (hybrid designed + procedural):**
* Character/enemy/NPC sprites are **authored** — palette-indexed pixel arrays defined in `graphics.js`, drawn onto `OffscreenCanvas` at init. No external image files; everything stays in the JS bundle.
* Each designed sprite has 4 frames: idle, walk-A, walk-B, attack. Stored as parallel frame arrays per entity type.
* Terrain tiles (grass, stone, water, brick) stay **fully procedural** seeded-RNG — they tile across hundreds of cells and authored art would be repetitive.
* Scenery objects (barrel, crate, altar) get designed silhouettes but procedural color/position variation.
* Unknown peer sprites fall back to the existing hash-identicon generator (`generateCharacterSprite`) — they should look alien/unknown, and that's intentional.
* Palette swapping per instance — wolf sprite uses the wolf shape but color is tinted from `seededRNG(hashStr(entityId))`, giving variation while preserving the designed silhouette.

**Kontra.js-inspired patterns (no library — steal the ideas):**
* `Animator` class (~25 lines) in `graphics.js` — holds frame array, fps, elapsed time; `update(dt)` advances; `frame()` returns current `OffscreenCanvas`. Used by renderer for all animated entities.
* Idle RAF render loop (`startRenderLoop()` in `renderer.js`) — runs continuously only while animation state is active (tweens, particles, dialogue typewriter). Stops automatically when everything is settled, resuming on next state change. Keeps battery-friendliness of the current on-demand model.
* Object pool (`src/pool.js`, ~20 lines) — fixed-size ring buffer for short-lived objects: floating text, weather particles, hit sparks. Avoids GC pressure during combat.
* Sprite tween — renderer tracks `{ prevX, prevY, moveStart }` per entity. During the ~100ms tween window, draw position interpolates; logical position updates immediately (no gameplay impact).

**Renderer / visuals:**
* Smooth tile movement — tween player sprite across 1 tile in ~100ms. Other players interpolated the same way using their last two received positions.
* Sparse tile overrides — `data.js` gets an optional `tileOverrides` array per room (e.g. `{x:3,y:4,type:'rug'}`). Renderer checks overrides before the procedural pass. Allows authored set-dressing without replacing the procedural system.
* Dynamic lighting — at night, draw a `createRadialGradient` vignette (opaque dark → transparent) centered on player. Torches in `scenery` extend the lit radius. Drawn as a canvas overlay after the tile pass.
* Weather layer — occasional rain or snow: short-lived particle objects from the pool, drawn as a final canvas pass. No game logic impact.

**HUD (canvas-native, no HTML):**
* Heart containers for HP (whole/half/empty, ALttP style) — drawn as designed pixel sprites, not emoji. Hearts drain/refill with a brief scale-pulse animation via `Animator`.
* Rupee-style gold counter (bottom-left) — digit roll animation on change (Kontra-inspired `counter` tween).
* ⚡ fight counter (bottom-right, dims to grey at 0).
* Active status effect icons (poison skull, well-rested moon) with duration pip dots beneath.
* `#status-bar` and `#ticker` HTML elements removed entirely. Canvas is the sole display.

**Dialogue system (canvas-native):**
* Bottom-of-canvas dialogue box: dark panel, NPC portrait sprite (left, from designed sprite set), name tag, text body.
* Typewriter effect — character-by-character at ~30ms/char, driven by the RAF loop while active.
* Multiple dialogue pages: ▼ advance prompt, Space/click/tap to continue. Already wired in Phase 7.75.
* Quest accept/decline flows render inside the dialogue box as A/B choice prompts.

**Notification system:**
* `showToast(message)` — already implemented in 7.75. Phase 8 adds icon sprite left of text.
* `showItemFanfare(itemName)` — already implemented. Phase 8 upgrades to show the item's designed sprite centered above the text.
* `showFloatingText(wx, wy, text, color)` — pooled object, floats upward ~1 tile over 800ms then fades. Used for "MISS", status effect names. No damage numbers.

**Mobile controls:**
* Virtual D-pad (bottom-left canvas overlay, touch only) — semi-transparent, fires `input:action` bus events. Rendered directly on canvas, not HTML.
* Context "A" button (bottom-right) — interact/attack/confirm depending on what's adjacent.
* Text input removed from primary flow. Chat is an explicit "Say 🗣️" button → native `prompt()` → P2P emote.

**Audio:**
* Zone BGM — `playBGM(zoneType)` builds a looping arpeggio/chord sequence via `setInterval` + 2-3 oscillators. Zone types: `grass`, `dungeon`, `town`. `stopBGM()` fades gain over 500ms; `playBGM(newZone)` fades in — crossfade on room transition.
* Footstep sounds — short noise burst (~30ms) on each tile step, pitched by tile type (higher/crisper for stone, duller for grass). Gated to max 1 per 150ms.
* Hit SFX upgraded — noise burst layer under oscillator for meatier impact.

**Phase 9 (unchanged):** A/B testing and anonymous telemetry.
**Phase 10 (unchanged):** Onboarding, SEO, monetization finalization.

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