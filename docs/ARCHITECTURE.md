# Architecture

## Runtime Model

Hearthwick is a serverless P2P browser game with a lightweight authoritative Arbiter:

* clients simulate and render locally
* peers exchange signed state/action information
* the Arbiter signs shared-world state and validates rollups/fraud reports
* the Arbiter is not a full central game server

## Major Boundaries

* `src/content/*`: authored data and validation
* `src/commands/*`: player command handlers
* `src/rules/*`: pure deterministic logic
* `src/systems/*`: runtime ECS/gameplay systems
* `src/graphics/*`: renderer and procedural art
* `src/ui/*`: DOM shell and menus
* `src/network/*`: transport, presence, sync, packers
* `src/security/*`: signing, verification, Merkle helpers
* `arbiter/index.js`: Pi-side arbiter logic

## Determinism

Determinism is load-bearing:

* no `Math.random()` in simulation, arbiter logic, or network validation
* world state should derive cleanly from seed/day plus minimal arbiter state
* integer-first logic is preferred for reproducibility

## Event Contracts

Event semantics matter:

* `player:move` is room transition only
* `player:step` is same-room tile movement
* event payload shapes are contracts, not suggestions

When changing an event:

* update all emitters
* update all listeners
* update tests in the same patch

## Public Surface vs Internal Surface

Not every implemented subsystem is first-class product UX.

Public/default player surface:

* movement
* combat
* inventory/use/equip
* crafting
* quests
* shops/bank
* map/stats/status

Internal or demoted surfaces may remain in code for later use, but should not quietly leak back into UI or help text.

## Performance and Bundle Constraints

* no new npm dependencies without explicit approval
* keep the client bundle around the current 250KB target
* Pi Zero W arbiter work must stay cheap: O(1) or O(log n) per event where possible

## Asset Philosophy

* procedural assets by default
* do not casually introduce external sprite sheets, audio packs, or heavyweight editors
* authored room/tile work should still respect the lightweight browser build
