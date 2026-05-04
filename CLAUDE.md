# Hearthwick Implementation Guardrails

This file is intentionally short. Use it for current implementation constraints. Use `AGENTS.md` for the active roadmap and working model of the product. Use `DECISIONS.md` for historical ADRs and non-negotiable architectural decisions. Use `docs/*` for model-neutral product, architecture, content, and visual rules.

## Product Shape

* **Primary input:** canvas-native controls first. Keyboard, gamepad, and canvas clicks/taps are the main path.
* **Buttons/chips:** convenience UI layered on top of the same command/state model. They must never expose actions the parser or simulation cannot actually execute.
* **CLI:** debug and power-user only. Hidden by default. Normal gameplay must not require it.
* **Default player-facing surface:** movement, combat, inventory/use/equip, crafting, quests, shops, bank, map, status, and stats.
* **Demoted/non-core features:** trade and duel may remain implemented internally, but they are not first-class product surfaces. Social chatter/emote commands and `vision` are not part of the current gameplay loop.

## Architecture Rules

* **Modular tree:** prefer the current split layout:
  * `src/content` for authored data and validation
  * `src/commands` for command handlers
  * `src/systems` for ECS/gameplay systems
  * `src/graphics` and `src/ui` for rendering/presentation
  * `src/network`, `src/security`, `src/state`, `src/app`, `src/main` for transport/runtime wiring
* **No dependencies:** follow ADR-009. Use native browser/platform APIs.
* **Bundle limit:** 250KB minified. Treat growth over ~20KB as a design review trigger.
* **Procedural assets only:** no external image or audio files.
* **Asset pipeline:** PNGs are authoring inputs only. Runtime assets should come from checked-in generated modules under `src/generated/assets`, with legacy procedural shapes used as fallback during migration.
* **Determinism:** no `Math.random()` in simulation, networking validation, or arbiter logic.

## Cohesion Rules

* **Canonical events:** `player:move` means room transition only. Tile motion uses `player:step`. Do not overload event semantics for convenience.
* **Single gameplay truth:** if a room, item, quest, or NPC is authored in content, every consumer must derive from that same content definition rather than duplicating assumptions in UI or commands.
* **Directional movement UI:** only cardinal directions plus `up` / `down` may be surfaced as direct movement actions unless the command parser is explicitly extended to support more.
* **Item referential integrity:** every item id mentioned in loot, shops, recipes, scarcity, quests, or interactions must exist in `ITEMS`.
* **Room integrity:** descriptions, exits, exit tiles, scenery footprint, enemy selection, and static NPC placement must agree. If one changes, verify the others in the same pass.
* **Buff integrity:** gameplay math should use `statusEffects` for active temporary effects. Legacy `buffs` fields exist only for compatibility paths that have not yet been removed.
* **Surfaced world-state must matter:** if `scarcity`, `surplus`, or `threat` are shown to the player, they must have a mechanical effect in the same build.

## Verification

* Run `npm run build` and `npm test` after changes.
* Do not mark a phase complete if authored content, UI affordances, and command/runtime behavior are out of sync.
* When changing bus payloads, room topology, or quest progression, add or update regression coverage in `src/tests`.
