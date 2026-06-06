# Fenhollow Agent Handbook

This file is the current source of truth for AI agents working in this repo. It is intentionally short. Historical design discussion and superseded phase notes belong in [DECISIONS.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/DECISIONS.md), not here.

## Architecture

Fenhollow is a serverless P2P browser MMO:

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
* Keep the build under roughly 1MB minified unless there is a clear reason

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

These event shapes are contracts. All emitters and listeners must match exactly.

| Namespace | Event | Payload |
| :---- | :---- | :---- |
| combat | `combat:hit` | `{ attacker, target, damage, crit }` |
| combat | `combat:dodge` | `{ attacker, target }` |
| combat | `combat:death` | `{ entity, loot }` |
| player | `player:levelup` | `{ level }` |
| player | `player:move` | `{ from, to }` — **room transition only** (ADR-014) |
| player | `player:step` | `{ from, to, x, y }` — same-room tile motion |
| item | `item:pickup` | `{ item }` |
| npc | `npc:speak` | `{ npcName, text }` |
| quest | `quest:progress` | `{ questId, name, current, total }` |
| quest | `quest:complete` | `{ name, rewards }` |
| input | `input:action` | `{ action, type: 'down'\|'up' }` |
| world | `world:event` | `{ event, scarcity, surplus, weather }` |
| world | `world:wild` | `{ event, narrative }` — wild/chaos events (Phase 8.77) |
| peer | `peer:move` | `{ id, location, level }` |
| peer | `peer:leave` | `{ id }` |
| shard | `shard:migrate` | `{ targetRoom }` |
| ui | `ui:menu` | `{ type, title, entries, context }` |
| ui | `ui:back` | `{}` |
| ui | `ui:shake` | `{}` |
| dialogue | `dialogue:closed` | `{ speakerId }` |

When changing any event payload: update all emitters, all listeners, the table above, and tests in the same patch.

## Drift Control

These rules are meant to stop phase drift:

* A phase is not done until runtime, authored content, UI, and tests all agree.
* If a change introduces or renames an id, action name, event field, quest, room, or schema key, add a regression test that fails when any consumer is stale.
* Shared concepts between client, arbiter, and content should live in one source of truth or a generated contract, not copied literals.
* Prefer `npm run verify` for implementation work. `build` and `test` alone are not enough when behavior or content changed.
* If a fix is described in prose, the codebase should contain the executable check for that prose.

## Verification

After implementation work:

1. Run `npm run verify`.
2. If `verify` is too expensive for the slice, run `npm run build` and `npm test` and explain why.
3. If you changed content, room topology, event payloads, quest progression, or player-facing command/UI surface, add or update regression coverage in `src/tests`.
4. If the change crosses client/arbiter/network/content boundaries, add a contract test or shared validator in the same patch.

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

BF-00 through BF-08 fixed. Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)  
Release commits: `4d8b100`, `6563229`, `59e96ae`, `b4a4d63`

### Phase 8.5 — COMPLETE

Mobile-first UX, traversability validation, constrained terrain generation, tile vocabulary, onboarding arc. Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)

### Phase 8.525 — COMPLETE

PNG authoring pipeline → compiled procedural assets under `src/generated/assets/`. Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)

### Phase 8.55 — COMPLETE

Visual identity, graphics bible, sprite scale, key-room composition, HUD art pass. Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)

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

### Phase 8.7 — COMPLETE

Daily retention loops, bounty system, `ancient_throne` capstone, Throne Guardian boss, zone danger gates. Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)

### Phase 8.75: Reactive NPC Dialogue and World Voice

Slices: `8.75a` contextual corpus tagging · `8.75b` template string interpolation · `8.75c` quest-aware line switching · `8.75d` richer corpora · `8.75e` (post-VPS) arbiter-cached LLM flavour

Acceptance bar: barkeep produces scarcity-event-aware line; Sage produces post-ruins line; lines contain world-state-injected values; `npm test` passes.

### Phase 8.76: First Impression Polish Sprint — COMPLETE

