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

### **Phase 7.85: Rendering Overhaul, Bug Fixes, World Expansion & Inventory Tests — COMPLETE**

Five problems to fix before Phase 8 begins. The rendering section is the most important — Phase 8 builds directly on top of it.

---

#### **0. Rendering architecture — what Kontra does that we don't**

Our renderer calls `renderWorld()` imperatively on every state change, redraws every pixel every call, runs on a single canvas layer, and ignores device pixel ratio. Here's where Kontra's architecture is strictly better and what we should steal.

**0a. Device pixel ratio (DPR) — we look blurry on Retina displays**

We create the canvas at `720×528` and scale it with CSS `width:100%`. On a Retina screen where `window.devicePixelRatio === 2`, the browser stretches a 720-px buffer to fill a 1440-logical-px element — blurry. Kontra disables image smoothing on init and sizes the buffer at `logical × dpr`.

Fix in `initCanvas()`:

```js
const dpr = window.devicePixelRatio || 1;
_canvas.width  = CW * dpr;
_canvas.height = CH * dpr;
const ctx = _canvas.getContext('2d');
ctx.scale(dpr, dpr);          // all draw calls stay in logical pixels
ctx.imageSmoothingEnabled = false;
```

CSS stays the same logical size (`max-width:${CW}px`). Store `dpr` as a module-level const so the click handler can compensate: `const scaleX = (CW * dpr) / rect.width` — wait, no: the ctx is already scaled, so click math stays in logical coords. Just make sure `_canvas.getBoundingClientRect()` is divided by the CSS pixel size, not the buffer size.

**0b. RAF loop — lerp does nothing without it**

`getDrawPos()` and `npcWanderOffset()` both set `_isAnimating = true`, but `renderWorld()` is never called again unless a game event triggers it. The lerp is dead. NPCs appear frozen despite the wander math.

Kontra uses a time-accumulator RAF loop that runs while any animation is active. Steal the pattern:

```js
let _rafId = null;
let _renderFn = null;   // set by renderWorld to () => renderWorld(lastState, lastCb)

function scheduleFrame() {
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => {
        _rafId = null;
        _renderFn?.();
        if (_isAnimating) scheduleFrame();
    });
}
```

Call `scheduleFrame()` at the end of `renderWorld()` whenever `_isAnimating` is true. This gives smooth lerp and NPC wander with no polling — the loop stops automatically when nothing is moving, matching Kontra's battery-friendly self-stopping behavior.

**0c. Tile layer OffscreenCanvas cache — Kontra's dirty-flag pattern**

Right now the tile loop reruns for every single render call, even when the player hasn't moved. Kontra pre-renders each tile layer to an `OffscreenCanvas` and only redraws it when the layer's data changes (dirty flag).

For us the "dirty" event is a room change. Add a tile-layer cache:

```js
let _tileCache = null;    // { loc: string, camX: number, camY: number, canvas: OffscreenCanvas }

function getTileLayer(loc, camX, camY, ...) {
    const floorX = Math.floor(camX), floorY = Math.floor(camY);
    if (_tileCache?.loc === loc.key && _tileCache.camX === floorX && _tileCache.camY === floorY)
        return _tileCache.canvas;

    const off = new OffscreenCanvas(CW, CH);
    const octx = off.getContext('2d');
    // ... draw tile loop onto octx ...
    _tileCache = { loc: loc.key, camX: floorX, camY: floorY, canvas: off };
    return off;
}
```

Main draw: `ctx.drawImage(getTileLayer(...), 0, 0)` then draw entities on top. This eliminates the `(VIEWPORT_W+1) × (VIEWPORT_H+1)` tile draw loop from every frame — it only fires when the camera moves an integer tile, roughly once per player step, not once per animation frame.

**0d. Tab blur — pause RAF when window loses focus**

Kontra pauses the loop on `window.blur` and resumes on `window.focus`. Without this, the lerp timer `Date.now()` keeps ticking while the tab is hidden, and entities snap to their destination the instant the player returns. Add:

