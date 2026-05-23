# Asset Specs

This file is the quick reference for PNG authoring sizes in the current asset pipeline.

Use it together with:

* [assets/spec/manifest.json](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/assets/spec/manifest.json:1) for the exact compiler source of truth
* [src/infra/graphics-constants.js](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/src/infra/graphics-constants.js:1) for scenery footprint/render rules
* [docs/VISUAL_BIBLE.md](/Users/tysonross/Documents/GitHub/untitled-micro-mmo/docs/VISUAL_BIBLE.md:1) for style and scale guidance

## How To Read This

Each asset has:

* **Source PNG size**: the pixel size the compiler expects for the authored PNG frame
* **Logical footprint**: how many room tiles the object occupies for placement/collision
* **Render treatment**: extra height or offset when the object should look taller than its blocking footprint

The pipeline supports both:

* **single-frame PNGs**
* **horizontal frame strips** for assets whose manifest entry declares `frameCount`

The manifest is the source of truth for source sizes, frame counts, and palette roles.

## Players

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `player` | `16x16` | `1x1` | Front/base player sprite |
| `player_back` | `16x16` | `1x1` | Back-facing player sprite |
| `player_side` | `16x16` | `1x1` | Side-facing player sprite, used for both left and right |

Player facing mapping in runtime:

* facing down: `player.png`
* facing up: `player_back.png`
* facing right: `player_side.png`
* facing left: `player_side.png`, mirrored at render time

You do not need a separate `player_left.png`.

## NPCs

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `guard` | `16x16` | `1x1` | Base NPC sprite; NPCs distinguish via palette variants |

## Enemies

| Asset ID | Source PNG Size | Logical Footprint | Notes |
| :-- | :-- | :-- | :-- |
| `wolf` | `8x13` per frame | `1x1` | 2-frame strip in manifest |
| `forest_wolf` | `8x13` per frame | `1x1` | 2-frame strip in manifest |
| `goblin` | `8x13` | `1x1` | Humanoid enemy |
| `bandit` | `8x13` | `1x1` | Humanoid enemy |
| `cave_troll` | `8x14` | `1x1` | Taller heavy enemy |
| `mountain_troll` | `8x14` | `1x1` | Taller heavy enemy |
| `ruin_shade` | `8x13` | `1x1` | Spectral enemy |
| `wraith` | `8x13` per frame | `1x1` | 2-frame strip in manifest |
| `skeleton` | `8x13` | `1x1` | Bony humanoid |
| `crab` | `8x12` | `1x1` | Low, wide enemy read |
| `throne_guardian` | `8x14` | `1x1` | Boss enemy |

## Scenery

| Asset ID | Source PNG Size | Logical Footprint | Render Treatment | Notes |
| :-- | :-- | :-- | :-- | :-- |
| `tree` | `48x48` | `3x3` | `heightTiles: 3`, `yOffsetTiles: 0` | Large landmark tree |
| `stall` | `48x48` | `2x2` | none | Market/stall prop |
| `bookshelf` | `48x48` | `2x1` | `heightTiles: 2`, `yOffsetTiles: 1` | Wide, visually tall |
| `fireplace` | `48x48` | `2x1` | `heightTiles: 2`, `yOffsetTiles: 1` | Wide, visually tall |
| `well` | `48x48` | `1x1` | none | Town landmark prop |

## Current Authoring Rule

For migrated assets, author PNGs at the exact frame size listed above.

Current default rule:

* compiled players/NPCs currently use `16x16` source frames
* compiled enemy frames are generally `8px` wide and `12px` to `14px` tall
* compiled large scenery currently uses `48x48` source frames, with in-room footprint controlled separately by metadata

That means a `tree` is authored as a `48x48` compiled scenery frame while still using a logical `3x3` footprint plus render treatment metadata.

## Strict Import Rules

The compiler accepts the strict five-role palette:

* outline: `#000000`
* secondary: `#888888`
* primary: `#cccccc`
* accent: `#ffffff`
* shadow: `#444444`

Anything outside those exact opaque role colors will fail compilation in strict mode.

## Quantized Import Option

If you want to start from existing pixel art instead of hand-authoring in the strict five-role palette, set:

```json
{
  "compilerOptions": {
    "colorMode": "quantized"
  }
}
```

In `quantized` mode, each non-transparent pixel is reduced to the nearest role color before compilation into mask rows.

This is useful for adapting SNES-like source sprites into the current runtime format, but it is still a reduction step:

* it does not preserve the original palette
* it does not preserve subtle shading beyond the role buckets
* it still outputs procedural mask data, not raw PNG pixels

## Source Folders

Put source PNGs here:

* `assets/source/players/`
* `assets/source/npcs/`
* `assets/source/enemies/`
* `assets/source/scenery/`

Current migrated filenames are:

* Players: `player.png`, `player_back.png`, `player_side.png`
* NPCs: `guard.png`, `barkeep.png`, `merchant.png`, `herbalist.png`, `sage.png`, `bard.png`
* Enemies: `wolf.png`, `forest_wolf.png`, `goblin.png`, `bandit.png`, `cave_troll.png`, `mountain_troll.png`, `ruin_shade.png`, `wraith.png`, `skeleton.png`, `crab.png`, `throne_guardian.png`
* Scenery: `tree.png`, `stall.png`, `bookshelf.png`, `fireplace.png`, `well.png`

For new assets, filenames are manifest-driven rather than convention-driven. The exact file only has to match the manifest `source` entry.

When this document and the manifest disagree, trust:
1. `assets/spec/manifest.json`
2. generated output after `npm run assets:compile`
3. this document

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
