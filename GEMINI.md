# Hearthwick — Gemini Working Guide

Read `AGENTS.md` first. This file does not repeat it — it tells you *how to behave* when implementing phases in this repo.

---

## Before Starting Any Phase

1. **Read the phase spec file.** AGENTS.md contains summaries only. The full spec — root causes, exact file locations, code snippets, cohesion table — lives in `docs/phases/`. Before touching code, read the relevant file:
   - Active phase (8.76): `docs/phases/8.76-polish-sprint.md`
   - Next phase (8.77): `docs/phases/8.77-world-vitality.md`
   - Completed phases: `docs/phases/COMPLETE.md`

2. **Search before editing.** Run `grep` for the function, component, or constant you plan to change. Do not assume it lives where an older doc says it does.

3. **Confirm the acceptance bar.** Each phase spec ends with an explicit acceptance bar. A phase is not done until every item on it passes — not just `npm test`.

---

## Numbered Implementation Rules

These are hard constraints, not suggestions. Follow them on every patch.

1. **No `Math.random()` in simulation, arbiter, or network validation.** Use `seededRNG(hashStr(seed + day + salt))` from `src/rules/utils.js`.

2. **`player:move` is room transition only.** Same-room tile movement uses `player:step`. Never emit `player:move` for intra-room motion.

3. **Every item id must exist in `ITEMS`.** Before referencing an item id in loot, shop, recipe, quest, or scarcity, verify it exists in `src/content/data/items.js`.

4. **Content, UI, and runtime must ship together.** A feature is incomplete if only one or two of those three agree. Do not mark a slice done if they are out of sync.

5. **When changing event semantics, update all emitters and all listeners in the same patch.** Check `src/state/eventbus.js` for the canonical payload, then grep for every producer and consumer.

6. **When adding a room, verify exits, exit tiles, prose, NPC placement, and enemy placement together.** These must all agree before merge.

7. **No new npm dependencies.** Use native browser/platform APIs. If a dependency seems necessary, flag it and wait for explicit approval.

8. **Bundle limit is 500KB minified** (current build: ~297KB). Treat a growth of more than ~50KB as a design review trigger.

9. **Run `npm run verify` after meaningful changes.** `npm run build` + `npm test` alone are not enough when content or event payloads changed.

10. **Gameplay math uses `statusEffects` for temporary effects.** The legacy `buffs` field is a compatibility-only path. Do not write new code against it.

---

## Common Mistakes — Do Not Repeat These

| Mistake | What to do instead |
|---|---|
| Emitting `player:move` inside a room | Use `player:step` for tile motion; `player:move` is room-transition only |
| Duplicating content assumptions in UI or command code | Derive from the single content definition in `src/content/data/` |
| Treating `prerequisite` as a string | It can be an array; normalize to array before checking |
| Using `buffs.activeElixir` or other legacy buff paths | Write to `statusEffects` with an explicit duration |
| Inferring phase spec from AGENTS.md summaries | Read `docs/phases/<phase>.md` before starting |
| Surfacing `scarcity`/`surplus`/`threat` without mechanical effect | If it's shown, it must have a real effect in the same build |
| Skipping regression coverage when changing content | If content, room topology, events, or quest progression changed, add or update tests in `src/tests/` |
| Authoring a room with an NPC implied but not placed | Every shop or indoor room that implies a resident NPC must place that NPC explicitly in `staticEntities` |

---

## Workflow

- Prefer small coherent patches over broad speculative rewrites.
- Summarize changes by player impact first, file impact second.
- Do not expand scope unless explicitly asked.
- If content, UI, and runtime disagree, treat that as a bug — not a design question.
- Do not preserve obsolete systems for nostalgia. If something is unused and not in the roadmap, it can go.

---

## Verification Checklist

Before marking any slice done:

- [ ] `npm run verify` passes (or `npm run build` + `npm test` with explanation)
- [ ] Acceptance bar from phase spec file is satisfied
- [ ] No new `Math.random()` calls in simulation/arbiter/network code
- [ ] No item ids referenced that don't exist in `ITEMS`
- [ ] If event payload changed: all emitters and listeners updated
- [ ] If room changed: exits, exit tiles, prose, NPCs, enemies, and traversability agree
- [ ] If content/UI/progression changed: regression test added or updated

---

## File Index

| File | Purpose |
|---|---|
| `AGENTS.md` | Source of truth: architecture, guardrails, bus contracts, roadmap index |
| `CLAUDE.md` | Short implementation guardrails (OVERRIDE anything contradicted here) |
| `DECISIONS.md` | Historical ADRs — read before questioning a structural decision |
| `docs/phases/8.76-polish-sprint.md` | Full spec for the active phase |
| `docs/phases/8.77-world-vitality.md` | Full spec for the next phase |
| `docs/phases/COMPLETE.md` | Completed phase archive |
| `docs/PRODUCT.md` | Elevator pitch, audience, product weighting |
| `docs/ARCHITECTURE.md` | Runtime model, determinism, event contracts, bundle constraints |
| `docs/CONTENT_RULES.md` | Quest/room/NPC authoring contracts |
| `docs/VISUAL_BIBLE.md` | Palette, sprite scale, composition rules |
