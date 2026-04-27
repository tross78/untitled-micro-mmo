# Phase 7.5 — Graphical Transition Groundwork

## Context

Hearthwick is headed for a full pixel-art graphical client (Phase 8: SNES Zelda ALttP style, top-down, 16×11 tile viewport). Phase 7.5 is the bridge: every system that currently relies on slash commands, the text radar, or the scrolling log needs to be restructured so Phase 8 can swap in a canvas renderer, keyboard/gamepad input, and a graphical HUD without rewriting game logic. No new npm deps allowed (ADR-009).

**Phase 8 targets:**
- All movement/interaction via keyboard (WASD/arrows) and gamepad (D-pad + face buttons)
- Slash commands demoted to debug/power-user only
- Radar removed entirely, replaced by canvas tile viewport
- Text log removed, replaced by floating combat text, speech bubbles, and toast HUD
- NPC dialogue as portrait + dialogue box (not a chip menu)
- Inventory/quest as graphical panels

Phase 7.5 must build the input abstraction, event bus, renderer interface, and structured UI events so Phase 8 is a module swap — not a rewrite.

---

## Pillar A: Input Abstraction (`src/input.js` — new file)

The entire input model shifts from "type a command" to "press a key/button." Build a centralized `InputManager` now so Phase 8 only adds gamepad bindings on top.

### A1 — Define game actions (action constants)
```js
export const ACTION = {
  MOVE_N: 'move_n', MOVE_S: 'move_s', MOVE_E: 'move_e', MOVE_W: 'move_w',
  INTERACT: 'interact',   // talk to NPC / pick up item / use portal
  ATTACK: 'attack',       // engage nearest enemy
  INVENTORY: 'inventory', // open inventory panel
  MENU: 'menu',           // open action menu / pause
  CONFIRM: 'confirm',     // select highlighted option
  CANCEL: 'cancel',       // back / close panel
  SPRINT: 'sprint',       // hold to move faster (Phase 8: smooth scroll)
};
```

### A2 — Keyboard bindings
Map to actions (all configurable later):
```
W/↑        → MOVE_N      Space/E    → INTERACT
S/↓        → MOVE_S      F/Z        → ATTACK
A/←        → MOVE_W      I/Tab      → INVENTORY
D/→        → MOVE_E      Esc        → MENU/CANCEL
Enter      → CONFIRM     Shift      → SPRINT
```
Key handler in `src/input.js` — fires `bus.emit('input:action', { action })` on keydown. Text input field captures focus and suppresses input actions while focused.

### A3 — Gamepad bindings (Gamepad API — zero deps, built-in)
Polling via `requestAnimationFrame` (Phase 8 game loop will already have one):
```
D-pad / Left stick  → MOVE_{N,S,E,W}
A / Cross           → CONFIRM / INTERACT
B / Circle          → CANCEL
X / Square          → ATTACK
Y / Triangle        → INVENTORY
Start               → MENU
```
Stub the gamepad polling in Phase 7.5 (poll, emit actions). Phase 8's game loop adopts it.

### A4 — Wire actions to game logic
`src/main.js` subscribes to `input:action` events and calls the same functions that slash commands call. Slash commands stay as a thin wrapper (they emit `input:action` too). Action chips/buttons also emit `input:action` instead of calling game logic directly — they become UI affordances on top of the same system.

**Files:** create `src/input.js`, update `src/main.js` (wire input bus), `src/commands.js` (action dispatch), `src/ui.js` (chips emit actions instead of calling logic).

---

## Pillar B: EventBus & Structured UI Events (`src/eventbus.js` — new file)

All game state changes emit typed events. UI subscribes. In Phase 8, the canvas renderer subscribes to the same events.

### B1 — EventBus
```js
// Minimal pub/sub, no deps
const listeners = {};
export const bus = {
  on(event, fn)  { (listeners[event] ??= []).push(fn); },
  off(event, fn) { listeners[event] = (listeners[event] || []).filter(f => f !== fn); },
  emit(event, data) { (listeners[event] || []).forEach(f => f(data)); },
};
```

### B2 — Typed events (emit these from commands.js / main.js)

