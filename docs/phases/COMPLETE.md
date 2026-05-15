# Completed Phases Archive

Full acceptance checklists and implementation notes for phases that are closed and locked. Read this file when you need to understand what a completed phase actually delivered or why a decision was made.

---

## Phase 8.78: Game-Readiness Pass — COMPLETE

Closed the gap between "implemented" and "playable." Core loop can now complete without softlocks, invisible gates, or hollow quest text.

* `8.78a` ✅ Resource nodes — log in forest_edge/forest_depths, ore in cave/mountain_pass; `getScatteredContent` handles `type: 'resource'`; movement-system grants wood/iron via `grantItem` (advances fetch quests); log/ore sprites + palettes added to `graphics.js` (previously rendered as rock fallback)
* `P0` ✅ Depletion gate — `gatheredNodes` in localPlayer; one gather per node per in-game day per player; covers flora + resource scatter; zero P2P coordination
* `8.78b` ✅ Room clutter — forest_depths density 20→12, clutter→[tree,shrub]; `buildScatterBlockedTiles` parses `tiles` string-array walls; smuggler_den east wall closed; validate density >15% warns
* `8.78c` ✅ Quest text — "Collect 5 wood bundles from the forest" / "Mine 3 iron ore bundles from the cave"; validate confirms each fetch target has ≥1 non-shop source
* `P3` ✅ Locked quest gates — NPC quest list shows `[locked]` entries with "Requires: X" for quests with unmet prerequisites; fixes mountain_trial invisible wall
* `8.78d` ✅ 24h shops — night merchant restriction removed; day/night still affects combat and wolf availability
* `P2` ✅ Storm cost surfaced — pre-fight warning on storm days; UTC midnight reset countdown when hunts reach 0
* `P1` ✅ Day/night + weather HUD — 4th row in stat panel; icon + text; `getTimeOfDay()` + `worldState.weather`; `#ffe8a0` day / `#aac4ff` night
* `8.78j/P4` ✅ Daily bounty in quest log — `worldState.bountyEnemy` shown as header; locked-but-started quests show gate labels in global log

Build: 340KB. Validation: 0 issues. Tests: 811 passed (2 pre-existing flakes unrelated to 8.78).

Full spec: [docs/phases/8.78-game-readiness.md](docs/phases/8.78-game-readiness.md)

---

## Bugfix v0.8.5 — COMPLETE

Confirmed bugs fixed before any external player touched the build.

* `BF-00` Arbiter fraud/rollup verification disconnected — client sent on `rollup`/`fraud_proof`; arbiter listened on `rollup_submit`/`fraud_report`. Fixed: shared action-name constants; verify `JSON.stringify(packet.rollup)` against `packet.signature`.
* `BF-01` `ancient_throne` never completed — `receiver: 'sage'` but sage not in `throne_room`. Fixed: `receiver: null`, auto-complete on room entry.
* `BF-02` `ancient_throne` missing from `packer.js` QUEST_MAP — quest state never synced. Fixed: added to allowlist; validation test ensures every QUESTS id appears in QUEST_MAP.
* `BF-03` Craft station hint fired on wrong room — `includes(from)` should be `includes(to)`. Fixed.
* `BF-04` `strength_elixir` buff never expired — legacy `buffs.activeElixir` path. Fixed: migrated to `statusEffects` with 50-round duration.
* `BF-05` Explore quest silently failed if player already in target room. Fixed: check on quest accept, advance immediately.
* `BF-06` Arbiter beacon schema mismatch — client read `state.world_seed`/`state.last_tick`; arbiter published `{ seed, day, rollups }`. Fixed: versioned beacon schema (`schema_version: 1`), field names aligned, `/bans` endpoint added.
* `BF-07` Multi-prerequisite quests (`ancient_throne`) showed as available before prereqs done. Fixed: normalize `prerequisite` to array in `canvas-menu.js` and `actions.js`.
* `BF-08` Fraud-proof witness exploit — arbiter verified only witness signature, not proposer's. Fixed: fraud report must include proposer's signed rollup + Merkle proof; arbiter verifies proposer signature before acting.

Bugfix release commits: `4d8b100`, `6563229`, `59e96ae`, `b4a4d63`.

---

## Phase 8.5: Mobile-First Alpha Slice — COMPLETE

Made the existing slice feel good enough to hand to early players.

Slices: `8.5a` movement feel/touch affordances · `8.5b` traversability validator · `8.5c` constrained terrain generation · `8.5d` tile vocabulary · `8.5e` first-session path

