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
* Keep the build under roughly 250KB minified unless there is a clear reason

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

### Phase 8.5: Mobile-First Alpha Slice

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

### Phase 8.55: Visual Identity, Sprites, Tiles, and Room Art

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

Goal: make the Arbiter visible in the play experience.

* Add deterministic shared daily events such as scarcity spikes, surplus days, or threat surges
* Surface those events clearly in HUD, room presentation, and NPC flavor
* Keep event state cheap enough for the Pi Zero W and derivable from day plus minimal arbiter state

Suggested implementation slices:

* `8.6a` Event state model and deterministic derivation rules
* `8.6b` Scarcity/surplus/threat event content
* `8.6c` UI surfacing and NPC/world flavor integration
* `8.6d` Balancing and validation for shared daily events

### Phase 8.7: Retention and Daily Rituals

Goal: create reasons to return daily before there is large-scale social density.

* Tighten short daily loops around recovery, fights, world events, and resource pressure
* Add mobile-friendly short-term goals and clearer midgame continuity
* Keep sessions light and avoid spreadsheet-MMO drift

Suggested implementation slices:

* `8.7a` Daily recovery and short-session ritual pass
* `8.7b` Short-term goal system and return hooks
* `8.7c` Midgame quest-chain continuity
* `8.7d` Retention balancing without grind inflation

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

### Phase 9: Arbiter Credibility, Balance Ops, and Live Tuning

Goal: support organic growth without betraying the technical premise.

* Continue the Phase 6 hardening path where it materially improves trust
* Add live tuning hooks for economy, event frequency, rewards, and enemy scaling
* Use analytics to prune dead features and tune repeated loops

Suggested implementation slices:

* `9a` Phase 6 minimum viable hardening follow-through
* `9b` Live-tuning controls and safe runtime knobs
* `9c` Economy and combat balancing operations
* `9d` Analytics-informed pruning and iteration

### Phase 10: Broader Launch Preparation

Goal: move from private alpha to a small public launch without overbuilding.

* Refine the external pitch around the real differentiators: shared deterministic world, Pi Zero Arbiter, procedural art/audio, and mobile-first browser MMO slice
* Improve onboarding, landing-page copy, and sharing surfaces
* Establish a basic content/event cadence
* Revisit monetization only after retention and audience justify it

Suggested implementation slices:

* `10a` External pitch and differentiator clarity
* `10b` Landing/onboarding/share-surface pass
* `10c` Content and event cadence planning
* `10d` Post-retention monetization evaluation

## References

* [DECISIONS.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/DECISIONS.md) is the historical ADR log.
* [CLAUDE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/CLAUDE.md) is the short implementation guardrail companion.
* [GEMINI.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/GEMINI.md) is the Gemini-specific working guide.
* [docs/PRODUCT.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/PRODUCT.md), [docs/ARCHITECTURE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/ARCHITECTURE.md), [docs/CONTENT_RULES.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/CONTENT_RULES.md), and [docs/VISUAL_BIBLE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/VISUAL_BIBLE.md) are the model-neutral reference docs.
