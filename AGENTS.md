# Hearthwick Agent Handbook

This file is the current source of truth for AI agents working in this repo. It is intentionally short. Historical design discussion and superseded phase notes belong in [DECISIONS.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/DECISIONS.md), not here.

## Architecture

Hearthwick is a serverless P2P browser MMO:

* Trystero (WebTorrent/WebRTC) for transport
* Ed25519 for identity and signing
* A Pi Zero W Arbiter for day ticks, shared-world state signing, and rollup/fraud validation
* No traditional server-side game simulation

Core product shape:

* Mobile-first browser game, desktop second
* 75% solo / 25% multiplayer
* Shared Arbiter-driven world events are the signature differentiator
* Monetization is not part of the near-term roadmap

## Source Layout

| Path | Purpose |
| :---- | :---- |
| `src/main/*` | Browser bootstrap, wiring, event subscriptions |
| `src/app/*` | Runtime loop and app-level sync helpers |
| `src/content/*` | Authored data, registries, parsing, validation |
| `src/commands/*` | Command handlers and player action logic |
| `src/rules/*` | Pure deterministic rules and derivation helpers |
| `src/systems/*` | ECS/runtime systems for gameplay, combat, movement, UI |
| `src/graphics/*` | Canvas renderer and procedural art |
| `src/ui/*` | DOM shell, actions, menus, status, debug/log adapters |
| `src/network/*` | P2P transport, presence, simulation sync, packers |
| `src/security/*` | Signing, verification, Merkle helpers |
| `src/state/*` | Shared mutable state, persistence, event bus |
| `src/infra/*` | Constants and environment-derived config |
| `src/domain/*` | ECS/domain types and components |
| `arbiter/index.js` | Pi-side arbiter logic |
| `src/tests/*` | Regression suites |

Build target:

* `npm run build`
* Bundles `src/main.js` into `dist/main.js`
* Keep the build under roughly 500KB minified unless there is a clear reason

## Product Guardrails

* Canvas-native play is the main experience.
* Buttons/chips are convenience UI, not separate game logic.
* CLI is debug/power-user only and must not be required for normal play.
* The default player-facing surface is: movement, combat, inventory/use/equip, crafting, quests, shops, bank, map, status, and stats.
* `trade` and `duel` may remain implemented internally, but are not first-class product surfaces.
* `say`, emotes, and `vision` are not part of the current gameplay loop.

## Cohesion Guardrails

* Do not ship authored content, UI, and command/runtime behavior separately. A feature is incomplete until all three agree.
* If you add or change a room, verify: exits, exit tiles, prose, NPC placement, enemy placement, and player-facing movement affordances together.
* If you add an item id anywhere, add or update validation/tests in the same patch.
* If you change event semantics, update the canonical payload table and all listeners in the same patch.
* If `scarcity`, `surplus`, or `threat` are surfaced prominently, they must have real gameplay impact in that same build.
* Non-directional authored exit aliases are acceptable for topology, but direct player movement UI remains cardinal plus `up` / `down` unless the parser is extended too.
* Gameplay math should use `statusEffects` for temporary effects. Legacy `buffs` fields are compatibility only.

## Canonical Bus Payloads

These event shapes are treated as contracts:

| Event | Payload |
| :---- | :---- |
| `combat:hit` | `{ attacker, target, damage, crit }` |
| `combat:dodge` | `{ attacker, target }` |
| `combat:death` | `{ entity, loot }` |
| `player:levelup` | `{ level }` |
| `player:move` | `{ from, to }` |
| `player:step` | `{ from, to, x, y }` |
| `item:pickup` | `{ item }` |
| `npc:speak` | `{ npcName, text }` |
| `quest:progress` | `{ name, current, total }` |
| `quest:complete` | `{ name, rewards }` |
| `input:action` | `{ action, type: 'down'|'up' }` |

`player:move` is room-transition only. Same-room movement uses `player:step`.

## Verification

After implementation work:

1. Run `npm run build`.
2. Run `npm test`.
3. If you changed content, room topology, event payloads, quest progression, or player-facing command/UI surface, add or update regression coverage in `src/tests`.