| Event | Payload | Phase 7.5 consumer | Phase 8 consumer |
|-------|---------|-------------------|-----------------|
| `combat:hit` | `{attacker, target, damage, crit}` | log line | floating number above sprite |
| `combat:miss` | `{attacker, target}` | log line | "Miss!" sprite bubble |
| `combat:dodge` | `{attacker, target}` | log line | dodge animation |
| `combat:death` | `{entity, loot}` | log line | death animation + loot drop |
| `combat:status` | `{entity, effect, stacks}` | status bar | status icon above sprite |
| `player:move` | `{from, to, direction}` | radar refresh | sprite walk animation |
| `player:levelup` | `{level, statDeltas}` | log line | full-screen flash + HUD |
| `player:xp` | `{amount, total}` | log line | XP bar fill animation |
| `npc:speak` | `{npcId, text, mood}` | log line | portrait + dialogue box |
| `npc:shop` | `{npcId, inventory}` | chip menu | shop panel |
| `item:drop` | `{item, x, y}` | log line | loot sprite on tile |
| `item:pickup` | `{item}` | log line | toast + inventory update |
| `quest:progress` | `{questId, current, total}` | log line | quest HUD bar |
| `quest:complete` | `{questId, rewards}` | log line | completion banner |
| `chat:say` | `{playerId, name, text, x, y}` | log line | speech bubble above sprite |
| `world:day` | `{day, season, mood}` | status bar | ambient color shift |
| `input:action` | `{action}` | game logic | game logic |

### B3 — Wire events into commands.js
Replace all direct `log()` calls in combat/quest/NPC/movement code with `bus.emit(event, data)`. A single subscriber in `src/ui.js` converts events to log lines (Phase 7.5 behavior). Phase 8 removes that subscriber and wires canvas rendering instead.

**Files:** create `src/eventbus.js`, update `src/commands.js` (emit events), `src/ui.js` (subscribe, format log), `src/main.js` (move/chat events).

---

## Pillar C: Renderer Interface (`src/renderer.js` — new file)

Extract the radar and all visual output behind a clean interface. Phase 8 swaps the implementation; callers don't change.

### C1 — Interface definition
```js
export function renderWorld(state)              { /* Phase 7.5: calls drawRadar */ }
export function showFloatingText(x, y, text, style) { /* Phase 7.5: log line */ }
export function showToast(message, style)       { /* Phase 7.5: log line */ }
export function showSpeechBubble(entityId, text){ /* Phase 7.5: log line */ }
export function showDialogue(npcId, text, mood) { /* Phase 7.5: chip menu */ }
export function showInventoryPanel(items, equipped) { /* Phase 7.5: chip menu */ }
export function showQuestPanel(quests)          { /* Phase 7.5: chip list */ }
export function showShopPanel(npcId, inventory) { /* Phase 7.5: chip menu */ }
export function updateHUD(player, world)        { /* Phase 7.5: status bar */ }
```

### C2 — Radar behind interface
`src/ui.js` exports `drawRadar(state)` as a named function. `renderWorld` calls it. In Phase 8, `renderWorld` mounts a `<canvas>` and runs the tile/sprite renderer instead.

### C3 — Procedural graphics module (`src/graphics.js` — new file, stub in 7.5)
Stub the functions Phase 8 will implement. Phase 7.5 can use them to render a canvas prototype of the tile view alongside the existing radar (toggle-able with a dev key `\``).

```js
// Hash-identicon character sprites (16x16, seeded from entity id)
export function generateCharacterSprite(seed, type) { /* returns OffscreenCanvas */ }
// Canvas primitive tile renderer — no PNG assets
export function drawTile(ctx, tileType, canvasX, canvasY, rngSeed) { /* fillRect patterns */ }
// Animate walk cycle via pose offsets
export function getWalkPose(frameTime) { /* returns {legOffset, bodyY} */ }
```

Tile types and palette (SNES ALttP):
- `stone_floor`: `#3a3a3a` base + seeded highlight dots
- `wall`: `#2a2a3a`/`#4a4a5a` brick split + crack lines
- `grass`: `#1a4a1a`/`#2a6a2a` + seeded tufts + rare flower
- `water`: `#0a3a6a`/`#1a5a9a` + horizontal wave lines
- `portal`: dark base + `ctx.arc` concentric rings
- Interiors (tavern/market): `#6a4a2a`/`#8a6a4a` warm wood palette

**Files:** create `src/renderer.js`, create `src/graphics.js` (stubs), update `src/ui.js` (export drawRadar), update `src/commands.js` (use renderer functions).

---

## Pillar D: Game Depth

