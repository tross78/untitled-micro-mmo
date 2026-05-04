# Asset Specs

This file is the quick reference for PNG authoring sizes in the `8.525` asset pipeline.

Use it together with:

* [assets/spec/manifest.json](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/assets/spec/manifest.json:1) for the exact compiler source of truth
* [src/infra/graphics-constants.js](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/src/infra/graphics-constants.js:1) for scenery footprint/render rules
* [docs/VISUAL_BIBLE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/VISUAL_BIBLE.md:1) for style and scale guidance

## How To Read This

Each asset has:

* **Source PNG size**: the pixel size the compiler expects for the authored PNG frame
* **Logical footprint**: how many room tiles the object occupies for placement/collision
* **Render treatment**: extra height or offset when the object should look taller than its blocking footprint

The current pipeline uses **single-frame PNGs** for each asset.

## Players

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `player` | `8x14` | `1x1` | Front/base player sprite |
| `player_back` | `8x14` | `1x1` | Back-facing player sprite |
| `player_side` | `8x14` | `1x1` | Side-facing player sprite |

## NPCs

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `guard` | `8x13` | `1x1` | Current migrated NPC sprite |

## Enemies

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `forest_wolf` | `8x13` | `1x1` | Wolf silhouette |
| `goblin` | `8x13` | `1x1` | Humanoid enemy |
| `bandit` | `8x13` | `1x1` | Humanoid enemy |
| `cave_troll` | `8x14` | `1x1` | Taller heavy enemy |
| `mountain_troll` | `8x14` | `1x1` | Taller heavy enemy |
| `ruin_shade` | `8x13` | `1x1` | Spectral enemy |
| `wraith` | `8x13` | `1x1` | Spectral enemy |
| `skeleton` | `8x13` | `1x1` | Bony humanoid |
| `crab` | `8x12` | `1x1` | Low, wide enemy read |

## Scenery

| Asset ID | Source PNG Size | Logical Footprint | Render Treatment | Notes |
| :-- | :-- | :-- | :-- | :-- |
| `tree` | `8x12` | `3x3` | `heightTiles: 3` | Large landmark tree |
| `stall` | `8x12` | `2x2` | none | Market/stall prop |
| `bookshelf` | `8x12` | `2x1` | `heightTiles: 2`, `yOffsetTiles: 1` | Wide, visually tall |
| `fireplace` | `8x12` | `2x1` | `heightTiles: 2`, `yOffsetTiles: 1` | Wide, visually tall |

## Current Authoring Rule

For migrated assets, author PNGs at the exact frame size listed above.

Current default rule:

* characters and enemies are generally `8px` wide and `12px` to `14px` tall
* scenery is currently authored as an `8x12` visual frame, with the in-room footprint controlled separately by metadata

That means a `tree` is **not** authored as a `24x24` PNG right now. It is authored as an `8x12` sprite with a logical `3x3` footprint and taller render treatment.

## Strict Import Rules

The compiler currently accepts only the strict 4-role source palette:

* outline: `#000000`
* secondary: `#888888`
* primary: `#cccccc`
* accent: `#ffffff`

Anything else will fail compilation.

## Source Folders

Put source PNGs here:

* `assets/source/players/`
* `assets/source/npcs/`
* `assets/source/enemies/`
* `assets/source/scenery/`

Then update:

* [assets/spec/manifest.json](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/assets/spec/manifest.json:1)

Then run:

```bash
npm run assets:compile
```

## If You Add New Assets

For a new asset, define:

1. asset id
2. family (`player`, `npc`, `enemy`, `scenery`)
3. source PNG path
4. frame size in the manifest
5. logical footprint
6. optional render height/y offset for tall scenery

If the asset is scenery, also check whether it needs a canonical entry in:

* [src/infra/graphics-constants.js](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/src/infra/graphics-constants.js:1)