Manual checks that still matter:

* Empty `worldState.seed` must not crash rendering or hide expected NPCs/exits.
* Canvas click resolution must still distinguish NPC, enemy, and empty tile correctly.
* Room transitions must emit `player:move`; same-room tile motion must not.
* Move buttons/autocomplete must only surface directions the parser actually supports.
* Item ids referenced by loot, shops, recipes, quests, scarcity, and interactions must all resolve.
* Authored indoor/shop rooms that imply a resident NPC must place that NPC explicitly.
* No `Math.random()` in deterministic simulation, network validation, or arbiter logic.

## Current Status

Completed and relevant:

* Phases `4` through `5`: mobile-first UX, modularization, externalized content, NPCs/quests/bank, ads scaffolding, Markov flavor dialogue
* Phases `7` through `7.5`: graphical foundations, spatial entities, canvas renderer, audio, persistence
* Phase `8.3`: cohesion hardening, validation, room/content/runtime alignment
* Phase `8.4`: core-loop cleanup, economy pass, command/UI pruning

Current shape after `8.4`:

* Progression runs through the town loop, mill, herbalist, forest, and ruins
* Scarcity and market surplus affect shop prices directly
* Bread and healing-elixir loops are part of real progression
* The public command surface is intentionally smaller than the internal runtime surface

Still open:

* Phase `6` anti-cheat/trading hardening is not finished
* Arbiter-led shared-world events are still more promise than lived player experience
* Visual cohesion needs its own polish pass before a private alpha
* The new PNG-to-compiled asset pipeline exists, but most art families are still only partially migrated

## Roadmap

Direction:

* Launch small to friends and a trusted early-feedback group
* Prioritize gameplay feel, then retention, then launch readiness
* Keep the MMO slice, but make it visually and mechanically good enough
* Mobile-first, browser-only

### Bugfix v0.8.5 — COMPLETE

These are confirmed bugs that make specific content unplayable or silently broken. Fix and ship as a patch before any external player touches the build. All are small, targeted changes.

* `BF-00` **Arbiter fraud/rollup verification is completely disconnected** — client sends on action names `rollup` and `fraud_proof` (`src/network/index.js:125-126`); arbiter listens on `rollup_submit` and `fraud_report` (`arbiter/index.js:60-61`). These have never matched. Additionally, the arbiter verifies `JSON.stringify(rollup)` (the outer wrapper) while the client signs the inner `rollup` object — so even with matching names, signature verification would fail. The entire fraud-proof pipeline is silently no-op. Fix: define a shared action-name constant file imported by both client and arbiter; verify `JSON.stringify(packet.rollup)` against `packet.signature`.
* `BF-01` **`ancient_throne` never completes** — quest has `receiver: 'sage'` but sage is in `crossroads`, not `throne_room`. Change to `receiver: null` so sync-system auto-completes on room entry. Add regression test.
* `BF-02` **`ancient_throne` missing from `packer.js` QUEST_MAP** — the hardcoded allowlist at `src/network/packer.js:131-136` must include `ancient_throne` or quest state will not sync across peers. Separately, add a validation test that every quest id in QUESTS appears in QUEST_MAP so this can never silently happen again.
* `BF-03` **Craft station hint fires on wrong room** — `events.js:235` checks `!localPlayer.visitedRooms.includes(from)` but should check `includes(to)`. The tip shows on wrong rooms and suppresses on the correct one.
* `BF-04` **`strength_elixir` buff never expires and doesn't appear in `/status`** — `inventory.js` sets `buffs.activeElixir` (legacy path) with no duration; it never ticks down, stacks on re-use, and is invisible to the `statusEffects` display. Migrate to a `statusEffects` entry with a finite duration (e.g. 50 combat rounds); combat-system already reads `statusEffects`.
* `BF-05` **Explore quest silently fails if player is already standing in target room when quest accepted** — `sync-system.js:39` gates progress on `oldLoc !== transform.mapId`; a player already in `tavern` who then accepts `find_tavern` will never progress it. On quest accept, immediately check if player is already in the target room and advance progress.
* `BF-06` **Arbiter beacon schema does not match what the client consumes** — client reads `state.world_seed`, `state.last_tick`, and fetches `/bans` (`simulation.js:68-77`); arbiter publishes `{ seed, day, rollups }` and has no `/bans` route (`arbiter/index.js:157, 232`). Client silently derives `undefined` for seed and tick on every sync. Fix: version the beacon schema (`schema_version: 1`) and align field names across client and arbiter; add `/bans` endpoint or remove the client fetch.
* `BF-08` **Fraud-proof witness exploit — arbiter can be made to ban innocent proposers** — `arbiter/index.js:130-145` verifies only the *witness's* signature on a presence object containing `disputedRoot`; it never verifies that the proposer actually signed that root. A malicious witness can include any arbitrary `disputedRoot` in their own signed presence and frame an honest proposer. Fix requires: fraud report must include the proposer's signed rollup + a Merkle proof of the disputed leaf; arbiter must verify the proposer's signature on the rollup before acting on the witness claim.
* `BF-07` **Multi-prerequisite quests not filtered correctly in canvas menu and action buttons** — `canvas-menu.js:29` and `actions.js:232` treat `prerequisite` as a single string key; the array form added for `ancient_throne` means `prereqOk` is always truthy (array is truthy) so the quest appears available before prerequisites are done. Fix: normalize to array in both files, same pattern as the command layer.

