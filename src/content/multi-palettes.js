// Authored multi-slot palettes for full-color ("RD-sourced") assets.
//
// OPT-IN per asset id — works for ANY asset (sprite, tile, enemy, scenery).
// Add an asset's id here to make it a fixed full-color sprite instead of a
// 5-role recolor sprite.
//
// Trade-off: the 5-role system (graphics.js _SP / PALETTES) exists so an asset
// can be RECOLORED at runtime (peer0..5 variants, per-type enemy/NPC palettes).
// A multi-palette asset bakes its colors and is NOT recolored. So use this for
// anything with a single authored look; keep 5-role for anything that needs
// per-variant tinting (e.g. the player/peer template).
//
// Rules:
// - Colors are AUTHORED here. The conform tool only auto-MAPS Retro Diffusion
//   output onto these slots (nearest hue-weighted color); it never invents them.
// - Order matters: index N (0-based) corresponds to mask character (N+1).
//   Slot 0 is conventionally the outline. Max 9 slots (single-char indices).
// - Edit freely to art-direct. Re-run `npm run assets:compile` after changes
//   (re-conform the source PNG if you change which hues exist).
//
// Shared by scripts/conform-asset.mjs (build) and src/graphics (runtime).

export const MULTI_PALETTES = {
  // --- Tiles (drop a PNG named <id>.png into assets/source/tiles/) ---
  // id must match the map's tile-type string. A horizontal strip is auto-split
  // into variant frames. Tile art should be authored at 16x16 per frame.
  // Ramps run dark -> light. Anchored to TILE_PAL in graphics.js, nudged warmer
  // for the Zelda x Stardew blend. See "Tile Art Direction" in docs/VISUAL_BIBLE.md.
  //
  // Natural ----------------------------------------------------------------
  grass: [
    '#1c3a12', // 1 deep shadow / blade base
    '#2e5a1e', // 2 turf shadow
    '#3f7a26', // 3 turf mid
    '#58a032', // 4 blade highlight
    '#7cc24a', // 5 bright tip
  ],
  forest: [
    '#0f2a0e', // 1 deep canopy shadow
    '#1a3c14', // 2 litter shadow
    '#28501c', // 3 forest-floor mid
    '#346828', // 4 turf highlight
    '#4e8a30', // 5 leaf-tip accent
  ],
  dirt: [
    '#3e2a12', // 1 packed shadow
    '#583e18', // 2 earth low
    '#80582a', // 3 path mid
    '#a07838', // 4 dry highlight
    '#c49a52', // 5 dust accent
  ],
  sand: [
    '#a8843e', // 1 damp shadow
    '#c8a050', // 2 sand low
    '#d8bc70', // 3 sand mid
    '#ead898', // 4 sunlit highlight
    '#f8eebc', // 5 bright grain
  ],
  // Structure --------------------------------------------------------------
  stone_floor: [
    '#403a30', // 1 seam shadow
    '#585044', // 2 stone low
    '#787060', // 3 flagstone mid
    '#9a9080', // 4 highlight
    '#b8aea0', // 5 worn accent
  ],
  cobble: [
    '#2c2820', // 1 gap shadow
    '#40382c', // 2 cobble low
    '#585048', // 3 cobble mid
    '#787060', // 4 highlight
    '#9a9088', // 5 polished accent
  ],
  wall: [
    '#2a2622', // 1 base shadow
    '#3a342e', // 2 course low
    '#58504a', // 3 block mid
    '#787060', // 4 top-edge highlight
    '#a09488', // 5 lit accent
  ],
  interior: [
    '#4a2c12', // 1 plank shadow
    '#603818', // 2 wood low
    '#9a6030', // 3 plank mid
    '#c8844a', // 4 grain highlight
    '#e0a868', // 5 warm accent
  ],
  dungeon: [
    '#22264a', // 1 cold shadow
    '#2e3460', // 2 flagstone low
    '#404878', // 3 stone mid
    '#6070a8', // 4 rim highlight
    '#98b0d8', // 5 blue accent
  ],
  cave: [
    '#241408', // 1 deep shadow
    '#361e10', // 2 rock low
    '#5a4030', // 3 ground mid
    '#7a5840', // 4 highlight
    '#9a7050', // 5 damp glint
  ],
  // Liquid -----------------------------------------------------------------
  water: [
    '#0c2c68', // 1 deep
    '#1848a8', // 2 body low
    '#2870c8', // 3 surface mid
    '#60c0e8', // 4 wave highlight
    '#bfe8ff', // 5 sparkle
  ],
  // Special ----------------------------------------------------------------
  ice: [
    '#88b8d8', // 1 shaded ice
    '#a8d0e8', // 2 ice low
    '#c0ddf0', // 3 sheen mid
    '#e8f6ff', // 4 highlight
    '#ffffff', // 5 crack glint
  ],
  exit: [
    '#041404', // 1 threshold shadow
    '#082808', // 2 low glow
    '#20b840', // 3 mid glow
    '#40f070', // 4 bright glow
    '#a8ffc8', // 5 sparkle (this tile may pop — it is UX)
  ],

  // --- Scenery ---
  tree: [
    '#101c0a', // 1 outline       — near-black green
    '#6cc23f', // 2 leaf highlight
    '#49972b', // 3 leaf mid
    '#2e6018', // 4 leaf shadow
    '#7a5630', // 5 trunk highlight
    '#4a3420', // 6 trunk mid
    '#241608', // 7 trunk shadow
  ],

  // --- NPCs (RD-sourced fixed looks; conform with scripts/conform-asset.mjs) ---
  // Old Fisher: charcoal rain hat and oilskin coat, white beard, weathered skin.
  fisherman: [
    '#262422', // 1 outline
    '#393837', // 2 coat shadow
    '#4a4948', // 3 coat mid
    '#5e5d5c', // 4 coat light
    '#6c6b6a', // 5 hat highlight
    '#d1916a', // 6 skin shadow
    '#dc9e78', // 7 skin
    '#c8c7c5', // 8 beard shadow
    '#ebeae9', // 9 beard white
  ],
  // Merchant: near-silhouette hooded figure, monochrome dark robe ramp.
  merchant: [
    '#1a1a1a', // 1 outline
    '#232323', // 2 robe deep
    '#2c2c2c', // 3 robe shadow
    '#363636', // 4 robe mid
    '#404040', // 5 robe light
    '#4d4d4d', // 6 highlight
    '#575757', // 7 rim light
  ],
  // Guard: steel helm, leather armor, warm visor-lit face.
  guard: [
    '#1f1a14', // 1 outline
    '#302820', // 2 leather deep shadow
    '#412f1c', // 3 leather dark
    '#5d4329', // 4 leather mid
    '#72543a', // 5 leather light
    '#6b6b6b', // 6 steel shadow
    '#7f7e7e', // 7 steel mid
    '#8a8988', // 8 steel light
    '#c87654', // 9 face / visor glow
  ],
  // Herbalist: brown hooded cloak, pale face, tan satchel pouches.
  herbalist: [
    '#2b211c', // 1 outline
    '#4d382f', // 2 cloak dark
    '#594238', // 3 cloak mid
    '#6e5b55', // 4 cloak light
    '#95603e', // 5 satchel dark
    '#c0835a', // 6 satchel light
    '#f3b58e', // 7 skin
  ],
  // Bard: gray cap and cape over an orange tunic.
  bard: [
    '#211f1d', // 1 outline
    '#35312e', // 2 vest dark
    '#454341', // 3 vest mid
    '#5e5b5b', // 4 cap shadow
    '#6c6a6b', // 5 cap mid
    '#767675', // 6 cap light
    '#c17046', // 7 tunic dark
    '#d17f5b', // 8 tunic light
  ],
};

export const isMultiPaletteAsset = (id) =>
  Object.prototype.hasOwnProperty.call(MULTI_PALETTES, id);