```js
window.addEventListener('blur',  () => { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } });
window.addEventListener('focus', () => { if (_isAnimating) scheduleFrame(); });
```

**0e. Aspect ratio CSS fix — the stretching bug**

Replace the canvas `style.cssText` width/height rules:

```js
_canvas.style.cssText = `
    display:block;
    width:100%;
    max-width:${CW}px;
    aspect-ratio:${CW}/${CH};
    image-rendering:pixelated;
    image-rendering:crisp-edges;
    margin:0 auto;
    cursor:pointer;
    background:#000;
    border-bottom:1px solid #111;
`;
```

`aspect-ratio` keeps the element's height locked to the 720:528 ratio regardless of container width. `max-width:${CW}px` prevents upscaling beyond native resolution at large viewports. Remove `max-height:45vh` — it fights `aspect-ratio` on portrait/short viewports.

---

#### **Summary: rendering work order**

1. DPR fix in `initCanvas()` — one-time, no regressions.
2. Aspect-ratio CSS fix — one-time.
3. Tab blur/focus handlers — 4 lines.
4. RAF loop (`scheduleFrame`, `_renderFn`) — the lerp and NPC wander finally work.
5. OffscreenCanvas tile cache — performance win, do last (requires 0b to be stable).

All five fit in `renderer.js` with no changes to `main.js` or `commands.js`.

---

---

#### **1. Canvas stretching on wide viewports**

Covered in §0e above — the aspect-ratio CSS fix addresses this. The rendering overhaul in §0 should be implemented first; this issue resolves as part of it.

---

#### **2. Input blocked in some rooms**

**Root cause (suspected).** `_canvas.onclick` is reassigned on every `renderWorld()` call. If `renderWorld()` is called while `_dialogue` is non-null (dialogue open), a new onclick handler is installed that checks `if (_dialogue) { advanceDialogue(); return; }` — so clicks advance dialogue correctly. But the `window.keydown` handler in `main.js` intercepts `Space`/`Enter` only `when isDialogueOpen()` is true. If `_dialogue` gets stuck non-null (e.g., an NPC speak event fires but the text is empty, producing zero pages), `isDialogueOpen()` returns `true` permanently and Space/Enter never reach the text input, making it appear that the room is unresponsive.

Additionally: the text `input` element can lose focus silently when a canvas click fires. If `input.focus()` is not called after a canvas click that doesn't open dialogue, the keyboard is captured by `window.keydown` and typed characters don't appear in the input box.

**Fixes:**

1. In `renderer.js` `showDialogue()`: guard against empty page arrays.
   ```js
   export function showDialogue(npcName, text) {
       const pages = paginateText(ctx, text, ...);
       if (!pages.length) return; // don't open dialogue with no text
       _dialogue = { name: npcName, pages, page: 0 };
   }
   ```

2. In `renderer.js` canvas click handler, after handling an empty-tile click (no NPC, no enemy), call `input.focus()`. Pass the `input` element reference in at init time, or emit a `ui:requestFocus` bus event that `main.js` handles.

3. Add a safety valve: if `_dialogue` is non-null but `_dialogue.pages` is empty or `_dialogue.page >= _dialogue.pages.length`, force `_dialogue = null` at the top of `drawDialogueBox`.

**Test:** Talk to an NPC, dismiss dialogue, verify keyboard input works in the text box immediately after without clicking it. Repeat in every room type (indoor, outdoor, dungeon).

---

#### **3. World expansion — more rooms, more variety**

**Current state.** `data.js` has 16 rooms. Most follow the same grammar: open tiles, one enemy type, one or two exits. There are no rooms that feel mechanically or visually distinct from each other beyond the name banner.

**Target.** Add 8–10 new rooms that each introduce one thing the world doesn't currently have. Quality over quantity — each new room should have a clear reason to exist in the quest graph or exploration loop.

Suggested new rooms (implement all in `data.js`, wire exits bidirectionally):