### Phase 8.5: Mobile-First Alpha Slice — COMPLETE

Goal: make the existing slice feel good enough to hand to early players.

* Improve movement feel, collision readability, and touch-first interaction
* Improve combat readability and prep/reward clarity
* Make threat, scarcity, quest progress, and crafting loops obvious without debug literacy
* Tighten the intended first-session path: guard -> tavern -> market/mill/herbalist -> forest/ruins
* Ensure every authored room either progresses, sustains, or previews future progression
* Add constrained room-terrain generation from room data rather than relying on sparse manual placement alone
* Guarantee traversability between intended spawn points, exits, and important authored interactables
* Add validation for room walkability, blocked content, and exit-to-exit path existence
* Add a visual-density pass so rooms contain enough scenery and landmark objects to feel alive without becoming noisy
* Expand the tile vocabulary enough to support clearer biome, path, obstacle, and structure language rather than overloading a few generic ground tiles

Suggested implementation slices:

* `8.5a` Movement feel and touch affordances
* `8.5b` Traversability validator and room-path guarantees
* `8.5c` Constrained room-terrain generation
* `8.5d` Tile vocabulary expansion and biome readability
* `8.5e` First-session path and onboarding cleanup

Acceptance checklist for Phase 8.5:

* `8.5a`:
  * tap/click movement gives clear feedback on the selected destination
  * blocked moves give immediate readable feedback and do not silently fail
  * direct movement affordances still only expose parser-supported directions
  * movement feel improves without changing canonical `player:move` / `player:step` semantics
* `8.5b`:
  * every authored room has a defined traversability model, not just ad hoc validation points
  * intended player spawn/entry positions can reach every intended exit for that room
  * intended exits can reach each other where the room fiction implies through-travel
  * important authored NPC/interactable positions are reachable or intentionally adjacent-interactable
  * traversal validation failures are covered by regression tests
* `8.5c`:
  * generated or semi-generated terrain is deterministic
  * terrain generation respects exits, intended spawn/entry positions, and key authored interactables
  * terrain generation does not create accidental softlocks or dead rooms
  * generation remains constrained and lightweight rather than turning into a general procgen framework
* `8.5d`:
  * biome/path/obstacle/structure tiles are more legible than before on mobile
  * tile additions create a clearer visual grammar, not just more variety
  * collision readability is preserved or improved
* `8.5e`:
  * the intended opening arc reads clearly: guard -> tavern -> market/mill/herbalist -> forest/ruins
  * a new player can find the core sustain/progression loop without relying on debug literacy
  * onboarding/help copy does not imply removed or unsupported mechanics
  * onboarding coverage is tested beyond command-registry existence

