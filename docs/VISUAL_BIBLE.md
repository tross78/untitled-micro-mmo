# Visual Bible

## Visual Direction

Fenhollow should sit between:

* SNES Zelda readability and silhouette clarity
* Stardew Valley warmth, texture, and environmental liveliness

The goal is not imitation. The goal is a browser-friendly visual language that reads clearly on mobile and still feels authored and inviting.

## Core Principles

* readability before detail
* silhouette before ornament
* warm, cohesive palettes over noisy variety
* memorable rooms over generic valid rooms
* intentional clutter, not random clutter

## Player Design

The player sprite needs to work for many players, not just one hero asset.

Rules:

* use one clear shared base body language and silhouette
* support multiplayer variation through tint, hair/head details, clothing accents, or small accessories
* preserve instant readability even when several players are on screen
* small-screen legibility matters more than high-detail decoration

The target style should land between Zelda-like clarity and Stardew-like softness.

## Tile Taxonomy

The tile set is codified in `src/graphics/graphics.js` via `TILE_TAXONOMY`. Every authored tile must belong to one of these canonical families to ensure consistent visual grammar.

Canonical families (see `TILE_TAXONOMY`):

* **Natural:** `grass`, `dirt`, `sand`, `forest`
* **Structure:** `stone_floor`, `cobble`, `wall`, `interior`, `dungeon`, `cave`
* **Liquid:** `water`
* **Special:** `exit`, `ice`

The issue is not just tile count. It is a consistent visual grammar enforced by `validateContent`.

## Sprite Scale

Object scale is codified via `SCENERY_SIZE_CLASSES` in `src/graphics/graphics.js`.

Scale Classes:

* **Small (1x1):** items, props, small flora (e.g., `torch`, `mushroom`, `crate`)
* **Medium (2x2):** furniture, structural props (e.g., `table`, `pillar`, `bed`)
* **Large (3x3+):** landmark objects and major structures (e.g., `tree`, `bookshelf`)

If an object feels toy-sized next to the player, or deviates from its size class in `SCENERY_SIZE_CLASSES`, it is a bug.

## Room Composition

Each important room should have:

* a clear focal point
* readable paths and collision language
* edge treatment that frames the space
* enough clutter to feel alive
* at least one memorable landmark or composition hook

Key rooms should screenshot well even when viewed briefly on a phone.

## Visual Density

Rooms should not feel bare, but density has to be controlled.

Use scenery to:

* imply function
* support mood
* create landmarks
* break up empty surfaces

Do not use scenery to:

* block traversal accidentally
* obscure exits or interactables
* create unreadable noise

## References

Use the local `references/` folder as inspiration for:

* room composition
* palette warmth
* forest/water/interior treatment
* readable 2D adventure-space layout

The references consistently reinforce a few compositional rules:

* keep a clear focal point in the middle or near the primary approach
* push clutter, props, and detail to the edges
* make paths, shorelines, and thresholds read as deliberate geometry
* let indoor rooms feel functional first, decorative second
* let outdoor rooms feel like navigable spaces, not pattern-filled carpets

Do not copy source material directly. Use it to keep the visual language coherent.

### Reference Index

| File | Design intent |
| :---- | :---- |
| `bandit_camp.jpeg` | Campfire-centered clearing, radial prop scatter, forest edge framing |
| `catacombs.gif` | Long aisle readability, side wall torches, landmark placement, loot spacing |
| `catacombs.jpg` | Burial-hall composition, clear center lane, stronger wall enclosure |
| `caves.webp` | Rough cave pathing, organic rock borders, visible traversal channel |
| `cellar.jpg` | Dense storage room, stacked goods at edges, cluttered-but-readable interior |
| `cellar.png` | Same cellar read with a clearer center and damp stone floor palette |
| `cemetery.jpg` | Grave row spacing, solemn open field, misty edge framing |
| `crossroads.jpeg` | Road junction legibility, worn dirt lanes, signpost-like center clarity |
| `dungeon_cell.png` | Sparse punitive cell, bare stone floor, single-purpose confinement |
| `forest.jpeg` | Broad forest floor, scattered rocks, canopy mass without losing the path |
| `forest_depths.png` | Dense canopy, cross-trail readability, undergrowth texture, deep-forest enclosure |
| `forest_edge.png` | Treeline threshold, contested border, path losing to forest pressure |
| `forest_zelda.jpeg` | Top-down forest rhythm, readable clearings, classic adventure pathing |
| `forest_zelda2.png` | Smaller forest vignette, tighter treeline shapes, simpler path contrast |
| `frozen_lake.png` | Ice field irregularity, shore lobes, exposed water pockets, winter layering |
| `hallway.jpg` | Narrow service passage, torch-wall placement, corridor width discipline |
| `harbour.png` | Working dock layout, plank geometry, water inlet shape, edge clutter only |
| `herbalist.jpg` | Work-triangle interior, hanging bundles, cauldron/desk focal points |
| `herbalist_hut.jpg` | Same herbalist read with a cozier, more domestic composition |
| `lake_shore.jpeg` | Curved cove, sand and rock framing, soft natural water edge |
| `lake_zelda.webp` | Compact shoreline read, dock-adjacent water edge, classic Zelda simplicity |
| `library.jpg` | Symmetric knowledge room, book-wall massing, central reading lane |
| `market.webp` | Civic square density, stall rows, central lane/well-like anchor |
| `mill.png` | Long work aisle, machinery at the side, grain-stack wall treatment |
| `mountain_pass.png` | Narrow ridge, exposed switchbacks, danger framed by rock walls |
| `ruins.png` | Ruined nave geometry, broken aisles, ceremonial remnant and overgrowth |
| `ruins.jpg` | Same ruin logic with more open lawn and stronger wall fragments |
| `ruins_descent.webp` | Stair throat, collapsing wall treatment, downward funnel composition |
| `sea_cave.gif` | Tidal basin, shell-ledge framing, wet cave palette, shoreline cave read |
| `sea_jetty.jpg` | Pier-and-water composition, dock extension, working waterfront framing |
| `smuggler_den.jpeg` | Tight stash alcove, pinched silhouette, wall-crate density |
| `tavern.jpg` | Warm hearth room, central social lane, tables around the perimeter |
| `throne_room.webp` | Raised dais, procession lane, authority-in-ruin geometry |
| `town_zelda.webp` | Civic town grid, clear street crossings, readable public square structure |
| `watchtower.webp` | Vertical shaft, lonely lookout silhouette, ladder/stairs as the route |