### D1 — Equipment slots (`src/store.js`, `src/rules.js`, `src/commands.js`)
Add `equipped: { weapon: null, armor: null }` to localPlayer. Combat reads equipped stats. Add `/equip <item>` and auto-equip strongest on pickup. Required for inventory panel in Phase 8.

### D2 — Armor items (`src/data.js`)
- `leather_armor`: +2 def, drops from bandit (20%), value 15g
- `iron_armor`: +4 def, sold by Merchant (60g), drops from cave_troll (10%)
- `warm_cloak`: +1 def, craftable, value 8g

### D3 — Quest system overhaul (`src/data.js`, `src/commands.js`)

**Quest data shape** (extend existing QUESTS object):
```js
{
  id: 'wolf_hunt',
  name: 'Wolf Hunt',
  giver: 'guard',       // NPC id who gives the quest
  receiver: 'guard',    // NPC id to return to (may differ)
  type: 'kill',         // 'kill' | 'fetch' | 'deliver' | 'explore' | 'craft'
  description: 'Cull 3 wolves from the Forest Edge.',
  lore: 'The Guard grumbles about wolf attacks on travelers.',
  objective: { type: 'kill', target: 'forest_wolf', count: 3 },
  prerequisite: 'find_tavern', // null or quest id that must be complete
  reward: { xp: 50, gold: 20, item: null },
  chain: 'militia',     // quest chain name for grouping
}
```

**14 quests across 4 chains** (15 total including existing wolf_hunt):

**The Militia Chain** (Guard, Hallway):
1. `find_tavern` — *Tutorial.* "Head to the Tavern." Given on first login, auto-completes on entering Tavern. Reward: 10xp, potion. `prerequisite: null`
2. `wolf_hunt` — *existing.* "Cull 3 wolves." `prerequisite: find_tavern`. Reward: 50xp, 20g.
3. `bandit_sweep` — "Slay 5 bandits at the Bandit Camp." `prerequisite: wolf_hunt`. Reward: 100xp, 40g, bandit_mask.
4. `cave_troll_bounty` — "Slay the Cave Troll." `prerequisite: bandit_sweep`. Reward: 150xp, iron_armor.

**The Scholar Chain** (Sage, Ruins):
5. `ruins_survey` — *Exploration.* "Visit the Ruins." `prerequisite: null`. Reward: 20xp, old_tome.
6. `tome_collection` — *Fetch.* "Bring 2 old_tomes to the Sage." `prerequisite: ruins_survey`. Reward: 60xp, magic_staff.
7. `catacomb_delve` — *Exploration.* "Reach the Catacombs." `prerequisite: tome_collection`. Reward: 80xp, 30g.
8. `wraith_banish` — "Banish the Wraith in the Catacombs." `prerequisite: catacomb_delve`. Reward: 200xp, 50g.

**The Trade Chain** (Merchant, Market):
9. `gather_wood` — *Fetch.* "Gather 5 wood bundles." `prerequisite: null`. Reward: 25xp, 15g.
10. `iron_supply` — *Fetch.* "Gather 3 iron ore." `prerequisite: gather_wood`. Reward: 35xp, 20g.
11. `craft_sword` — *Craft.* "Craft an iron sword at the Market." `prerequisite: iron_supply`. Reward: 50xp, iron_sword. (Teaches the crafting system to the player.)
12. `market_recovery` — *Deliver.* "Sell 3 items to the Merchant." `prerequisite: craft_sword`. Reward: 40xp, 25g.

**Barkeep's Requests** (standalone, Barkeep, Tavern):
13. `tavern_regular` — "Rest at the Tavern 3 separate days." Track via `questData.daysRested` + day counter. Reward: 20xp, 2 ales, permanent +5 maxHp.
14. `courier_run` — *Deliver.* "Bring an ale to the Sage at the Ruins." (Carry ale, talk to Sage.) `prerequisite: null`. Reward: 30xp, potion.
15. `mountain_trial` — "Reach the Mountain Pass and survive a Mountain Troll." `prerequisite: cave_troll_bounty`. Reward: 300xp, 75g, steel_sword. *(End-game quest.)*

**Quest command changes:**
- `/quests` shows all chains with progress (locked quests shown as `???`)
- Talking to a quest-giver NPC automatically offers available quests via the dialogue system
- `bus.emit('quest:progress')` payload includes `nextLocation` for Phase 8 HUD directional arrow