Verification bar for closing Phase 8.5:

* `npm run build` passes
* `npm test` passes
* tests exist for movement feel, traversability, terrain generation, and onboarding
* content validation covers intended spawn/entry positions, not just exits and static entities
* no `8.5` slice is considered complete if it only improves visuals while leaving content/UI/runtime out of sync

### Phase 8.55: Visual Identity, Sprites, Tiles, and Room Art — COMPLETE

Goal: make the game look intentional and screenshot-worthy before private alpha.

* Create a lightweight graphics bible covering tile taxonomy, palette rules, room composition, sprite scale, and silhouette rules
* Finalize player sprite silhouette, walk frames, and small-screen readability
* Choose a clear player-character direction in the space between SNES Zelda readability and Stardew-style warmth, then apply it consistently
* Keep player design flexible for multiplayer: one shared base body language with tint/feature variation that still preserves instant player readability
* Improve enemy and NPC readability so common entities are instantly distinguishable
* Tighten biome palettes, tile cohesion, and transition readability
* Define sprite and scenery scale consistently so objects read believably:
  * bookcases and doors must be materially larger than the player
  * trees need explicit width/height classes rather than arbitrary one-tile stand-ins
  * furniture, fences, ruins, and interior props should use repeatable size categories
* Improve room composition in key spaces like tavern, market, mill, herbalist hut, forest edge, and ruins
* Unify HUD, overlays, room banners, and menus under one visual language

Suggested implementation slices:

* `8.55a` Graphics bible and tile taxonomy
* `8.55b` Player base design, silhouette, and multiplayer variation rules
* `8.55c` Sprite/scenery scale system and size classes
* `8.55d` Key-room composition pass
* `8.55e` HUD and overlay art-direction pass

### Phase 8.525: PNG Authoring Pipeline to Compiled Procedural Assets — COMPLETE

Goal: make PNGs the authoring input without changing the lightweight palette-driven runtime model.

* Source art now lives under `assets/source/`
* Asset specs live in `assets/spec/manifest.json`
* `npm run assets:compile` converts strict 4-color PNG inputs into checked-in runtime modules under `src/generated/assets/`
* Runtime graphics prefer compiled asset masks first and fall back to legacy procedural shapes for unmigrated ids
* Starter migrated assets currently cover player directional bases, wolf, tree, stall, bookshelf, and fireplace

Acceptance checklist for Phase 8.55:

* `8.55a`:
  * the visual language is codified clearly enough that future room/tile work does not rely on taste alone
  * tile families, palette rules, room-composition rules, and scale rules are explicit and actionable
  * the tile system reflects a clearer taxonomy instead of ad hoc one-off tile additions
* `8.55b`:
  * the player silhouette is instantly readable on small mobile screens
  * the player is visually distinct from common NPCs and enemies
  * multiplayer variation exists without breaking immediate recognition of "this is a player"
  * the design direction stays between Zelda-like clarity and Stardew-like warmth
* `8.55c`:
  * major scenery and structure classes have believable scale relative to the player
  * bookcases, doors, counters, trees, ruins, and similar objects no longer read as arbitrary one-tile props where that breaks believability
  * scale rules are consistent across rooms, not just in a single showcase space
  * scale improvements do not harm traversal or collision readability
* `8.55d`:
  * key rooms have stronger focal points, landmark objects, and path readability
  * key rooms communicate their purpose visually as well as mechanically
  * the most important rooms look authored and screenshot-worthy on mobile
  * composition changes do not create navigational confusion or imply unsupported mechanics
* `8.55e`:
  * HUD, overlays, room banners, dialogue, toasts, and menus share one coherent visual language
  * gameplay-critical UI remains easy to read on mobile
  * the UI feels intentionally designed rather than layered from unrelated earlier phases
  * polish does not introduce noisy effects that reduce usability

Verification bar for closing Phase 8.55:

