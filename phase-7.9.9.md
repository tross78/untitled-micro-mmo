# Phase 7.9.9 — Pre-Phase 8 Hardening

## Context

Phase 8 is a content/visual expansion (new rooms, items, NPCs, graphical upgrades). Before that can ship, the core systems need to be bulletproof: peer discovery must be reliable and fast, security holes must be closed, save data must never be lost or corrupted, and the rendering/input pipeline must handle more content without degrading. This phase also fixes three confirmed vulnerabilities flagged in audit. Nothing here adds gameplay features — it makes what exists correct and resilient.

---

## Scope: Phase 8 Blockers (ship before Phase 8 work starts)

### SECURITY — must fix, actively exploitable

**B1. `getStateOffer` XP injection** (`src/networking.js` ~line 288)
- **Bug:** `if (shadow.signature && offerer?.publicKey)` guard is optional — if signature absent, execution falls through and merges arbitrary XP/gold/inventory unconditionally.
- **Chosen fix:** 10% XP ceiling + require signature. Restructure so ALL three gates run unconditionally before any merge:
  1. `shadow.level !== xpToLevel(shadow.xp)` → reject (promote outside optional block)
  2. `shadow.xp > localPlayer.xp * 1.10` → reject (new ceiling; rescue shouldn't advance more than 10%)
  3. Signature must be present (`!shadow.signature` → reject; no silent bypass)
- Log `[Rescue] Rejected: reason` to console when any gate fires so players can diagnose.
- `xpToLevel` already imported in networking.js.

**B2. `/register` OOM on Pi Zero** (`arbiter/index.js` ~line 341)
- **Bug:** `req.on('data', chunk => { body += chunk; })` has no size limit. Continuous stream → exhausts 512MB RAM.
- **Fix:** Track accumulated length; if `body.length + chunk.length > 1024`, call `req.socket.destroy()` and return. 1024 bytes is well above any valid registration payload (~256 bytes max).

**B3. `audio.js` throws in Node/test environment** (`src/audio.js` ~line 8)
- **Bug:** `initAudio()` calls `new (window.AudioContext || window.webkitAudioContext)()` unconditionally. In Node, `window` is undefined → throws before any guard fires.
- **Fix:** Add `if (typeof window === 'undefined') return;` at top of `initAudio()`, then wrap the constructor call in `try { ... } catch { audioCtx = null; }`.

---

### DATA INTEGRITY — must fix before Phase 8 adds new fields/items

**E3. Schema version bump** (`src/store.js`, `src/persistence.js`)
- Add `export const SAVE_VERSION = 2` to store.js.
- On `loadLocalState`: detect `!data._version || data._version < 2` → run v1→v2 migration (just stamp version; no structural change needed now).
- On `saveLocalState`: always write `localPlayer._version = SAVE_VERSION` before serializing.
- Use in-place versioning via `_version` field (not key bump) to preserve existing saves.
- **Must land before E2 and E1.**

**E2. Load validation / field clamping** (`src/store.js`, `loadLocalState` ~line 100)
- After migration, add validation pass:
  ```js
  localPlayer.hp    = Math.max(0, Math.min(localPlayer.hp ?? 0, localPlayer.maxHp ?? 50));
  localPlayer.maxHp = Math.max(1, localPlayer.maxHp ?? 50);
  localPlayer.gold  = Math.max(0, localPlayer.gold ?? 0);
  localPlayer.level = xpToLevel(localPlayer.xp ?? 0);            // derive, don't trust
  localPlayer.inventory = (localPlayer.inventory || []).filter(id => ITEMS[id]); // strip unknown items
  ```
- Import `xpToLevel` from `./rules.js` and `ITEMS` from `./data.js` into store.js.
- **Must run after E3 migration.**

**E1. `beforeunload`/`visibilitychange` emergency flush** (`src/persistence.js`, `src/main.js`)
- Export `flushSync(player)` from `persistence.js`:
  ```js
  export const flushSync = (player) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(player)); } catch {}
  };
  ```
- In `main.js` (where `localPlayer` is in scope), register:
  ```js
  window.addEventListener('beforeunload', () => flushSync(localPlayer));
  document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSync(localPlayer);
  });
  ```
- Keeps IDB as primary durable store; `flushSync` is the crash safety net.
- **Must land after E3** so it serializes versioned objects.

---

### RENDERING — Phase 8 adds sprites; these prevent memory growth

**C2. LRU sprite cache** (`src/renderer.js` ~line 42)
- **Bug:** `_spriteCache` is an unbounded Map. More NPC types in Phase 8 = unbounded memory.
- **Fix:** Implement LRU using Map insertion-order property (delete+re-insert on hit, evict first entry when full):
  ```js
  const SPRITE_CACHE_LIMIT = 128;
  // On cache hit: delete key, re-set to move to end (LRU refresh)
  // On cache miss + full: delete _spriteCache.keys().next().value (evict oldest)
  ```
- Implement once as an internal helper, reuse for C3.

**C3. Font metric cache** (`src/renderer.js`)
- Memoize `ctx.measureText()` results keyed by `text + fontSize`. Cap at 256 entries using same LRU helper from C2. Minor performance win; trivial alongside C2.

---

### INPUT — dead work at 60fps on mobile

**D1. Gamepad polling guard** (`src/input.js` ~line 64)
- **Bug:** `navigator.getGamepads()` polled every RAF frame even on mobile with no gamepad.
- **Fix:** Track connection state with standard Web API:
  ```js
  let gamepadConnected = false;
  window.addEventListener('gamepadconnected', () => { gamepadConnected = true; });
  window.addEventListener('gamepaddisconnected', () => {
      gamepadConnected = navigator.getGamepads().some(g => g);
  });
  ```
  Guard polling block: `if (!gamepadConnected) return;`

---

## Scope: Nice-to-Have (land in 7.9.9 if time allows, not Phase 8 blockers)

### PEER DISCOVERY — whitepaper-inspired improvements

**A1. Exponential backoff sketch scheduling** (`src/networking.js` ~line 382)
- Replace fixed `30000 + players.size * 5000` with burst sequence on join: `[200ms, 1s, 4s, 16s]` then settle to steady-state formula.
- Pass `attempt` counter through `scheduleNextSketch(attempt)`.
- Faster convergence in first 20s without increasing steady-state chatter.

**A2. Global-to-shard relay bootstrap** (`src/networking.js`)
- When joining a shard, if `globalRooms.torrent` is still open, broadcast a lightweight `seeking_shard` message with target shard name.
- Peers already in that shard hear it and send presence directly → bypasses tracker cold-start RTT.
- Use `globalRooms.torrent.makeAction('seeking_shard')` pattern (same as existing actions).
- Guard: check `globalRooms.torrent` for null (Adaptive Silence may have closed it).
- Inspired by Vivaldi coordinate relaying — existing neighbors know topology.

**A3. Presence delta piggybacking** (`src/networking.js`, `src/store.js`)
- Maintain `_presenceDelta = { joined: Set, left: Set }` updated in `trackPlayer`/`players.delete`.
- On each sketch send, emit a separate `presence_delta` action with `{ joined: [...phs], left: [...phs] }`. Clear delta after send.
- Recipients update ghost list without waiting for full reconciliation.
- Inspired by SWIM membership (Das et al. 2002): membership state piggybacked on all messages.

**D2. Touch swipe gesture** (`src/input.js`)
- `touchstart` records start position. `touchend` with delta ≥ 20px emits directional move.
- Use `passive: false` on `touchend` only (to allow `preventDefault` when swipe threshold met — prevents synthetic `click` from also firing tile interaction).
- Single swipe = one tile step. Hold-to-move deferred to Phase 8.

---

### RENDERING FOUNDATION — Phase 8 prerequisite

**C4. Viewport config extraction + responsive layout** (`src/renderer.js`, `src/index.html`, `src/constants.js`)

**Why now:** Option 2 (dynamic tile counts per orientation) is the Phase 8 target. The blocker is that `VIEWPORT_W`, `VIEWPORT_H`, `CW`, `CH` are imported constants referenced in ~20 places in renderer.js (camera clamps, tile loop bounds, HUD positions, edge arrows, OffscreenCanvas size). Making them dynamic in Phase 8 without this prep would require touching all 20 sites under pressure. This phase does the structural work with zero behaviour change.

**Step 1 — Mutable VP config object** (renderer.js):
- Replace module-level constant imports with a single mutable object:
  ```js
  const VP = { W: VIEWPORT_W, H: VIEWPORT_H, S: TILE_PX * 3, get CW() { return this.W * this.S; }, get CH() { return this.H * this.S; } };
  ```
- Mechanically replace all `VIEWPORT_W` → `VP.W`, `VIEWPORT_H` → `VP.H`, `CW` → `VP.CW`, `CH` → `VP.CH`, `S` → `VP.S` throughout renderer.js (~20 substitutions).
- Canvas `width`/`height` set from `VP.CW`/`VP.CH` in `initCanvas()`.
- Tile cache `OffscreenCanvas` uses `VP.CW + VP.S` / `VP.CH + VP.S`.
- **No behaviour change** — VP values are identical to current constants at runtime.
- **Phase 8 hook:** resize callback sets `VP.W = newW; VP.H = newH;` and calls `canvas.width = VP.CW; canvas.height = VP.CH;` — everything else just works.

**Step 2 — CSS dual-layout** (index.html):
- Add `#game-area` wrapper around the canvas injection point.
- Portrait (default): `#game-area` is a flex column, canvas full-width, action buttons below.
- Landscape: `@media (orientation: landscape)` switches to `display: grid; grid-template-columns: auto 1fr;` — canvas fills left column (height-constrained), `#side-panel` div appears on right.
- `#side-panel` is empty in 7.9.9 (action buttons stay below canvas); Phase 8 moves them here.
- Safe-area insets (`env(safe-area-inset-*)`) applied to `#game-area` padding for notched phones.

**Step 3 — Scale-to-fit via ResizeObserver** (renderer.js `initCanvas()`):
- Attach `ResizeObserver` to `#game-area` container.
- On each observation:
  ```js
  const scale = Math.min(container.clientWidth / VP.CW, container.clientHeight / VP.CH);
  _canvas.style.transform = `scale(${scale})`;
  _canvas.style.transformOrigin = 'top left';
  container.style.height = Math.round(VP.CH * scale) + 'px'; // collapse dead space
  ```
- Click handler already uses `getBoundingClientRect()` — **zero change needed** since it reads actual rendered rect.
- Remove `max-width: ${CW}px; max-height: 45vh` from the current canvas inline CSS (replaced by scale).

---

## Implementation Order (critical path)

```
1. B3  audio.js Node guard        — isolated, no deps, unblocks test suite
2. B2  /register body limit       — arbiter-only, deploy independently  
3. B1  getStateOffer gate         — networking.js, ship with B2/B3
4. E3  schema version             — must precede E2 and E1
5. E2  load validation/clamping   — depends on E3
6. E1  beforeunload flush         — depends on E3
7. C2  LRU sprite cache           — isolated renderer change
8. C3  font metric cache          — pair with C2, same file
9.  D1  gamepad poll guard         — isolated input.js change
10. C4  VP config extraction      — mechanical renderer refactor, no behaviour change
11. C4  CSS dual-layout           — index.html structure + orientation media queries
12. C4  ResizeObserver scale-fit  — replaces current max-height:45vh constraint
── nice-to-haves below ──
14. A1 sketch backoff             — isolated, low risk
15. D2 touch swipe                — test on mobile; passive:false on touchend only
16. A2 global→shard relay         — medium complexity, verify Adaptive Silence guard
17. A3 presence piggybacking      — medium, touches store + networking
── excluded ──
A4 Gist shard index               — deferred; requires coordinated arbiter deploy
```

---

## Key Interaction Warnings

- **E3 → E2 → E1 must be sequential.** Migration before clamping, clamping before flush serialization.
- **B1 ceiling is strict** — log `[Rescue] Rejected: xp ceiling` to console when the 10% cap fires so players can diagnose failed rescues.
- **C2 + C3 share one LRU helper** — implement the pattern once in renderer.js, don't copy-paste two eviction loops.
- **C4 VP extraction must precede C2/C3** — sprite and metric cache sizes reference `VP.CW`/`VP.CH` after the refactor. Do step 1 first so C2/C3 don't need updating again.
- **C4 ResizeObserver + tile cache** — scale-to-fit doesn't change `VP.W`/`VP.H`, so the tile cache key is unaffected. In Phase 8 when tile counts change, the cache key (`loc.name + VP.W + VP.H`) will naturally invalidate. No extra work needed.
- **D2 vs canvas click** — `touchend` with `passive: false` + `preventDefault()` when swipe threshold met prevents double-firing of tile click. Critical for iOS Safari.
- **A2 Adaptive Silence guard** — `globalRooms.torrent` may be null; same null-check pattern already used at networking.js line 458.

---

## Critical Files

| File | Items |
|------|-------|
| `src/networking.js` | B1, A1, A2, A3 |
| `arbiter/index.js` | B2 |
| `src/audio.js` | B3 |
| `src/store.js` | E2, E3 |
| `src/persistence.js` | E1, E3 |
| `src/main.js` | E1 (event registration) |
| `src/renderer.js` | C2, C3, C4 (VP object + ResizeObserver) |
| `src/index.html` | C4 (game-area wrapper, side-panel, media queries) |
| `src/constants.js` | C4 (VIEWPORT_W/H stay as defaults, re-exported) |
| `src/input.js` | D1, D2 |

---

## Verification

- **B1:** Attempt state rescue with a crafted payload missing `signature` → must be rejected. Attempt with `xp = localPlayer.xp * 2` → must be rejected.
- **B2:** `curl -X POST http://localhost:3001/register -d "$(python3 -c "print('A'*10000)")"` → must destroy connection without OOM.
- **B3:** Run `npm test` — audio tests must pass without `window.AudioContext` mock setup.
- **E3:** Load game, check `localPlayer._version === 2` in console.
- **E2:** Manually set `hp: 99999` in localStorage, reload → hp must clamp to maxHp.
- **E1:** Trigger save, immediately close tab, reopen → no progress lost.
- **C2:** Load room with many NPCs, check `_spriteCache.size` stays ≤ 128 in DevTools.
- **C4:** Rotate phone / resize desktop window — canvas should fill available area without letterbox gaps or scrollbars. In landscape, `#side-panel` div is visible. In portrait, action buttons are below canvas. Click/tap a tile — coordinates must still resolve correctly (no offset from scale transform).
- **D1:** Open DevTools Performance, confirm RAF handler calls `navigator.getGamepads()` 0 times with no gamepad connected.
- **A1:** On shard join, check console for sketch broadcasts at 200ms, 1s, 4s, 16s intervals.
- **D2:** On mobile, swipe left/right/up/down on canvas → character must move one tile per swipe.

## Invariants — Must Never Violate                                                                                                                                             
- Never call `r.makeAction()` inside `joinInstance()` or any function                                                                                                          
  called per-room-transition. All actions must be created once in
  `setupShard()` or `connectGlobal()`.                                                                                                                                         
- Never call `players.size` to check if peers exist after a room join                                                                                                          
  (always 0 immediately after `players.clear()`). Use `rooms.torrent.getPeers()`.                                                                                              
- `gameActions.*` assignments in `Object.assign(gameActions, {...})` only                                                                                                      
  happen after `joinInstance` resolves — never call them during init.        