#!/usr/bin/env node
import fs from 'node:fs/promises';
import { encodePng } from './lib/asset-pipeline.js';

const W = 48;
const H = 48;

const COLORS = {
  t: [0, 0, 0, 0],
  o: [0, 0, 0, 255],
  s: [136, 136, 136, 255],
  p: [204, 204, 204, 255],
  a: [255, 255, 255, 255],
};

const makeCanvas = () => new Uint8Array(W * H * 4);

const put = (rgba, x, y, color) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const c = COLORS[color];
  rgba[i] = c[0];
  rgba[i + 1] = c[1];
  rgba[i + 2] = c[2];
  rgba[i + 3] = c[3];
};

const fillRect = (rgba, x, y, w, h, color) => {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) put(rgba, xx, yy, color);
  }
};

const fillEllipse = (rgba, cx, cy, rx, ry, color) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(rgba, x, y, color);
    }
  }
};

const fillTriangle = (rgba, ax, ay, bx, by, cx, cy, color) => {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (x1, y1, x2, y2, x3, y3) => (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  const triArea = area(ax, ay, bx, by, cx, cy);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w1 = area(x, y, bx, by, cx, cy) / triArea;
      const w2 = area(ax, ay, x, y, cx, cy) / triArea;
      const w3 = area(ax, ay, bx, by, x, y) / triArea;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) put(rgba, x, y, color);
    }
  }
};

const addOutline = (rgba) => {
  const out = rgba.slice();
  const idx = (x, y) => (y * W + x) * 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (rgba[i + 3] === 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny);
        if (rgba[ni + 3] === 0) {
          out[ni] = COLORS.o[0];
          out[ni + 1] = COLORS.o[1];
          out[ni + 2] = COLORS.o[2];
          out[ni + 3] = COLORS.o[3];
        }
      }
    }
  }
  return out;
};

const writePng = async (file, rgba) => {
  await fs.writeFile(file, encodePng({ width: W, height: H, rgba }));
};

const buildTree = () => {
  const rgba = makeCanvas();
  fillEllipse(rgba, 24, 10, 5, 4, 'a');
  fillEllipse(rgba, 19, 13, 5, 4, 'a');
  fillEllipse(rgba, 30, 14, 5, 4, 'a');
  fillEllipse(rgba, 24, 17, 12, 8, 'p');
  fillEllipse(rgba, 14, 19, 8, 7, 'p');
  fillEllipse(rgba, 35, 20, 9, 8, 'p');
  fillEllipse(rgba, 10, 24, 6, 5, 'p');
  fillEllipse(rgba, 38, 24, 6, 5, 'p');
  fillEllipse(rgba, 18, 26, 8, 6, 'p');
  fillEllipse(rgba, 31, 27, 8, 6, 'p');
  fillEllipse(rgba, 24, 25, 8, 5, 'p');
  fillEllipse(rgba, 23, 28, 6, 3, 'p');
  fillRect(rgba, 22, 31, 4, 9, 's');
  fillRect(rgba, 23, 32, 2, 8, 's');
  fillRect(rgba, 21, 40, 6, 2, 's');
  fillRect(rgba, 20, 42, 8, 2, 's');
  fillRect(rgba, 18, 43, 12, 1, 's');
  const out = addOutline(rgba);
  fillEllipse(out, 24, 16, 4, 3, 'a');
  fillEllipse(out, 18, 18, 3, 2, 'a');
  fillEllipse(out, 30, 19, 3, 2, 'a');
  fillEllipse(out, 22, 21, 2, 2, 'a');
  fillEllipse(out, 28, 21, 2, 2, 'a');
  fillEllipse(out, 17, 24, 2, 2, 'a');
  fillEllipse(out, 31, 25, 2, 2, 'a');
  fillEllipse(out, 20, 23, 3, 2, 'a');
  fillEllipse(out, 28, 24, 3, 2, 'a');
  fillEllipse(out, 24, 22, 2, 2, 'a');
  return out;
};