* `npm run build` passes
* `npm test` passes
* visual/content/render changes are accompanied by regression coverage where assumptions changed
* screenshot quality and small-screen readability are treated as explicit acceptance targets, not implied side effects
* no `8.55` slice is considered complete if it improves appearance locally while breaking room readability, gameplay clarity, or content/runtime cohesion

### Phase 8.6: Shared-World Arbiter Events

> **Ordering note**: Phase 8.6 adds player-visible arbiter events and should not ship to real players until Phase 8.95 (Engineering Hardening) is complete — shared events at scale will expose message throttle and ghost-peer gaps that 8.95 closes.

Goal: make the Arbiter visible in the play experience.

* Add deterministic shared daily events such as scarcity spikes, surplus days, or threat surges
* Surface those events clearly in HUD, room presentation, and NPC flavor
* Keep event state cheap enough for the Pi Zero W and derivable from day plus minimal arbiter state

Suggested implementation slices:

* `8.6a` Event state model and deterministic derivation rules
* `8.6b` Scarcity/surplus/threat event content
* `8.6c` UI surfacing and NPC/world flavor integration
* `8.6d` Balancing and validation for shared daily events

### Phase 8.7: Retention, Progression Depth, and Daily Rituals

Goal: create reasons to return daily and give players a visible horizon past the 20-minute mark.

Context: the review identified this as the single largest retention gap — no endgame destination means players churn before the world's depth is visible. The fix is not a theme-park gate or a level wall. Ultima Online had no hard gates at all: the world was open, danger was the gate, and sharing dangerous spaces across all skill levels was where social texture came from. Zelda gates with items (toolkit), not numbers. Stardew gates with seasons and energy (consequence), not walls. This game must do the same: progression should feel like the world responding to the player, not like velvet ropes being removed.

* Tighten short daily loops around recovery, fights, world events, and resource pressure
* Add mobile-friendly short-term goals and clearer midgame continuity
* Keep sessions light and avoid spreadsheet-MMO drift
* Make progression feel like the world opening up, not a score unlocking a door
* Name an endgame destination so there is always a horizon

Suggested implementation slices:

* `8.7a` Daily recovery and short-session ritual pass
* `8.7b` Short-term goal system and return hooks
* `8.7c` Midgame quest-chain continuity
* `8.7d` Retention balancing without grind inflation
* `8.7f` Throne Room climax content — the Throne Room is currently empty; as the capstone room for `ancient_throne` it must have authored content: a boss enemy (Throne Guardian or Ancient Wraith variant), a loot drop not available elsewhere, and flavour room description prose; the `ancient_throne` quest reward is good but the room itself must feel like an arrival, not a dead end
* `8.7e` Progression depth and endgame horizon — **do not use hard level gates or minLevel room blocks**; instead: (1) scale enemy difficulty and loot quality by zone so danger is the gate; (2) use NPC threshold warnings via `locationDialogue` (already implemented) so the Sage and Guard voice the danger before you enter; (3) add an equipment soft-check on dungeon entry (already implemented — warns but never blocks); (4) define a named endgame destination in content (the Throne Room already exists) so players can articulate what they are working toward; (5) add a quest chain that leads through the dungeon arc so progression is narrative, not numerical

### Phase 8.75: Reactive NPC Dialogue and World Voice

Goal: make NPCs feel like characters who know the world state, not random quote machines.

Context: the current Markov system generates plausible sentences from a 10-line corpus per NPC. The output is grammatically coherent but contextually blind — the barkeep says the same things whether it is the player's first visit or they just slew the forest boss. The "LLM-like" feeling in a game does not require a language model; it requires *reactivity*. Stardew Valley achieves it with hundreds of conditional lines. Dwarf Fortress achieves it with world-state injection into templates. The goal here is the same: NPCs that react to what the player has done, what day it is, what is scarce, and where the player has been.