**Mandatory gate on Phase 8.8.** Fixes: render cache visibility bug, jerky movement tween, HUD/exit overlap, mobile touch input (resource nodes), weather visuals, animated sprites, NPC/enemy patrol AI, room graphics audit.

Slices: `P0` cache · `P0b` smooth movement · `P0c` HUD · `P1` input (Smart Tap + ECS Resources) · `P2` weather · `P3` sprites · `P4` patrol AI · `P5` room audit (integrity pass)

Full spec (root causes, code locations, cohesion table): [docs/phases/8.76-polish-sprint.md](docs/phases/8.76-polish-sprint.md)

### Phase 8.77: World Vitality

Slices: `8.77a` Blaseball-style wild events (6 event types, `WILD_EVENTS` table, `world:wild` bus event, `threat >= 3` gate) · `8.77b` NPC Dialogue 2.0 (intent-driven selector, `npcVisitCounts` memory stubs, post-VPS LLM option)

Full spec: [docs/phases/8.77-world-vitality.md](docs/phases/8.77-world-vitality.md)

### Phase 8.78: Game-Readiness Pass — COMPLETE

**Gate for Phase 8.8 and Phase 8.9.** Fixed core loop softlocks, missing gather sources, invisible game mechanics, and post-capstone dead end.

Slices: `8.78a` resource nodes (log/ore in forest+cave+mountain) · `P0` depletion gate (one gather/node/day per player) · `8.78b` room clutter + scatter wall-exclusion · `8.78c` quest text + prerequisite labels · `8.78d` 24h shops · `P1` day/night+weather HUD row · `P2` storm fight cost warning + reset timer · `P3` locked quest gate labels in NPC menus · `P4/8.78j` daily bounty in quest log

Full spec: [docs/phases/8.78-game-readiness.md](docs/phases/8.78-game-readiness.md)

### Phase 8.76 P5 — Integrity Audit — COMPLETE (2026-05-17)

Comprehensive codebase audit verifying all 26 rooms, quest chains, combat math, networking, and rendering integrity. Root-cause diagnosis: scattered resources (logs, ore, herbs, mushrooms, fishing) were procedural-only and not ECS entities, blocking mobile tap-to-gather. Commits:

* **Commit 1**: Promoted scattered resources to ECS entities with `Component.Gatherable` + `Component.RoomScoped`; stop procedural draw and query entities instead.
* **Commit 2**: Smart tap in `events.js` for adjacent resources sets `PendingInteract`; movement-system resolver fires `INTERACT` on arrival. Gather 🌿 and Fish 🎣 contextual buttons added.
* **Commit 3**: Strengthened `validate.js` with bidirectional-exit and reverse-stair assertions; fixed `UIOverlay` entity leak (now deletes expired overlays); retired fully-migrated `buffs` field (features live on `statusEffects`); extended `quest:progress` payload with `questId`.
* **Commit 4**: Updated CLAUDE.md "Buff integrity" rule to reflect `statusEffects`-only approach; logged findings in this entry.

Findings deferred: `handleRest` state-split (localPlayer.hp vs ECS health.current) revisit if sync changes; `simulation.js:60` seed=0 fallback flagged for next networking pass.

### Phase 8.8: Feedback Instrumentation and Lightweight Analytics

Goal: learn what players use without building a heavy telemetry system.

* Add bounded anonymous counters for session flow, room visitation, menu/command usage, quests, crafting, rests, deaths, and session bands
* Prefer compact summaries over raw logs
* Hard-cap storage and payload volume so telemetry stays small

Suggested implementation slices:

* `8.8a` Analytics event schema and storage budget — *reference: Google RAPPOR (CCS 2014) for local differential privacy on client-side counters; clients add calibrated noise before reporting so the server learns aggregate patterns without individual behaviour*
* `8.8b` Client-side aggregation and bounded counters
* `8.8c` Arbiter/reporting path for compact summaries
* `8.8d` Debug/admin visibility for product questions

### Phase 8.9: Private Alpha Launch Prep

Goal: prepare a small invite-only browser alpha.

* Final mobile-first polish on layout, touch controls, text sizing, reconnects, and session resilience
* Clear onboarding and first-10-minute experience
* Simple off-game feedback loop for bug reports and confusion

