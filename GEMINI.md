# Gemini Working Guide

This file exists to make Gemini behave consistently with the rest of the repo's agent workflow.

Read these files first, in this order:

1. `AGENTS.md` for current product direction, roadmap, and working constraints
2. `CLAUDE.md` for short implementation guardrails
3. `DECISIONS.md` for architectural ADRs and non-negotiable historical decisions
4. `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/CONTENT_RULES.md`, and `docs/VISUAL_BIBLE.md` for model-neutral project rules

## Primary Expectations

* Prefer current files over inferred architecture.
* Do not expand scope unless explicitly asked.
* If content, UI, and runtime disagree, treat that as a bug.
* Do not preserve obsolete systems for nostalgia or optionality.
* Summarize changes by player impact first, file impact second.
* Keep implementation aligned with the current public game surface, not old phase notes.

## Workflow

* Search before editing. Do not assume a subsystem still lives where an older doc says it did.
* Prefer small coherent patches over broad speculative rewrites.
* When changing gameplay behavior, update validation/tests in the same pass.
* When changing event semantics, update every producer and consumer in the same pass.
* When changing content, verify rooms, exits, item ids, quests, recipes, NPC placement, and player-facing affordances together.

## Product Truth

The current first-class player-facing loop is:

* movement
* combat
* inventory / equip / use
* crafting
* quests
* shops / bank
* map / stats / status

These are not part of the current main loop:

* `say`
* emotes
* `vision`
* first-class `trade`
* first-class `duel`

Those may still exist internally, but Gemini should not re-surface them in default UI, help, onboarding, or new feature work unless explicitly told to.

## Architecture Constraints

* No new npm dependencies without explicit instruction.
* No `Math.random()` in deterministic gameplay, networking validation, or arbiter logic.
* Keep the browser build under roughly 250KB minified unless there is a clear reason.
* Procedural assets only; do not introduce external sprite sheets or audio files casually.
* `player:move` means room transition only. Same-room movement uses `player:step`.

## Content and UI Constraints

* Direct movement UI should only surface supported directions unless the parser is extended too.
* Every item id referenced anywhere must exist in `ITEMS`.
* Room prose, exits, exit tiles, scenery, NPC presence, and gameplay affordances must agree.
* If `scarcity`, `surplus`, or `threat` are surfaced to players, they must have real gameplay impact.
* Sprite and scenery scale must stay believable and consistent; see `docs/VISUAL_BIBLE.md`.

## Verification

After meaningful code changes:

1. Run `npm run build`
2. Run `npm test`
3. If touching content, UI surface, events, or progression, add or update regression coverage

Do not mark work complete if tests are green but content/UI/runtime are visibly out of sync.