Implementation model — layered line selection, no LLM needed:
1. **Contextual line pools**: each NPC corpus gets tagged subsets — `{ tag: 'scarcity', lines: [...] }`, `{ tag: 'quest_active', questId: 'X', lines: [...] }`, `{ tag: 'post_ruins', lines: [...] }` — selected over base lines when the condition is true
2. **World-state injection**: template strings like `"The ${season} has been hard on the ${scarcityItem} supply."` filled at render time, giving infinite surface variation from a finite corpus
3. **`locationDialogue` already live**: the Sage and Guard already use location-aware lines; extend this pattern to all NPCs
4. **Memory stubs**: NPCs note when you have completed a quest they gave and switch to a follow-up line pool — no persistent memory store needed, just check `localPlayer.quests`
5. **Post-VPS LLM option**: once the VPS relay is live (Phase 8.95e), the arbiter can proxy a single shared LLM call per day-tick per NPC, cache the result, and broadcast it as part of the daily world state — so dialogue is deterministic and shared across all players without per-player API cost

Suggested implementation slices:

* `8.75a` Contextual corpus tagging: add scarcity, threat, season, and time-of-day line pools to all NPC corpora; selector picks the most specific matching pool
* `8.75b` Template string interpolation: support `${season}`, `${day}`, `${scarcityItem}`, `${playerName}` in dialogue lines; resolve at render time from world state
* `8.75c` Quest-aware line switching: NPC switches to a post-quest line pool after the player completes a quest they gave or received
* `8.75d` Richer corpora: expand each NPC from 10 lines to 40–60 across all pools; quality over quantity — each line should be in-world and non-generic
* `8.75e` (Post-VPS) Arbiter-cached LLM flavour: arbiter generates one flavour sentence per NPC per day via an LLM proxy, signs it with the daily state, and broadcasts it; clients display it as the NPC's "today's word" — deterministic, shared, and zero per-player cost

Acceptance bar for closing Phase 8.75:

* Talking to the barkeep during a scarcity event produces a different line than on a normal day
* Talking to the Sage after completing the ruins quest chain produces a different line than before
* NPC lines contain at least one world-state-injected value (season, day, or item name)
* `npm test` passes; regression coverage for line selector logic

### Phase 8.8: Feedback Instrumentation and Lightweight Analytics

Goal: learn what players use without building a heavy telemetry system.

* Add bounded anonymous counters for session flow, room visitation, menu/command usage, quests, crafting, rests, deaths, and session bands
* Prefer compact summaries over raw logs
* Hard-cap storage and payload volume so telemetry stays small

Suggested implementation slices:

* `8.8a` Analytics event schema and storage budget
* `8.8b` Client-side aggregation and bounded counters
* `8.8c` Arbiter/reporting path for compact summaries
* `8.8d` Debug/admin visibility for product questions

### Phase 8.9: Private Alpha Launch Prep

Goal: prepare a small invite-only browser alpha.

* Final mobile-first polish on layout, touch controls, text sizing, reconnects, and session resilience
* Clear onboarding and first-10-minute experience
* Simple off-game feedback loop for bug reports and confusion

Suggested implementation slices:

* `8.9a` Mobile layout and interaction polish
* `8.9b` Reconnect, persistence, and session resilience pass
* `8.9c` First-10-minute onboarding pass
* `8.9d` Private-alpha feedback and bug-report workflow

### Phase 8.95: Engineering Hardening (Pre-Public-Alpha)

> **Ordering note**: Phase 8.95 should be completed before Phase 8.9 (Alpha Launch Prep) ships to real users. The numbering (8.95 > 8.9) is intentional — treat 8.95 as a mandatory gate on 8.9 despite the suffix.

Goal: reduce technical debt and raise reliability before exposing the game to strangers.

Motivation: the networking layer grew large during fast feature iteration and needs structural safety before public load. Message throttling, ghost-peer cleanup, and error-boundary hardening are not glamorous but directly affect first-impression stability.

Suggested implementation slices:

