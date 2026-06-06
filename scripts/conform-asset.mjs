#!/usr/bin/env node
// Conform a full-color (e.g. Retro Diffusion) PNG onto an asset's AUTHORED
// multi-slot palette (src/content/multi-palettes.js). Every opaque pixel is
// auto-mapped to the nearest authored color using a hue-weighted distance, so
// leaf pixels land on the green slots and trunk pixels on the brown slots.
// Output uses ONLY the authored colors and is the checked-in source PNG.
//
// Usage:
//   node scripts/conform-asset.mjs <assetId> <in.png> [out.png] [--scale N] [--alpha N]
//
//   assetId     must exist in MULTI_PALETTES (e.g. "tree")
//   out.png     default assets/source/scenery/<assetId>.png
//   --scale N   downscale by integer factor N (per-cell majority vote in slot
//               space — clean edges). Input dims must be divisible by N. Default 1.
//   --alpha N   alpha cutoff; pixels with alpha < N become transparent. Default 1.
import fs from 'node:fs/promises';
import { decodePng, encodePng } from './lib/asset-pipeline.js';
import { MULTI_PALETTES } from '../src/content/multi-palettes.js';

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Hue-weighted distance via opponent channels. Emphasizing the red-green and
// green-blue opponents over raw luminance makes hue (green vs brown) dominate
// the slot choice, while luminance still separates shades within one ramp.
const W_OPP = 1.0;
const W_LUM = 0.45;
const features = ([r, g, b]) => [r - g, g - b, (r + g + b) / 3];
const dist2 = (fa, fb) =>
  W_OPP * ((fa[0] - fb[0]) ** 2 + (fa[1] - fb[1]) ** 2) + W_LUM * (fa[2] - fb[2]) ** 2;

const parseArgs = (argv) => {
  const [assetId, inPath, ...rest] = argv;
  const opts = { out: null, scale: 1, alpha: 1 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--scale') opts.scale = Number(rest[++i]);
    else if (rest[i] === '--alpha') opts.alpha = Number(rest[++i]);
    else if (!opts.out && !rest[i].startsWith('--')) opts.out = rest[i];
  }
  return { assetId, inPath, opts };
};

// -> Int16Array of slot index (0-based), or -1 transparent.
const mapToSlots = ({ width, height, rgba }, paletteFeat, alpha) => {
  const labels = new Int16Array(width * height);
  for (let p = 0; p < labels.length; p++) {
    const i = p * 4;
    if (rgba[i + 3] < alpha) { labels[p] = -1; continue; }
    const f = features([rgba[i], rgba[i + 1], rgba[i + 2]]);
    let best = 0, bestD = Infinity;
    for (let s = 0; s < paletteFeat.length; s++) {
      const d = dist2(f, paletteFeat[s]);
      if (d < bestD) { bestD = d; best = s; }
    }
    labels[p] = best;
  }
  return labels;
};

const downscaleLabels = (labels, width, height, scale) => {
  if (scale === 1) return { labels, width, height };
  if (width % scale || height % scale) {
    throw new Error(`--scale ${scale} requires ${width}x${height} divisible by ${scale}`);
  }
  const ow = width / scale, oh = height / scale;
  const out = new Int16Array(ow * oh);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const counts = new Map();
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const v = labels[(oy * scale + dy) * width + (ox * scale + dx)];
          counts.set(v, (counts.get(v) || 0) + 1);
        }
      }
      let best = -1, bestC = -1;
      for (const [v, c] of counts) if (c > bestC) { best = v; bestC = c; }
      out[oy * ow + ox] = best;
    }
  }
  return { labels: out, width: ow, height: oh };
};

const labelsToPng = (labels, width, height, paletteRgb) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < labels.length; p++) {
    const i = p * 4;
    if (labels[p] < 0) { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; continue; }
    const [r, g, b] = paletteRgb[labels[p]];
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return { width, height, rgba };
};

const main = async () => {
  const { assetId, inPath, opts } = parseArgs(process.argv.slice(2));
  if (!assetId || !inPath) {
    console.error('Usage: node scripts/conform-asset.mjs <assetId> <in.png> [out.png] [--scale N] [--alpha N]');
    process.exitCode = 1;
    return;
  }
  const paletteHex = MULTI_PALETTES[assetId];
  if (!paletteHex) {
    console.error(`No authored palette for "${assetId}". Add it to src/content/multi-palettes.js first.`);
    console.error(`Known: ${Object.keys(MULTI_PALETTES).join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }
  const out = opts.out || `assets/source/scenery/${assetId}.png`;
  const paletteRgb = paletteHex.map(hexToRgb);
  const paletteFeat = paletteRgb.map(features);

  const src = decodePng(await fs.readFile(inPath));
  const labels = mapToSlots(src, paletteFeat, opts.alpha);
  const reduced = downscaleLabels(labels, src.width, src.height, opts.scale);
  const png = labelsToPng(reduced.labels, reduced.width, reduced.height, paletteRgb);
  await fs.writeFile(out, encodePng(png));

  const hist = new Array(paletteHex.length).fill(0);
  let transparent = 0;
  for (const v of reduced.labels) (v < 0 ? transparent++ : hist[v]++);
  console.log(`Conformed ${assetId}: ${reduced.width}x${reduced.height} -> ${out}`);
  console.log(`  slots: ${paletteHex.map((h, i) => `${i + 1}:${h}=${hist[i]}`).join('  ')}  transparent=${transparent}`);
};

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
