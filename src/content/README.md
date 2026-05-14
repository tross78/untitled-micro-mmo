# Content Data Index

All authored game content lives under `src/content/data/`. Read this file to know which file to open before editing.

## Data Files

| File | What it contains | Key export |
|---|---|---|
| `constants.js` | Game-wide constants: season names, season length, mood Markov transition tables, scarcity item pool, initial mood, game name | `SEASONS`, `SEASON_LENGTH`, `moodMarkov`, `SCARCITY_ITEMS`, `MOOD_INITIAL`, `GAME_NAME` |
| `items.js` | Every item definition: id, name, type, stats, value, description | `ITEMS` (object keyed by id), `itemDefinitions` (array) |
| `enemies.js` | Enemy types: id, name, hp, atk, def, xp, loot table, zone | `ENEMIES` (object keyed by id), `enemyDefinitions` (array) |
| `npcs.js` | NPC definitions: id, name, role, location, dialogue corpus (base + contextual pools) | `NPCS` (object keyed by id), `npcDefinitions` (array) |
| `quests.js` | Quest chains: id, name, description, giver, receiver, objectives, prerequisites, rewards | `QUESTS` (object keyed by id), `questDefinitions` (array) |
| `recipes.js` | Crafting recipes: id, ingredients (item ids + quantities), output item id | `RECIPES` (array), `recipeDefinitions` (array) |
| `rooms.js` | Room topology and content: exits, exit tiles, prose, zone, NPC placement, enemy placement, scenery, tile overrides | `ROOMS` (object keyed by id), `roomDefinitions` (array) |

## Referential Integrity Rules (ADR-016)

Every id referenced in any of the above files must resolve. The validation check is `src/content/validate.js`, run via `npm run validate:content`.

Specifically:
- Every item id in loot tables, recipes, shop stock, scarcity pool, and quest rewards must exist in `ITEMS`
- Every enemy id in room definitions must exist in `ENEMIES`
- Every NPC id in room `staticEntities` must exist in `NPCS`
- Every quest `prerequisite` and `giver`/`receiver` id must resolve
- Every room exit id must resolve to another room in `ROOMS`

## Adding New Content

When adding a new item, enemy, NPC, room, or quest:
1. Add it to the relevant data file
2. If it references other ids, verify those ids exist first
3. Run `npm run validate:content` to confirm no broken references
4. Add or update regression tests in `src/tests/content.test.js`

Do not split a new entity across multiple PRs — add the entity and all references to it in the same patch (ADR-016).
