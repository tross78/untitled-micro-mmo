#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePng, encodePng, frameToMaskRows } from './lib/asset-pipeline.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PALETTE = {
  outline: '#000000',
  secondary: '#888888',
  primary: '#cccccc',
  accent: '#ffffff',
  shadow: '#444444',
};

const TARGETS = [
  { path: 'assets/source/players/player.png', frameWidth: 16, mode: 'walk' },
  { path: 'assets/source/players/player_back.png', frameWidth: 16, mode: 'walk' },
  { path: 'assets/source/players/player_side.png', frameWidth: 16, mode: 'walk' },
  { path: 'assets/source/npcs/guard.png', frameWidth: 16, mode: 'walk' },
  { path: 'assets/source/npcs/barkeep.png', frameWidth: 16, mode: 'idle' },
  { path: 'assets/source/npcs/merchant.png', frameWidth: 16, mode: 'idle' },
  { path: 'assets/source/npcs/herbalist.png', frameWidth: 16, mode: 'idle' },
  { path: 'assets/source/npcs/sage.png', frameWidth: 16, mode: 'idle' },
  { path: 'assets/source/npcs/bard.png', frameWidth: 16, mode: 'idle' },
];

const RGBA = {
  '0': [0, 0, 0, 0],
  '1': [0, 0, 0, 255],
  '2': [136, 136, 136, 255],
  '3': [204, 204, 204, 255],
  '4': [255, 255, 255, 255],
  '5': [68, 68, 68, 255],
};

const cloneRows = (rows) => rows.map((row) => row.split(''));
const stringifyRows = (rows) => rows.map((row) => row.join(''));

const makeBlank = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => '0'));

const put = (rows, x, y, value) => {
  if (y < 0 || x < 0 || y >= rows.length || x >= rows[0].length) return;
  if (value === '0') return;
  rows[y][x] = value;
};

const extractBaseRows = (rows, frameWidth) => rows.map((row) => row.slice(0, frameWidth));

const animateStep = (baseRows, phase) => {
  const src = cloneRows(baseRows);
  const h = src.length;
  const w = src[0].length;
  const center = Math.floor(w / 2);
  const dst = makeBlank(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = src[y][x];
      if (ch === '0') continue;

      let nx = x;
      let ny = y;

      // Keep head/torso stable. Only nudge lower body and hands.
      if (y >= h - 5) {
        const left = x < center;
        if (phase === 1) {
          if (left) nx = Math.max(0, x - 1);
          else ny = Math.max(0, y - 1);
        } else if (phase === 3) {
          if (!left) nx = Math.min(w - 1, x + 1);
          else ny = Math.max(0, y - 1);
        }
      } else if (y >= h - 8) {
        if (phase === 1) {
          if (x < center - 1) nx = Math.max(0, x - 1);
        } else if (phase === 3) {
          if (x > center) nx = Math.min(w - 1, x + 1);
        }
      }

      put(dst, nx, ny, ch);
    }
  }

  // Subtle body bob on the passing frame.
  if (phase === 2) {
    const bob = makeBlank(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = src[y][x];
        if (ch !== '0') put(bob, x, Math.max(0, y - 1), ch);
      }
    }
    return stringifyRows(bob);
  }

  return stringifyRows(dst);
};

const animateIdle = (baseRows, phase) => {
  if (phase === 0 || phase === 2) return baseRows;
  const src = cloneRows(baseRows);
  const h = src.length;
  const w = src[0].length;
  const dst = makeBlank(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = src[y][x];
      if (ch === '0') continue;
      let ny = y;
      if (y < h - 3) ny = Math.max(0, y - 1);
      put(dst, x, ny, ch);
    }
  }

  return stringifyRows(dst);
};

const framesToRgba = (frames) => {
  const height = frames[0].length;
  const width = frames[0][0].length * frames.length;
  const rgba = new Uint8Array(width * height * 4);

  for (let f = 0; f < frames.length; f++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < frames[f][y].length; x++) {
        const i = (y * width + f * frames[f][y].length + x) * 4;
        const px = RGBA[frames[f][y][x]];
        rgba[i] = px[0];
        rgba[i + 1] = px[1];
        rgba[i + 2] = px[2];
        rgba[i + 3] = px[3];
      }
    }
  }
  return { width, height, rgba };
};

for (const target of TARGETS) {
  const fullPath = path.resolve(ROOT, target.path);
  const png = decodePng(await fs.readFile(fullPath));
  const rawRows = frameToMaskRows(png, PALETTE, 'strict');
  const baseRows = extractBaseRows(rawRows, target.frameWidth);
  const frames = target.mode === 'walk'
    ? [
        baseRows,
        animateStep(baseRows, 1),
        animateStep(baseRows, 2),
        animateStep(baseRows, 3),
      ]
    : [
        baseRows,
        animateIdle(baseRows, 1),
        baseRows,
        animateIdle(baseRows, 3),
      ];
  await fs.writeFile(fullPath, encodePng(framesToRgba(frames)));
}

console.log(`Generated character animation strips for ${TARGETS.length} source PNGs.`);