const buildStall = () => {
  const rgba = makeCanvas();
  fillRect(rgba, 9, 10, 30, 4, 'o');
  fillTriangle(rgba, 8, 10, 40, 10, 24, 4, 'p');
  fillTriangle(rgba, 10, 11, 38, 11, 24, 6, 's');
  fillRect(rgba, 11, 14, 26, 2, 'a');
  fillRect(rgba, 11, 14, 2, 26, 'o');
  fillRect(rgba, 35, 14, 2, 26, 'o');
  fillRect(rgba, 13, 18, 22, 10, 'p');
  fillRect(rgba, 13, 18, 22, 2, 'o');
  fillRect(rgba, 13, 24, 22, 2, 'o');
  fillRect(rgba, 13, 18, 2, 20, 'o');
  fillRect(rgba, 33, 18, 2, 20, 'o');
  fillRect(rgba, 15, 20, 18, 4, 's');
  fillRect(rgba, 15, 26, 18, 4, 's');
  fillRect(rgba, 16, 30, 16, 4, 'p');
  fillRect(rgba, 14, 34, 20, 2, 'o');
  fillRect(rgba, 18, 36, 12, 3, 's');
  fillRect(rgba, 10, 40, 28, 2, 'o');
  fillRect(rgba, 15, 37, 4, 5, 'o');
  fillRect(rgba, 29, 37, 4, 5, 'o');
  fillRect(rgba, 16, 15, 6, 2, 'a');
  fillRect(rgba, 26, 15, 6, 2, 'a');
  const out = addOutline(rgba);
  fillRect(out, 23, 7, 2, 3, 'a');
  return out;
};

const buildBookshelf = () => {
  const rgba = makeCanvas();
  fillRect(rgba, 10, 7, 28, 36, 'o');
  fillRect(rgba, 12, 9, 24, 32, 'p');
  fillRect(rgba, 13, 10, 22, 30, 's');
  fillRect(rgba, 14, 12, 20, 2, 'a');
  fillRect(rgba, 14, 20, 20, 2, 'a');
  fillRect(rgba, 14, 28, 20, 2, 'a');
  fillRect(rgba, 15, 33, 18, 4, 'p');
  fillRect(rgba, 16, 34, 16, 2, 'o');
  fillRect(rgba, 15, 14, 4, 6, 'a');
  fillRect(rgba, 20, 13, 3, 7, 'p');
  fillRect(rgba, 24, 15, 5, 5, 'a');
  fillRect(rgba, 30, 14, 3, 6, 'p');
  fillRect(rgba, 16, 22, 5, 5, 'p');
  fillRect(rgba, 22, 22, 4, 5, 'a');
  fillRect(rgba, 27, 22, 5, 5, 'p');
  fillRect(rgba, 16, 30, 4, 5, 'a');
  fillRect(rgba, 21, 30, 5, 5, 'p');
  fillRect(rgba, 28, 30, 4, 5, 'a');
  fillRect(rgba, 18, 16, 2, 2, 'o');
  fillRect(rgba, 26, 17, 2, 2, 'o');
  fillRect(rgba, 18, 24, 2, 2, 'o');
  fillRect(rgba, 26, 25, 2, 2, 'o');
  fillRect(rgba, 18, 32, 2, 2, 'o');
  fillRect(rgba, 26, 33, 2, 2, 'o');
  const out = addOutline(rgba);
  fillRect(out, 12, 8, 24, 1, 'a');
  return out;
};

const buildFireplace = () => {
  const rgba = makeCanvas();
  fillRect(rgba, 14, 6, 20, 6, 'o');
  fillRect(rgba, 15, 7, 18, 4, 'p');
  fillRect(rgba, 18, 2, 12, 5, 'o');
  fillRect(rgba, 19, 3, 10, 3, 's');
  fillRect(rgba, 11, 12, 26, 26, 'o');
  fillRect(rgba, 13, 14, 22, 22, 'p');
  fillRect(rgba, 14, 15, 20, 20, 's');
  fillRect(rgba, 17, 17, 14, 16, 'o');
  fillRect(rgba, 18, 18, 12, 14, 'p');
  fillRect(rgba, 20, 20, 8, 10, 't');
  fillTriangle(rgba, 18, 30, 24, 18, 30, 30, 'a');
  fillTriangle(rgba, 19, 29, 24, 20, 29, 29, 'p');
  fillRect(rgba, 19, 28, 10, 2, 's');
  fillRect(rgba, 18, 36, 14, 2, 'o');
  fillRect(rgba, 16, 40, 18, 2, 'o');
  fillRect(rgba, 18, 39, 14, 1, 's');
  fillRect(rgba, 14, 13, 20, 2, 'a');
  fillRect(rgba, 16, 15, 16, 1, 'a');
  const out = addOutline(rgba);
  fillRect(out, 21, 23, 6, 6, 'a');
  fillRect(out, 22, 24, 4, 4, 'p');
  return out;
};

await writePng('assets/source/scenery/tree.png', buildTree());
await writePng('assets/source/scenery/stall.png', buildStall());
await writePng('assets/source/scenery/bookshelf.png', buildBookshelf());
await writePng('assets/source/scenery/fireplace.png', buildFireplace());
