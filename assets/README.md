# Asset Pipeline

PNG files in `assets/source/` are authoring inputs only.

The runtime does not load PNGs directly. Instead:

1. Author PNGs under `assets/source/`
2. Describe them in `assets/spec/manifest.json`
3. Run `npm run assets:compile`
4. Commit the generated output in `src/generated/assets/`

Current constraints:

* `strict` import mode: only the exact 4-role source palette is accepted
* `quantized` import mode: arbitrary opaque pixel colors are reduced to the nearest of the 4 palette roles
* transparent background required
* directional/static base frames only
* no runtime PNG dependency

## Import Modes

Set `compilerOptions.colorMode` in `assets/spec/manifest.json`:

* `strict` keeps the current behavior and fails if a non-palette color is found
* `quantized` lets you import SNES-like or Stardew-like source art and reduces each opaque pixel to the nearest role color before mask compilation

Example:

```json
{
  "compilerOptions": {
    "colorMode": "quantized",
    "palette": {
      "outline": "#000000",
      "secondary": "#888888",
      "primary": "#cccccc",
      "accent": "#ffffff"
    }
  }
}
```

This still compiles into the existing procedural mask format. It does not preserve the original full-color palette at runtime.

## Palette Normalization Script

If you want to keep `strict` mode but your source PNG has near-matching colors like `rgb(13,13,13)` instead of exact `#000000`, normalize the PNG first:

```bash
node scripts/normalize-asset-palette.js assets/source/players/player.png
```

That rewrites the PNG in place so every opaque pixel becomes the nearest of:

* `#000000`
* `#888888`
* `#cccccc`
* `#ffffff`

You can also write to a separate output file:

```bash
node scripts/normalize-asset-palette.js input.png output.png
```

## Source Filenames

The compiler uses the exact `source` path declared in `assets/spec/manifest.json`. There is no hidden filename inference.

### Player Direction Filenames

The player currently uses 3 authored directional PNGs:

* `assets/source/players/player.png` for facing down / front
* `assets/source/players/player_back.png` for facing up / back
* `assets/source/players/player_side.png` for both side facings

Left and right do not use separate files. The renderer uses `player_side.png` for east and flips that same sprite horizontally for west at draw time.

For current migrated assets, the expected source filenames are:

* `assets/source/players/player.png`
* `assets/source/players/player_back.png`
* `assets/source/players/player_side.png`
* `assets/source/npcs/guard.png`
* `assets/source/npcs/barkeep.png`
* `assets/source/enemies/forest_wolf.png`
* `assets/source/enemies/goblin.png`
* `assets/source/enemies/bandit.png`
* `assets/source/enemies/cave_troll.png`
* `assets/source/enemies/mountain_troll.png`
* `assets/source/enemies/ruin_shade.png`
* `assets/source/enemies/wraith.png`
* `assets/source/enemies/skeleton.png`
* `assets/source/enemies/crab.png`
* `assets/source/scenery/tree.png`
* `assets/source/scenery/stall.png`
* `assets/source/scenery/bookshelf.png`
* `assets/source/scenery/fireplace.png`

For new assets, you can choose any filename you want as long as the manifest points to it exactly.