Suggested implementation slices:

* `8.9a` Mobile layout and interaction polish — full spec: [docs/phases/8.9a-mobile-polish.md](docs/phases/8.9a-mobile-polish.md)
* `8.9b` Reconnect, persistence, and session resilience pass — full spec: [docs/phases/8.9b-session-resilience.md](docs/phases/8.9b-session-resilience.md)
* `8.9c` First-10-minute onboarding pass — full spec: [docs/phases/8.9c-onboarding.md](docs/phases/8.9c-onboarding.md)
* `8.9d` Private-alpha feedback and bug-report workflow

### Phase 8.79: Visual Overhaul — Art & UX (planned)

Full plan: [~/.claude/plans/cosmic-sauteeing-muffin.md](~/.claude/plans/cosmic-sauteeing-muffin.md)

Comprehensive visual and UX quality pass targeting SNES Zelda / Stardew Valley pixel-art fidelity:

* **Player sprites + animation**: Redesigned base sprites (`player`, `player_back`, `player_side`); 4-frame walk cycle (`_walk1`–`_walk4` per direction); combat poses (`player_attack`, `player_attack_side`, `player_attack_back`, `player_hurt`)
* **Enemy redesign**: All 10 enemy types (wolf, bandit, goblin, skeleton, wraith, ruin_shade, cave_troll, mountain_troll, crab, throne_guardian) redrawn with distinct silhouettes and the new 5th palette color
* **5th palette color**: Add value `5` = deep shadow (`#444444`) to the grayscale→palette pipeline in `graphics.js` and `compiled-assets.js`; extend `applyPalette()` and all PALETTES entries; update PNG compile pipeline to detect RGB(68,68,68)→`5`
* **Tile redesign + blending**: All tile types improved to 5-tone quality; `drawTile()` accepts `neighbors` arg; `blendEdge()` draws organic 3-row dithered transitions (grass→dirt fringe, wall drop-shadow, water wave fringe, ice crack extension)
* **Scenery redesign**: Tree (SNES RPG sphere canopy + bark trunk), rock, torch, grave, barrel, mushroom, altar, ore, herbs, log, bones
* **Room redesigns**: Every room — bandit_camp, frozen_lake, tavern, ruins, ruins_descent, cave, catacombs, cemetery, library, mill — gets logical tile layout, wall-adjacent scenery, and correct exit positions
* **Navigation bug fixes**: (a) ruins_descent north-wall exit tile at y=0 moved to center stairs at 5,5 — no longer teleports on north walk; (b) catacombs dual north-corridor exits separated — ruins_descent goes to center stairs 7,6, cemetery stays at 7,0
* **Storm**: Zone-gated (only wilderness/exterior); increased to 80 streaks, 2px, α 0.55; lightning flash via `gameTime % 8 < 0.05`
* **Fog**: Replace radial gradient with 8×8px dithered patch grid driven by `Math.sin(gameTime/2000 + ...)`
* **UI/HUD**: Dialog text margin fix + measured word-wrap; NPC portraits in dialog header; SNES-window corner treatment; heart-based HP display (10 hearts, LttP/Secret of Mana style); button raised/pressed states; status pill badges; heart fanfare and toast ornaments

### Phase 8.95: Engineering Hardening — COMPLETE

> **Ordering note**: treat 8.95 as a mandatory gate on Phase 8.9 despite the lower suffix.

All 15 slices complete (network split, throttle, ghost-peer TTL, reconnect backoff, VPS fallback, shard rebalancing, bundle 296.8 KB, hard-state replay, dead content surfaced, arbiter watchdog, offline fight reset, buff items, loot race fix, stableStringify, IP privacy). Full detail: [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md)

### Phase 9: Arbiter Credibility, Balance Ops, and Live Tuning

Goal: support organic growth without betraying the technical premise.

* Continue the Phase 6 hardening path where it materially improves trust
* Add live tuning hooks for economy, event frequency, rewards, and enemy scaling
* Use analytics to prune dead features and tune repeated loops
* Implement shard-level rebalancing signals so rooms above capacity push stragglers toward quieter shards