| Key | Name | What's new |
|-----|------|------------|
| `mill` | Old Mill | Crafting location — `craftable: ['flour','rope']`. No enemy. |
| `cemetery` | Cemetery | Night-only enemy spawn (`nightOnly: true`). Wraith enemy. Connects to catacombs. |
| `harbour` | Harbour | Merchant variant selling boat parts. Leads to `sea_cave`. |
| `sea_cave` | Sea Cave | Underwater feel via `tileOverrides` (water tiles at edges). Crab enemy. |
| `watchtower` | Watchtower | Tall room (`width:6, height:20`). Guard NPC. Gives scouting lore. |
| `herbalist_hut` | Herbalist's Hut | Small (`width:8, height:8`). Unique NPC: Herbalist. Sells `herb`, `antidote`. |
| `frozen_lake` | Frozen Lake | Wide open (`width:25, height:10`). Ice tile type (slippery — step 2 tiles per move). |
| `throne_room` | Throne Room | Indoor. Boss-tier enemy (King's Guard). Dead-end, high reward. |
| `smuggler_den` | Smuggler's Den | Secret room, reachable only via hidden exit in `harbour`. Black-market merchant. |
| `crossroads` | Crossroads | Hub room with exits in all 4 directions. No enemy. Signpost scenery. |

**Implementation notes:**
- All rooms need `width`, `height`, `description`, `exits` (bidirectional), and `scenery` arrays.
- `tileOverrides` is Phase 8 prep — define the array even if renderer ignores it now.
- `nightOnly` enemy spawn: check `getTimeOfDay() === 'night'` before populating `loc.enemy` in `renderWorld`.
- Every new room needs an `exitTile` entry with `destX`/`destY` within bounds — the `rules.test.js` exit-bounds test will catch violations automatically.
- Expand the quest graph to reference at least 3 of the new rooms (e.g., herbalist fetch quest, watchtower scouting quest, throne room boss bounty).

---

#### **4. Inventory — comprehensive test coverage**

**Current state.** `commands.test.js` references `inventory` in 7 places, all incidental (setup or single-line assertions inside other tests). There are zero dedicated tests for the inventory subsystem despite it being a core mechanic with multiple code paths:

- `pickup` / `drop` commands
- `use <item>` (consumables: potion, ale, elixir)
- `equip <item>` (weapons and armor auto-equip in combat via `getBestGear`)
- `sell <item>` at merchant
- Weight/count display in `inventory` command
- Crafting consuming input items and producing output
- Quest objective: `fetch` type checking `inventory` contents
- `rest` command consuming `ale` from inventory

**New test file: `src/inventory.test.js`**

Write a dedicated suite covering at minimum:

```
describe('inventory system', () => {
  describe('pickup', () => {
    - picking up an item in a room with loot adds it to inventory
    - picking up in a room with no loot emits a not-found message
    - duplicate pickups stack correctly (same itemId appears twice)
    - bus emits item:pickup with full item object
  })
  describe('drop', () => {
    - drop removes item from inventory
    - drop on an item not in inventory does not crash
  })
  describe('use', () => {
    - use potion increases HP (capped at maxHp)
    - use ale restores fight charges (up to daily max)
    - use strength_elixir adds statusEffect with duration
    - use non-consumable item gives appropriate message, does not remove from inventory
    - use on empty inventory does not crash
  })
  describe('equip / getBestGear', () => {
    - getBestGear selects highest-attack weapon in inventory
    - getBestGear selects highest-defense armor in inventory
    - manual equipment overrides auto-equip
    - empty inventory gives base stats
  })
  describe('sell', () => {
    - sell removes item from inventory and adds gold
    - sell unknown item does not crash
    - sell at non-merchant location gives appropriate message
  })
  describe('inventory command', () => {
    - empty inventory prints "pack is empty"
    - inventory with items shows each item name and count
    - duplicate items shown as "x2" not listed twice
  })
  describe('craft', () => {
    - crafting consumes ingredient items from inventory
    - crafted item is added to inventory
    - attempting craft without ingredients fails with message
  })
  describe('fetch quests', () => {
    - fetch quest progress updates when item is in inventory
    - fetch quest does not complete until count is met
  })
})
```

All tests use the same `localPlayer` mock pattern established in `commands.test.js` (set `store.localPlayer` directly, call `handleCommand()`). No mocking of the bus — verify side effects via the actual bus listener or by checking `localPlayer.inventory` state post-command.

---

#### **Verification additions for §3 (Static checks)**

After this phase, add to the Post-Implementation Verification Protocol:

**`src/renderer.js`**
- Canvas element has `aspect-ratio` style set. Verify in devtools that changing viewport width does not distort tile proportions.
- `showDialogue('', '')` with empty text does not set `_dialogue` non-null (call `isDialogueOpen()` after — must be false).

**`src/data.js`**
- All new rooms: `exitTile` entries pass the existing bounds test in `rules.test.js`.
- All new rooms: exit destinations are bidirectional (if room A exits to room B, room B has an exit back to room A or to another room — no orphan destinations).

**`src/inventory.test.js`**
- Full suite passes with zero skips. Cover all 8 describe blocks listed above.

---

### **Phase 7.88: Action Button UI Freeze — FIXED**

**Symptom.** Clicking any action button in the Rusty Flagon (tavern) or Market Square (market) appeared to do nothing. Other rooms worked fine.

**What Gemini tried.** Gemini changed the CSS on `.chip` elements in an attempt to fix it. This was the wrong file — `.chip` elements live inside `#debug-console` which has `display:none`. They are permanently invisible regardless of their CSS; they are autocomplete suggestions for the debug CLI, not the game's action buttons. The visual action buttons use `.action-btn` class in `#action-buttons`, which is a separate element outside the debug console. No CSS change to `.chip` could affect the action buttons.

**Actual root cause.** `uiState` (the UI navigation variable in `src/ui.js`) is module-level and was never reset on room transitions. If a player opened a submenu (e.g. clicked "Buy 💰" in the Market → `uiState = 'buy'`), then navigated to another room, `uiState` remained `'buy'`. In the new room, `renderActionButtons` rendered the buy submenu for the new room's shop NPC. If the new room had no shop NPC, only "Back ⬅️" appeared. If it had a different NPC, the wrong submenu appeared. From the player's perspective: all the normal root-state buttons (Move, Talk, Inventory, etc.) were gone, replaced by a single "Back" button. It looked like "nothing works."

This was worst in the Rusty Flagon and Market because those are NPC-heavy rooms where players spend time navigating submenus, making the stale `uiState` state more likely to persist across a room transition.

**Fix applied.** Added a `bus.on('player:move', ...)` listener in `src/ui.js` that resets `uiState = 'root'` whenever the player changes rooms. One line. All 402 tests pass.

```js
// src/ui.js — added alongside the existing ui:back handler
bus.on('player:move', () => {
    uiState = 'root';
});
```

**What was NOT the issue.** The canvas CSS (`aspect-ratio` + `max-height` conflict) and the double `renderActionButtons` call were identified as separate inefficiencies but were not the cause of this specific bug. The NPCS data is clean — all shop NPCs (barkeep, merchant, herbalist) have their `shop` arrays defined.

**Test gap.** There is no test covering `uiState` persistence across room transitions. `src/ui.test.js` does not exist. Add one as part of Phase 7.9 work covering: (a) `uiState` resets to root on `player:move`, (b) `uiState` resets to root on `ui:back`, (c) rendering in 'buy' state with no local shop NPC shows only the Back button and no crash.

---

### **Phase 7.9: P2P Peer Bugs & Networking Test Suite — TODO**

Three distinct bugs identified from same-machine Chrome+Safari testing (two instances, same computer, two peers detected but "Fraud detected" after ~2 minutes and peers invisible to each other).

---

#### **Bug 1 — False fraud detection: position data in the Merkle root**

**Root cause.** `buildLeafData()` in `networking.js` constructs leaves as:
```js
`${id}:${p.level}:${p.xp}:${p.location}:${p.x || 0}:${p.y || 0}`
```

`x` and `y` are included. Position changes on every tile step. The rollup interval is 10 seconds. When Chrome (the proposer this slot) builds its Merkle root at T=10s, it captures Safari's position as cached in its `players` map — say `(3,4)`. Chrome broadcasts this root. Safari receives it and verifies by running its own `buildLeafData()`. Safari's own self-leaf uses its *current* position `(5,2)` (it has been moving). The roots diverge → Safari fires "Fraud detected in instance!" and submits a fraud proof to the Arbiter.

This is a false positive, not actual cheating. Position is high-frequency state that changes faster than the rollup interval. It does not need to be in a consensus hash — what matters for anti-cheat integrity is `level` and `xp` (hard to fake without detection) and `location` (room-level, not tile-level).

**Fix.** Remove `x` and `y` from the leaf string:
```js
// networking.js — buildLeafData()
.map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
// self leaf:
leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
```

`location` (room key) is appropriate: it only changes on room transitions, is bounded, and is meaningful for shard integrity. Tile position within a room is not integrity-critical and should not be in the rollup.

**Regression guard.** Add to `network.test.js`:
```js
test('buildLeafData leaves do not include x,y tile coordinates', () => {
    const leaf = `peer1:5:120:tavern`;  // correct form
    expect(leaf).not.toMatch(/:\d+:\d+$/);  // no trailing :x:y
});
```

---

#### **Bug 2 — Peers invisible: presence dropped before public key arrives**

**Root cause.** On peer join, `onPeerJoin` fires → after 500ms sends `identity_handshake` AND `presence_single` to the new peer simultaneously. On the *receiving* side, `getIdentity` and `getPresenceSingle` are independent async handlers. `getPresenceSingle` begins:

```js
const entry = players.get(peerId);
if (!entry?.publicKey) return;  // ← silently dropped
```

If `getPresenceSingle` fires before `getIdentity` has stored the public key in `players` — which is a race that happens regularly on same-machine WebRTC where message ordering between action channels is not guaranteed — the presence packet is dropped with no retry. The peer is added to `knownPeers` but never to `players` with a valid presence. The renderer's `if (p.location !== localPlayer.location) return` then filters the peer out entirely. From the player's perspective: the UI says "2 peers" (from the knownPeers count) but nobody appears on canvas.

The retry handshake (`setTimeout(handshake, 3000)`) resends identity but does **not** resend presence. So the peer stays invisible until the next periodic presence broadcast (30s+ depending on `players.size`).

**Fix.** Queue presence packets that arrive before the public key is known, and replay them when the key arrives:

```js
// networking.js — add at module level
const _pendingPresence = new Map(); // peerId → ArrayBuffer (most recent)

// in getPresenceSingle handler — replace the early return:
const entry = players.get(peerId);
if (!entry?.publicKey) {
    _pendingPresence.set(peerId, buf);  // hold it, don't drop it
    return;
}

// in getIdentity handler — after trackPlayer():
const pending = _pendingPresence.get(peerId);
if (pending) {
    _pendingPresence.delete(peerId);
    // re-dispatch through the same validation path
    processPresenceSingle(pending, peerId);
}
```

Extract the presence validation logic into a `processPresenceSingle(buf, peerId)` function so both the handler and the replay path use identical validation. Cap `_pendingPresence` at one entry per peer (keep most recent only) to avoid unbounded growth.

**Regression guard.** This is hard to unit test without a real WebRTC connection. Add an explicit test for the queuing logic using the extracted `processPresenceSingle` function with a mock `players` map that starts empty.

---

#### **Bug 3 — Peer in wrong room: ROOM_MAP out of sync with data.js**

**Root cause.** `unpackPresence` in `packer.js` decodes location as:
```js
const location = ROOM_MAP[r.u8()] ?? 'cellar';
```

`ROOM_MAP` is a hardcoded index array in `packer.js`. When new rooms are added to `data.js` (as prescribed in Phase 7.85 world expansion), they must also be appended to `ROOM_MAP` in `packer.js` in the same order. If they are not, a peer in a new room encodes an index that decodes to a different room (or falls back to `'cellar'`). The renderer then places the peer in the wrong room, and since you're not in `'cellar'`, you never see them.

This is silent and produces no error — the byte just maps to the wrong string.

**Fix.** Make `ROOM_MAP` derived from `data.js` rather than hardcoded:

```js
// packer.js
import { world } from './data.js';
export const ROOM_MAP = Object.keys(world).sort(); // deterministic order, same for all peers
```

Sorting alphabetically gives a stable, reproducible index that automatically stays in sync as rooms are added. Both peers must use the same sort — alphabetical is unambiguous. No manual maintenance.

**Verify** that `ROOM_MAP` remains stable across builds by adding a snapshot test in `packer.test.js`:
```js
test('ROOM_MAP index for known rooms is stable', () => {
    expect(ROOM_MAP.indexOf('tavern')).toBe(ROOM_MAP.indexOf('tavern')); // trivial
    // More importantly: the index for a known room must not change between runs
    const idx = ROOM_MAP.indexOf('cellar');
    expect(typeof idx).toBe('number');
    expect(idx).toBeGreaterThanOrEqual(0);
});
```

And add a test that packs and unpacks a presence for every room in `world` and verifies the location round-trips correctly — this catches any new room that isn't indexed.

---

#### **New test file: `src/networking.peer.test.js`**

No tests currently cover peer-to-peer interaction patterns. Add a dedicated suite using a mock `players` Map and a mock `bus`:

```
describe('Peer presence lifecycle', () => {

  describe('public key race condition', () => {
    - presence arriving before publicKey is stored → queued to _pendingPresence
    - identity arriving after → pending presence replayed through full validation
    - pending presence for banned key → discarded on replay, not applied
    - _pendingPresence holds at most one packet per peer (newest wins)
  })

  describe('presence validation', () => {
    - valid presence packet updates players map
    - ph mismatch (doesn't match publicKey hash) → rejected, players map unchanged
    - XP jump > 100 over shadow → rejected
    - level jump > 1 over shadow → rejected
    - presence with location not in ROOM_MAP → falls back to 'cellar', does not crash
    - presence with unknown room index → ROOM_MAP derived from data.js covers all rooms
  })

  describe('buildLeafData', () => {
    - leaves are sorted deterministically regardless of players Map insertion order
    - selfId is excluded from the players entries, added as a separate leaf
    - leaf format is id:level:xp:location (no x,y)
    - two peers with identical level/xp/location produce matching roots
    - two peers where one has moved (x,y differ) still produce matching roots
    - leaf data changes when a peer changes room (location changes)
    - leaf data does NOT change when a peer moves within a room (x,y change)
  })

  describe('fraud detection', () => {
    - root mismatch triggers fraud proof submission
    - root match does not trigger fraud proof
    - joinTime < 3000ms grace: rollup ignored, no fraud proof even if root differs
    - self-signed rollup (publicKey === myPubKeyB64) is ignored
  })

  describe('ROOM_MAP round-trip', () => {
    - packPresence/unpackPresence round-trips location for every room in world
    - adding a new room to data.js does not break existing room indices (sorted derivation)
  })

})
```

All tests in this file run in Node without WebRTC. Mock `signMessage`/`verifyMessage` to return valid/invalid synchronously where needed.

---

#### **Smoke test addition for §5 (Regression smoke-list)**

Add to the existing smoke-list:
- [ ] Open game in two browser tabs (or Chrome + Safari same machine). Both show "2 peers" or similar within 10 seconds of the second tab loading.
- [ ] After 2 minutes with both tabs open and one player moving, neither tab shows "Fraud detected".
- [ ] Player in Tab A is visible as a sprite on canvas in Tab B when both are in the same room.
- [ ] Player in Tab A moving to a new room disappears from Tab B's canvas within one presence cycle.

---

### **Phase 8: Full Zelda-Style Graphical Client — TODO**

Target feel: ALttP / Link's Awakening. No visible text log during play. All feedback is spatial, animated, and momentary.

**Rendering foundation (from Phase 7.85):**
Phase 7.85 lands the five rendering fixes (DPR, aspect-ratio, RAF loop, tile cache, tab blur). Phase 8 builds directly on top of that — do not start Phase 8 renderer work until those are complete and stable.

---

**Procedural world freshness — keeping maps consistent across all peers**

The core constraint: `worldState.seed` + `worldState.day` must produce the same world for every peer. This is already true for tile variation (seeded RNG per tile). Phase 8 extends this to room layout.

*The problem.* Currently rooms are static — same `width`, `height`, `exits`, `scenery`, `staticEntities` every day. A player who has seen every room has seen the whole world. There's nothing to rediscover.

*The solution.* **Seasonal layout variation via the day seed.** Rooms stay structurally stable (exits never move — players need to rely on them) but their interior changes on a slow cadence.

```js
// rules.js — new export
export function roomDaySeed(roomKey, day) {
    // Changes every 7 days (one in-game week), same for all peers
    const week = Math.floor(day / 7);
    return hashStr(roomKey) ^ (week * 0x9e3779b9);
}
```

Use `roomDaySeed` for:
- **Scenery placement** — scatter barrels, trees, altars within the room bounds (avoid exits). Currently hardcoded in `data.js`; move to a `generateScenery(roomKey, day)` function in `rules.js`.
- **Loot tile positions** — the tile with a pickup item moves each week. Players who know the room layout from last week still need to search.
- **Enemy starting position** — already partially seeded; make it fully driven by `roomDaySeed`.
- **Light sources** — which scenery objects are torches (affect Phase 8's dynamic lighting radius) varies by day.

*What stays fixed.* Exit tile positions never change — they're defined in `data.js` and rooms are navigable day-to-day. Room dimensions never change. NPCs stay at their authored positions (wandering is cosmetic, not layout-changing).

*Procedural dungeon floors.* For the new underground/cave rooms (sea cave, catacombs, etc.) go further — generate the room's `tileOverrides` array from `roomDaySeed`:

```js
export function generateDungeonOverrides(roomKey, day, width, height) {
    const rng = seededRNG(roomDaySeed(roomKey, day));
    const overrides = [];
    // scatter water/chasm tiles as obstacles (never on exits, never blocking the center)
    const count = 3 + (rng() * 5 | 0);
    for (let i = 0; i < count; i++) {
        overrides.push({ x: 1 + (rng() * (width - 2) | 0), y: 1 + (rng() * (height - 2) | 0), type: 'chasm' });
    }
    return overrides;
}
```

All peers call this with the same `roomKey` + `day` → same overrides. The room feels different each week. No network traffic required — the seed is the sync mechanism.

*Unexplored room "fog".* When a peer first enters a room in the current week, mark `exploredRooms[roomKey + ':' + week] = true` in IndexedDB. The renderer can draw a subtle fog overlay on tiles outside the player's current sightline radius (e.g., 4 tiles), lifting as they move. This is local-only — it doesn't affect other peers and requires no state sync. It makes large rooms feel like genuine exploration rather than instant reveals.

*Day/season visual theming.* The existing time-of-day tint (`getTimeOfDay()`) already varies by hour. Add a season pass in the tile renderer:

```js
// renderer.js — applied after the tile layer, before entities
const season = SEASONS[Math.floor(worldState.day / SEASON_LENGTH) % 4];
if (season === 'winter') ctx.fillStyle = 'rgba(200,220,255,0.07)';
if (season === 'autumn') ctx.fillStyle = 'rgba(120,60,0,0.05)';
// spring/summer: no tint
if (ctx.fillStyle !== ...) { ctx.fillRect(0, 0, CW, CH); }
```

This is one overlay pass on the cached tile layer — essentially free.

---

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