### D4 — Sell items + crafting (`src/commands.js`, `src/data.js`)
- `/sell <item>` → Merchant pays 40% of item value. Emits `item:drop` equivalent.
- `RECIPES` array: `{inputs, output, location}`. `/craft` lists available recipes. Emits `item:pickup`.

### D5 — Status effects (`src/store.js`, `src/rules.js`)
Add `statusEffects: []` to localPlayer. Start with `poisoned` (ruin_shade 20%) and migrate `well_rested` buff. Emit `combat:status` events. Phase 8 renders as icons above sprite.

---

## Pillar E: Structural Cleanup for Phase 8

### E1 — Player state additions (`src/store.js`)
```js
direction: 'south',        // for sprite facing
animState: 'idle',         // 'idle' | 'walking' | 'attacking' | 'hurt'
statusEffects: [],         // [{ id, duration, stacks }]
equipped: { weapon: null, armor: null },
```

### E2 — Viewport constants (`src/constants.js`)
```js
export const VIEWPORT_W = 15;  // tiles wide (ALttP style)
export const VIEWPORT_H = 11;  // tiles tall
export const TILE_PX = 16;     // pixels per tile
```

### E3 — Remove radar coupling from main.js
Radar refreshes currently triggered directly by calling `drawRadar()`. Move all refresh calls to `renderWorld(state)` so there's a single entry point Phase 8 can swap.

---

## Pillar F: P2P-Native Player Persistence

The Pi Zero W cannot store player state at 100k scale (500MB+ on a 512MB RAM device). Player data must stay on clients. The architecture: IndexedDB as primary local store + Ed25519-signed P2P state gossip for recovery. Scales to any player count; adds zero Pi load.

### F1 — Migrate localStorage → IndexedDB (`src/persistence.js`)
Replace `localStorage.setItem/getItem` with an async IndexedDB wrapper. Same `STORAGE_KEY`, same data shape — just a better store. Benefits: ~1GB quota (vs 5MB), no eviction, structured async I/O, future-proof for larger inventory/quest data. No new deps.

```js
// Thin async wrapper (no library needed)
const db = await openDB('hearthwick', 1, (db) => {
  db.createObjectStore('player');
  db.createObjectStore('world');
});
export const saveState = async (player) => db.put('player', player, 'local');
export const loadState = async () => db.get('player', 'local');
```

Keep a `localStorage` write-through for one version so existing players don't lose saves on upgrade.

### F2 — Extended shadow state in presence packets
The existing `shadowPlayers` Map caches level/xp/location from presence packets. Extend the gossiped state to include: `gold`, `inventory` (item ids + counts, compact), `quests` (active quest ids + progress), `equipped`. Sign the full blob with Ed25519 (same signing pattern as existing presence).

Since peers already cache shadow state, this creates a natural P2P backup network — the more players online, the more redundancy. No Pi involvement.

### F3 — State rescue channel (`src/networking.js`)
Add a `state_request` / `state_offer` Trystero channel. On login:
1. Load from IndexedDB (primary path)
2. If IndexedDB empty or stale: broadcast `state_request { ph }` on the channel
3. Any peer who has your ph in `shadowPlayers` replies with `state_offer { signedState }`
4. Client verifies Ed25519 signature — if valid and `ts` newer than local, merge (apply higher values for xp/level, union for inventory)
5. Arbiter fallback: last rollup provides authoritative floor for level/xp

Pi Zero role stays narrow: world seed + day tick + rollup validation only. No player state stored on Pi.

**Files:** `src/persistence.js` (IndexedDB wrapper + migration), `src/store.js` (extended shadow state shape), `src/networking.js` (state_request/state_offer channel), `src/packer.js` (compact state serialization).

---

---

## Pillar G: Missing Gameplay Systems

### G1 — Death & respawn (`src/commands.js`, `src/rules.js`)
When HP reaches 0 in combat:
- Respawn in Cellar at 5 HP
- Drop 10% of unbanked gold on the floor at death location (seeded loot pile, anyone can pick up for 60s then despawns)
- Emit `combat:death` event (Phase 8: plays death animation, fade to black, cut to Cellar)
- Log: "You collapse. You awaken in the Cellar, stripped of some gold..."
- No XP loss, no inventory loss — death is a setback not a punisher

