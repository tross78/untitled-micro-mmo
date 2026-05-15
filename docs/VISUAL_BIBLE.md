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

Do not copy source material directly. Use it to keep the visual language coherent.
