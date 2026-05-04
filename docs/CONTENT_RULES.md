# Content Rules

## Principle

Content is not decorative metadata. Rooms, items, quests, recipes, NPCs, and player-facing affordances must all agree.

If content, UI, and runtime behavior disagree, that is a bug.

## Rooms

Every room must have:

* a unique `id`
* `width` and `height`
* an `exits` object for cardinal transitions (e.g. `{"north": "tavern"}`)
* an `exitTiles` string or array for specific spatial portals

### Entry and Safe Arrival

Entry points into a room are not authored separately. They are derived from the arrival coordinates of the incoming transition:
* **Cardinal Exits:** Players land at the center of the matching edge in the destination room.
* **Exit Tiles:** Players land at the explicit `destX` and `destY` coordinates.

**Safe Arrival Guarantee:**
If an arrival tile is blocked by scenery or walls, the engine uses a canonical `findSafeArrival` (BFS distance 3) to snap the player to the nearest walkable tile. This logic is shared between the runtime and the content validator.

### Traversability and Tests

When changing content:

* extend validators before relying on manual review
* add regression tests for new content linkages or command-surface assumptions
* do not accept "build passes" as proof that authored content is coherent

## NPCs and Enemies

* NPCs should have unique roles and home rooms.
* Enemies must have defined loot pools and difficulty levels.
* Placement must follow traversability rules (adjacent to reachable walkable tiles).

## Items and Economy

* Every item id referenced anywhere must exist in `ITEMS`.
* Quest rewards, shop prices, and recipe inputs must be balanced to prevent rapid hyperinflation or total scarcity.