### G2 — Day/night gameplay effects (`src/rules.js`, `src/commands.js`)
Day counter already exists. Assign time-of-day from day cycle (can derive: `hour = (Date.now() / 3600000) % 24`). Effects:
- **Night (20:00–06:00)**: Market closed (no buy/sell), skeleton/wraith spawn rate +50%, wolves retreat indoors (forest_wolf unavailable), Tavern gives "Sleeping" option that fast-forwards to dawn and grants Well Rested buff
- **Day**: Normal state, all NPCs active
- Emit `world:timeOfDay` event. Phase 8 shifts ambient canvas palette (warm orange dawn → blue dusk).

### G3 — Minimap event for Phase 8 (`src/renderer.js`)
Add `renderMinimap(state)` to the renderer interface. Phase 7.5 implementation: nothing (radar still shown). Phase 8 implementation: small 5×5 tile overview in corner showing adjacent rooms and exits. The event bus emits `player:move` with enough context for the minimap to update.

### G4 — Web Audio feedback (`src/audio.js` — new file, ~40 lines)
Zero deps: use `AudioContext` (built-in). Simple procedural sound effects:
```js
export function playHit()     { /* short sawtooth burst, 80ms */ }
export function playCrit()    { /* higher pitch hit + decay */ }
export function playLevelUp() { /* ascending arpeggio */ }
export function playPickup()  { /* soft ping */ }
export function playPortal()  { /* descending whoosh */ }
```
Wire via EventBus: `combat:hit` → `playHit()`, `player:levelup` → `playLevelUp()`, etc. Gated on user interaction (AudioContext requires user gesture — init on first keypress/click).

### G5 — World events (`src/rules.js`, `arbiter/index.js`)
The `threatLevel` field already increments with days but isn't used for dynamic events. Add:
- **Wandering boss**: when `threatLevel >= 5`, a `mountain_troll` spawns as a world event in a random outdoor location (seeded per day). Broadcast via Arbiter `world_event` packet. All players in that shard see it.
- **Market crash**: `scarcity` already removes items from market. Add a `market_surplus` event (random day) that drops all prices 30% for 24h.
- **Weather**: seeded weather state (`clear`, `storm`, `fog`) derived from `world_seed + day`. Storm increases enemy spawn chance, fog reduces radar/viewport range. Phase 8 renders as overlay canvas effects.

---

## Execution Order

| Step | Pillar | Files |
|------|--------|-------|
| 1 | B1 EventBus | eventbus.js (new) |
| 2 | A1–A3 InputManager | input.js (new), main.js |
| 3 | A4 Wire actions | main.js, commands.js, ui.js |
| 4 | B2–B3 Wire events | commands.js, ui.js, main.js |
| 5 | C1–C3 Renderer interface + graphics stubs | renderer.js (new), graphics.js (new), ui.js |
| 6 | E1–E3 State/constants cleanup | store.js, constants.js, main.js |
| 7 | F1–F3 IndexedDB + P2P state rescue | persistence.js, store.js, networking.js, packer.js |
| 8 | D1–D2 Equipment + armor | store.js, rules.js, commands.js, data.js |
| 9 | D3 Quest system overhaul (15 quests, 4 chains) | data.js, commands.js |
| 10 | D4–D5 Sell/craft/status effects | data.js, commands.js, rules.js, ui.js |
| 11 | G1–G2 Death/respawn + day/night effects | commands.js, rules.js |
| 12 | G4 Web Audio | audio.js (new), main.js |
| 13 | G3 + G5 Minimap stub + world events | renderer.js, rules.js, arbiter/index.js |

---

## Verification

After each step: `npm run build` must pass under 175KB. `npm test` — all tests pass.

Full integration test after all steps:
1. Move with WASD in browser — no slash command needed
2. Press F/Z to attack nearest enemy — combat log fires from EventBus subscriber; hit sound plays
3. Enter NPC tile with Space/E — dialogue shows (via renderer.showDialogue)
4. Open inventory with I/Tab — panel shows (via renderer.showInventoryPanel)
5. Complete `find_tavern` → `wolf_hunt` → `bandit_sweep` → `cave_troll_bounty` quest chain (Militia)
6. Start `ruins_survey` → `tome_collection` (Scholar chain) — verify quest prerequisite gate works
7. Die in combat — verify respawn in Cellar, gold loss, no inventory loss
8. Log out and back in (clear IndexedDB) → verify P2P state rescue offers recovery from a peer
9. Change system clock to night hours — verify Market closes and enemies strengthen
10. Check status bar shows day/season/time, equipped items, active status effects
11. Gamepad: connect controller, verify D-pad moves and A/B/X interact/attack/cancel
12. `npm run build` → bundle still under 175KB