Key outcomes:
* Tap/click movement gives readable feedback; blocked moves fail visibly
* Every authored room has a traversability model; spawn→exit paths guaranteed
* Deterministic terrain generation respects exits and authored interactables
* Biome/path/obstacle/structure tiles are legible on mobile
* Opening arc guard → tavern → market/mill/herbalist → forest/ruins reads clearly without debug literacy

---

## Phase 8.525: PNG Authoring Pipeline — COMPLETE

Made PNGs the authoring input without changing the palette-driven runtime model.

* Source art under `assets/source/`; specs in `assets/spec/manifest.json`
* `npm run assets:compile` converts 4-color PNGs → checked-in modules under `src/generated/assets/`
* Runtime prefers compiled asset masks; falls back to legacy procedural shapes for unmigrated ids
* Starter migrated: player directional bases, wolf, tree, stall, bookshelf, fireplace

---

## Phase 8.75: Reactive NPC Dialogue and World Voice — COMPLETE

Gave NPCs context-aware dialogue that reflects world state and player history.

* ✅ Expanded NPC dialogue corpora with contextual pools (`base`, `scarcity`, `time_night`, `season_*`, `post_quest_*`)
* ✅ Template string interpolation for dialogue lines (`${playerName}`, `${scarcityItem}`, `${season}`)
* ✅ `getNPCDialogue` resolves context-aware tags from `worldState` and `localPlayer`
* ✅ `localPlayer` context threaded through command and movement systems to dialogue generation
* ✅ Regression tests for dialogue context tagging and template interpolation

Delivered in commit `44c7b04`.

---

## Phase 8.55: Visual Identity, Sprites, Tiles, and Room Art — COMPLETE

Made the game look intentional and screenshot-worthy before private alpha.

Slices: `8.55a` graphics bible · `8.55b` player base design · `8.55c` sprite/scenery scale system · `8.55d` key-room composition · `8.55e` HUD/overlay art pass

Key outcomes:
* Visual language codified in `docs/VISUAL_BIBLE.md`; tile families, palette rules, and scale rules are explicit
* Player silhouette instantly readable on small mobile screens; distinct from NPCs/enemies
* Major scenery classes (bookcases, doors, trees, ruins) have believable scale relative to player
* Key rooms (tavern, market, mill, herbalist, forest edge, ruins) are screenshot-worthy
* HUD, overlays, room banners, dialogue, and menus share one visual language

---

## Phase 8.7: Retention, Progression Depth, and Daily Rituals — COMPLETE

Created reasons to return daily and gave players a visible horizon past 20 minutes.

* `8.7a` ✅ `forestFights` reset and recovery loops confirmed
* `8.7b` ✅ Daily Bounty system with gold rewards and `/status` visibility
* `8.7c` ✅ `ancient_throne` updated to capstone kill quest
* `8.7d` ✅ Rewards and difficulty tuned for endgame horizon
* `8.7e` ✅ Zone-based danger gates, NPC threshold warnings, equipment soft-checks
* `8.7f` ✅ Throne Guardian boss, Ancient Crown unique drop, grand room prose

---

## Phase 8.95: Engineering Hardening — COMPLETE

Raised reliability before exposing the game to strangers.

* `8.95a` ✅ Split `network/index.js` → `actions.js` + coordinator
* `8.95b` ✅ Per-peer message throttle: 20 msg/s rolling 1s window
* `8.95c` ✅ Ghost-peer TTL: auto-evict after 10 min without presence update
* `8.95d` ✅ Graceful shard reconnect with exponential backoff (1s → 30s cap)
* `8.95e` ✅ VPS fallback: all arbiter fetches have `AbortSignal.timeout` + `.catch`
* `8.95f` ✅ Shard rebalancing: `shard:migrate` at 80 peers
* `8.95g` ✅ Bundle: 296.8 KB minified (well under 500 KB)
* `8.95h` ✅ Hard-state replay: queued ops submitted as signed rollup batch on arbiter reconnect
* `8.95i` ✅ Dead content surfaced: locked-exit hints, crafting menu, scarcity/surplus/threat in status
* `8.95j` ✅ Arbiter `/health` endpoint and 30-min watchdog
* `8.95k` ✅ `forestFights` local calendar fallback for offline reset
* `8.95l` ✅ `strength_elixir` reachable via canvas inventory + `use` command
* `8.95m` ✅ Shared enemy double-loot race: 3s `claimedAt` window
* `8.95n` ✅ `stableStringify()` for JSON key-order determinism in sign/verify
* `8.95o` ✅ Arbiter IP removed from Gist; peer discovery via Trystero BitTorrent tracker