* `8.95a` ✅ Split `network/index.js`: `actions.js` extracted (shardActions dispatch table); `config.js`, `security.js`, `presence.js`, `shard.js`, `simulation.js` already separate; `index.js` reduced to coordinator
* `8.95b` ✅ Per-peer message throttle: drop incoming packets when a single peer sends faster than 20 msg/s over any rolling 1s window
* `8.95c` ✅ Ghost-peer TTL: players who have not sent a presence update in 10 minutes are auto-evicted from the live view
* `8.95d` ✅ Graceful shard reconnect: on WebRTC disconnect, re-run `initNetworking` with exponential backoff (1 s → 2 s → 4 s → capped at 30 s)
* `8.95e` ✅ VPS fallback code complete: all arbiter fetches have `AbortSignal.timeout` + `.catch`, `initNetworking` starts cleanly with no arbiter URL; ops step: deploy VPS, set `ARBITER_URL` env var, point bootstrap domain
* `8.95f` ✅ Shard rebalancing: at 80 peers broadcasts `shard:migrate` via `sendSeekingShard`; receiver emits `shard:migrate` bus event; no forced eviction
* `8.95g` ✅ Bundle audit: 296.8 KB minified — well under 500 KB ceiling
* `8.95h` ✅ Hard-state replay: on arbiter reconnect, queued ops are signed and submitted as a rollup batch instead of being discarded
* `8.95i` ✅ Dead content surfaced: room-entry hints for locked exits show key name + which enemies drop it; crafting menu reachable; scarcity/surplus/threat shown in status menu; `bandit_mask` bounty and `iron_key` gate both implemented
* `8.95j` ✅ Arbiter dead-man's switch: `/health` HTTP endpoint and 30-min watchdog both implemented; ops step: point UptimeRobot at `/health` before public alpha
* `8.95k` ✅ `forestFights` daily reset requires arbiter sync — offline or disconnected players never get the fight counter reset because `simulation.js` gates `isNewDay` on `hasSyncedWithArbiter`; add a local calendar fallback: if `localStorage` records a `lastFightReset` date earlier than today's UTC date, reset `forestFights` to 15 on load without waiting for arbiter
* `8.95l` ✅ `buff` type items reachable — canvas-menu inventory filter already includes `type === 'buff'` alongside `consumable`; `strength_elixir` appears and gets a `use` command
* `8.95m` ✅ Shared enemy double-loot race fixed: 3-second `claimedAt` window on `sharedEnemy` prevents two simultaneous kill handlers from both granting XP/loot
* `8.95n` ✅ JSON key-order determinism: `stableStringify()` added to `src/security/crypto.js` and used for all rollup sign/verify calls on client and arbiter
* `8.95o` ✅ Arbiter IP no longer published to Gist — `endpoint`/`PUBLIC_URL` removed from Gist payload; peer discovery relies on Trystero BitTorrent tracker room

Acceptance bar for closing Phase 8.95:

* `npm run build` passes, output ≤ 500 KB
* `npm test` passes; new regression tests for throttle, TTL eviction, and reconnect backoff
* VPS relay is reachable and arbiter fast-path works end-to-end in a staging environment
* No behaviour regression visible in manual smoke test

### Phase 9: Arbiter Credibility, Balance Ops, and Live Tuning

Goal: support organic growth without betraying the technical premise.

* Continue the Phase 6 hardening path where it materially improves trust
* Add live tuning hooks for economy, event frequency, rewards, and enemy scaling
* Use analytics to prune dead features and tune repeated loops
* Implement shard-level rebalancing signals so rooms above capacity push stragglers toward quieter shards

Suggested implementation slices:

* `9a` Phase 6 minimum viable hardening follow-through (Minisketch presence sync, commit-reveal for loot contention)
* `9b` Live-tuning controls: runtime-editable knobs for enemy spawn rate, loot weights, and scarcity thresholds via arbiter config push
* `9c` Economy and combat balancing operations: audit XP curve, loot tables, and gold sinks against 10-, 30-, and 60-minute session data
* `9d` Analytics-informed pruning: remove or demote dead-end mechanics surfaced by Phase 8.8 counters
* `9e` Shard load balancing: arbiter tracks per-shard census and broadcasts migrate hints to clients above 80-peer threshold
* `9f` World expansion — the dungeon currently has 5 rooms and 2 enemy types (wraith, cave_troll); the mountain pass has 1 room and 1 enemy (mountain_troll); there is no weapon-progression gap between `steel_sword` (mountain_trial reward) and `magic_staff` (capstone reward); add at least one new zone (e.g. the Undercroft or Collapsed Tower) with a new enemy type, new loot, and a connecting quest chain; new content must pass the room-integrity cohesion check before merge

