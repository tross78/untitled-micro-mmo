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

### Phase 8.55: Visual Identity, Sprites, Tiles, and Room Art

Goal: make the game look intentional and screenshot-worthy before private alpha.

* Finalize player sprite silhouette, walk frames, and small-screen readability
* Improve enemy and NPC readability so common entities are instantly distinguishable
* Tighten biome palettes, tile cohesion, and transition readability
* Improve room composition in key spaces like tavern, market, mill, herbalist hut, forest edge, and ruins
* Unify HUD, overlays, room banners, and menus under one visual language

### Phase 8.6: Shared-World Arbiter Events

Goal: make the Arbiter visible in the play experience.

* Add deterministic shared daily events such as scarcity spikes, surplus days, or threat surges
* Surface those events clearly in HUD, room presentation, and NPC flavor
* Keep event state cheap enough for the Pi Zero W and derivable from day plus minimal arbiter state

### Phase 8.7: Retention and Daily Rituals

Goal: create reasons to return daily before there is large-scale social density.

* Tighten short daily loops around recovery, fights, world events, and resource pressure
* Add mobile-friendly short-term goals and clearer midgame continuity
* Keep sessions light and avoid spreadsheet-MMO drift

### Phase 8.8: Feedback Instrumentation and Lightweight Analytics

Goal: learn what players use without building a heavy telemetry system.

* Add bounded anonymous counters for session flow, room visitation, menu/command usage, quests, crafting, rests, deaths, and session bands
* Prefer compact summaries over raw logs
* Hard-cap storage and payload volume so telemetry stays small

### Phase 8.9: Private Alpha Launch Prep

Goal: prepare a small invite-only browser alpha.

* Final mobile-first polish on layout, touch controls, text sizing, reconnects, and session resilience
* Clear onboarding and first-10-minute experience
* Simple off-game feedback loop for bug reports and confusion

### Phase 9: Arbiter Credibility, Balance Ops, and Live Tuning

Goal: support organic growth without betraying the technical premise.

* Continue the Phase 6 hardening path where it materially improves trust
* Add live tuning hooks for economy, event frequency, rewards, and enemy scaling
* Use analytics to prune dead features and tune repeated loops

### Phase 10: Broader Launch Preparation

Goal: move from private alpha to a small public launch without overbuilding.

* Refine the external pitch around the real differentiators: shared deterministic world, Pi Zero Arbiter, procedural art/audio, and mobile-first browser MMO slice
* Improve onboarding, landing-page copy, and sharing surfaces
* Establish a basic content/event cadence
* Revisit monetization only after retention and audience justify it

## References

* [DECISIONS.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/DECISIONS.md) is the historical ADR log.
* [CLAUDE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/CLAUDE.md) is the short implementation guardrail companion.