Suggested implementation slices:

* `9a` Phase 6 minimum viable hardening follow-through (Minisketch presence sync, commit-reveal for loot contention) — *references: Al-Bassam, Sonnino, Buterin 2019 (arXiv:1809.09044) for minimum witness-set size in optimistic fraud proofs; Kamvar, Schlosser, Garcia-Molina WWW 2003 (EigenTrust) for sockpuppet-resistant witness weighting via eigenvector trust scores*
* `9b` Live-tuning controls: runtime-editable knobs for enemy spawn rate, loot weights, and scarcity thresholds via arbiter config push
* `9c` Economy and combat balancing operations: audit XP curve, loot tables, and gold sinks against 10-, 30-, and 60-minute session data
* `9d` Analytics-informed pruning: remove or demote dead-end mechanics surfaced by Phase 8.8 counters
* `9e` Shard load balancing: arbiter tracks per-shard census and broadcasts migrate hints to clients above 80-peer threshold — *references: Naumenko et al. SIGCOMM 2019 (Erlay) for reconciliation set-size estimation applicable to shard migration; Cannon GDC 2011 / Fiedler 2010 (GGPO / Gaffer on Games) for rollback netcode on top of `hardStateQueue` to improve feel at 200–400ms latency*
* `9g` Audio completeness pass — weather (storm/fog ambient loops), quest-complete stinger, and audio resume affordance ("tap to enable sound") on first load; sourced from 2026-05-15 audit
* `9h` Sprite cache tuning — replace FIFO-evict-at-64 with LRU sized against animated frame count; add entity y-sort pass before draw; sourced from 2026-05-15 audit
* `9f` World expansion — the dungeon currently has 5 rooms — *reference: Gumin 2016 (Wave Function Collapse) for constraint-based tile map generation; entirely browser-runnable, no dependencies, usable for new dungeon or seasonal layout variants*; the dungeon currently has 5 rooms and 2 enemy types (wraith, cave_troll); the mountain pass has 1 room and 1 enemy (mountain_troll); there is no weapon-progression gap between `steel_sword` (mountain_trial reward) and `magic_staff` (capstone reward); add at least one new zone (e.g. the Undercroft or Collapsed Tower) with a new enemy type, new loot, and a connecting quest chain; new content must pass the room-integrity cohesion check before merge

### Phase 10: Public Beta Preparation

Goal: move from private alpha to a small public launch without overbuilding.

* Refine the external pitch around real differentiators: shared deterministic world, Pi Zero Arbiter, procedural art/audio, mobile-first browser MMO
* Improve onboarding, landing-page copy, and sharing surfaces
* Establish a basic content/event cadence so returning players always have something new
* Revisit monetization only after retention and audience justify it; keep ads as a fallback and explore cosmetic-only IAP if session depth warrants it

Suggested implementation slices:

* `10a` External pitch and differentiator clarity: update README, social preview, and any landing page to lead with what makes Fenhollow different
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

Last checkpoint commits: `4d8b100` (arbiter peer snapshot), `6563229` (arbiter ban persistence), `59e96ae` (networking patch), `b4a4d63` (offline fight reset).

Do one smoke-test pass after syncing; do not re-open completed arbiter presence, ban persistence, or hard-state replay paths unless a new test fails.

## References

* [DECISIONS.md](DECISIONS.md) — historical ADR log
* [CLAUDE.md](CLAUDE.md) — implementation guardrails
* [GEMINI.md](GEMINI.md) — Gemini-specific working guide
* [docs/phases/COMPLETE.md](docs/phases/COMPLETE.md) — full specs for all completed phases
* [docs/phases/8.76-polish-sprint.md](docs/phases/8.76-polish-sprint.md) — active phase full spec
* [docs/phases/8.77-world-vitality.md](docs/phases/8.77-world-vitality.md) — next phase full spec
* [docs/PRODUCT.md](docs/PRODUCT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTENT_RULES.md](docs/CONTENT_RULES.md), [docs/VISUAL_BIBLE.md](docs/VISUAL_BIBLE.md) — model-neutral product/architecture/content/visual rules