### Phase 10: Public Beta Preparation

Goal: move from private alpha to a small public launch without overbuilding.

* Refine the external pitch around real differentiators: shared deterministic world, Pi Zero Arbiter, procedural art/audio, mobile-first browser MMO
* Improve onboarding, landing-page copy, and sharing surfaces
* Establish a basic content/event cadence so returning players always have something new
* Revisit monetization only after retention and audience justify it; keep ads as a fallback and explore cosmetic-only IAP if session depth warrants it

Suggested implementation slices:

* `10a` External pitch and differentiator clarity: update README, social preview, and any landing page to lead with what makes Hearthwick different
* `10b` Landing/onboarding/share-surface pass: shareable room screenshots, invite links that deep-link to a location, first-5-minute clarity audit
* `10c` Content cadence: bi-weekly authored world event (new quest chain, scarcity arc, or seasonal variant) without requiring a code deploy
* `10d` Post-retention monetization evaluation: define the bar (DAU, session length, repeat visits) that would justify introducing IAP cosmetics; do not ship IAP before that bar is met

### Phase 11: Scale and Community Foundations

Goal: sustain a growing player base and build lightweight community infrastructure.

* Absorb learnings from public beta and address the top reported friction points
* Add the infrastructure needed for voluntary community features without introducing a mandatory social graph
* Prepare for sustained live-ops beyond solo-developer bandwidth

Suggested implementation slices:

* `11a` Scale review: profile under 200 concurrent shards; identify and fix any O(n) client-side hotspots in player tracking, presence diffing, and rendering
* `11b` Community opt-in layer: a simple name-and-location roster visible to players who opt in; no mandatory accounts, no DMs, no guilds yet
* `11c` Moderation floor: server-side ban list propagation already exists; surface a simple report mechanism and a lightweight review queue
* `11d` Contributor and content pipeline: document how to add a quest, room, or NPC without touching engine code; aim for a CONTENT.md that a non-engineer can follow
* `11e` Live-ops sustainability: automate the daily arbiter event tick so it runs unattended; add an alert if the arbiter has been offline for more than 1 hour

## Bugfix Release Handoff

Current bugfix-release checkpoint:

* `4d8b100` `fix: restore arbiter peer snapshot directory`
* `6563229` `fix: persist arbiter bans immediately`
* Earlier bugfix checkpoints:
  * `59e96ae` `fix: ship first bugfix release networking patch`
  * `b4a4d63` `fix: scope offline fight reset to local state`

What was fixed in this release slice:

* Arbiter peer snapshots now register, prune, and list through a real presence directory instead of a no-op cache wrapper.
* Arbiter bans are now persisted in signed state, restored on restart, and broadcast immediately when added.
* `world:event`, hard-state replay, introducer seeding, and the Phase 8.6 gameplay regressions were already repaired in prior checkpoints.

What remains for the next pass:

* Push/sync the current local commits if upstream has not been updated yet.
* Do one short release-note / smoke-test pass, then stop unless a regression appears.
* Do not re-open the completed arbiter presence, ban persistence, or hard-state replay paths unless a new test fails there.

## References

* [DECISIONS.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/DECISIONS.md) is the historical ADR log.
* [CLAUDE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/CLAUDE.md) is the short implementation guardrail companion.
* [GEMINI.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/GEMINI.md) is the Gemini-specific working guide.
* [docs/PRODUCT.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/PRODUCT.md), [docs/ARCHITECTURE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/ARCHITECTURE.md), [docs/CONTENT_RULES.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/CONTENT_RULES.md), and [docs/VISUAL_BIBLE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/VISUAL_BIBLE.md) are the model-neutral reference docs.
