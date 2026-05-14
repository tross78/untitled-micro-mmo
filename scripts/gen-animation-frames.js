#!/usr/bin/env node
/**
 * Generates animated sprite sheet PNGs for the asset pipeline.
 * Each output PNG is a horizontal strip: frameCount × frameWidth × frameHeight.
 * Run before `npm run assets:compile`.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/asset-pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, '../assets/source');

const CHAR_RGBA = {
    '0': [0,   0,   0,   0],    // transparent
    '1': [0,   0,   0,   255],  // outline (black)
    '2': [136, 136, 136, 255],  // secondary (grey)
    '3': [204, 204, 204, 255],  // primary (light grey)
    '4': [255, 255, 255, 255],  // accent (white)
};

const framesToPng = (frames) => {
    const frameH = frames[0].length;
    const frameW = Math.max(...frames[0].map(r => r.length));
    const width = frameW * frames.length;
    const rgba = new Uint8Array(width * frameH * 4);

    for (let f = 0; f < frames.length; f++) {
        for (let y = 0; y < frameH; y++) {
            const row = frames[f][y] || '';
            for (let x = 0; x < frameW; x++) {
                const [r, g, b, a] = CHAR_RGBA[row[x] || '0'];
                const i = (y * width + f * frameW + x) * 4;
                rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = a;
            }
        }
    }

    return encodePng({ width, height: frameH, rgba });
};

const makeCharCanvas = (width, height, fill = '0') =>
    Array.from({ length: height }, () => Array.from({ length: width }, () => fill));

const putChar = (canvas, x, y, value) => {
    if (x < 0 || y < 0 || y >= canvas.length || x >= canvas[0].length) return;
    canvas[y][x] = value;
};

const fillRectChar = (canvas, x, y, w, h, value) => {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) putChar(canvas, xx, yy, value);
    }
};

const fillEllipseChar = (canvas, cx, cy, rx, ry, value) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x - cx) / rx;
            const dy = (y - cy) / ry;
            if (dx * dx + dy * dy <= 1) putChar(canvas, x, y, value);
        }
    }
};

const addOutlineChar = (canvas) => {
    const out = canvas.map((row) => [...row]);
    for (let y = 0; y < canvas.length; y++) {
        for (let x = 0; x < canvas[0].length; x++) {
            if (canvas[y][x] === '0') continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || ny >= canvas.length || nx >= canvas[0].length) continue;
                if (canvas[ny][nx] === '0') out[ny][nx] = '1';
            }
        }
    }
    return out.map((row) => row.join(''));
};

const buildTreeRows = () => {
    const canvas = makeCharCanvas(48, 48);

    // ALttP-like canopy: side-heavy puffball with irregular bulges and a brighter crown.
    fillEllipseChar(canvas, 24, 10, 5, 4, '4');
    fillEllipseChar(canvas, 19, 13, 5, 4, '4');
    fillEllipseChar(canvas, 30, 14, 5, 4, '4');
    fillEllipseChar(canvas, 24, 17, 12, 8, '3');
    fillEllipseChar(canvas, 14, 19, 8, 7, '3');
    fillEllipseChar(canvas, 35, 20, 9, 8, '3');
    fillEllipseChar(canvas, 10, 24, 6, 5, '3');
    fillEllipseChar(canvas, 38, 24, 6, 5, '3');
    fillEllipseChar(canvas, 18, 26, 8, 6, '3');
    fillEllipseChar(canvas, 31, 27, 8, 6, '3');
    fillEllipseChar(canvas, 24, 25, 8, 5, '3');
    fillEllipseChar(canvas, 23, 28, 6, 3, '3');
    fillEllipseChar(canvas, 24, 16, 4, 3, '4');
    fillEllipseChar(canvas, 18, 18, 3, 2, '4');
    fillEllipseChar(canvas, 30, 19, 3, 2, '4');
    fillEllipseChar(canvas, 22, 21, 2, 2, '4');
    fillEllipseChar(canvas, 28, 21, 2, 2, '4');
    fillEllipseChar(canvas, 17, 24, 2, 2, '4');
    fillEllipseChar(canvas, 31, 25, 2, 2, '4');

    // Lower-canopy texture, kept above the trunk join.
    fillEllipseChar(canvas, 20, 23, 3, 2, '4');
    fillEllipseChar(canvas, 28, 24, 3, 2, '4');
    fillEllipseChar(canvas, 24, 22, 2, 2, '4');

    // Trunk and root flare. No canopy/highlight pixels extend into this zone.
    fillRectChar(canvas, 22, 31, 4, 9, '2');
    fillRectChar(canvas, 23, 32, 2, 8, '2');
    fillRectChar(canvas, 21, 40, 6, 2, '2');
    fillRectChar(canvas, 20, 42, 8, 2, '2');
    fillRectChar(canvas, 18, 43, 12, 1, '2');

    return addOutlineChar(canvas);
};

// Sprite data: 0=transparent, 1=outline, 2=secondary, 3=primary, 4=accent
// Colors resolve through each sprite's scenery/entity palette at render time.

const ANIMATIONS = {
    // Tree: 48×48 single frame — must be compiled before assets:compile overwrites it
    'scenery/tree': { frames: [buildTreeRows()] },
    // Torch: 3 frames × 16×16. Flame cycles left → center → right.
    'scenery/torch': { frames: [
        [   // frame 0 — flame leans left
            '0000044000000000',
            '0000443400000000',
            '0000434400000000',
            '0000034400000000',
            '0000033300000000',
            '0000022200000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000001100000000',
        ],
        [   // frame 1 — flame upright
            '0000000440000000',
            '0000004444000000',
            '0000034443000000',
            '0000034443000000',
            '0000033330000000',
            '0000022220000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000001100000000',
        ],
        [   // frame 2 — flame leans right
            '0000000044000000',
            '0000003444000000',
            '0000003440000000',
            '0000003340000000',
            '0000003330000000',
            '0000002220000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000012210000000',
            '0000001100000000',
        ],
    ]},

    // Wolf: 2 frames × 8×13. Ears raise between frames (prowling bob).
    'enemies/wolf': { frames: [
        [   // frame 0 — resting
            '00000000',
            '00000000',
            '00000000',
            '30000300',
            '33003300',
            '03333000',
            '03131300',
            '13414310',
            '03333000',
            '02333200',
            '03303300',
            '03000300',
            '11000110',
        ],
        [   // frame 1 — head raised (ears shift up one row)
            '00000000',
            '00000000',
            '30000300',
            '33003300',
            '03333000',
            '03131300',
            '13414310',
            '03333000',
            '02333200',
            '03303300',
            '03000300',
            '11000110',
            '00000000',
        ],
    ]},

    // Wraith: 2 frames × 8×13. Whole body shifts down 1px = floating oscillation.
    'enemies/wraith': { frames: [
        [   // frame 0 — higher position
            '00011000',
            '00144100',
            '01444410',
            '01411410',
            '01444410',
            '00144100',
            '00133100',
            '01333310',
            '01333310',
            '01300310',
            '12000210',
            '02000200',
            '00000000',
        ],
        [   // frame 1 — lower position (shifted down 1px)
            '00000000',
            '00011000',
            '00144100',
            '01444410',
            '01411410',
            '01444410',
            '00144100',
            '00133100',
            '01333310',
            '01333310',
            '01300310',
            '12000210',
            '02000200',
        ],
    ]},
};

for (const [relPath, { frames }] of Object.entries(ANIMATIONS)) {
    const outPath = path.join(SOURCE_DIR, `${relPath}.png`);
    const png = framesToPng(frames);
    await fs.writeFile(outPath, png);
    const frameW = Math.max(...frames[0].map(r => r.length));
    console.log(`wrote ${path.relative(process.cwd(), outPath)} (${frameW * frames.length}×${frames[0].length}, ${frames.length} frames)`);
}

// forest_wolf shares the wolf sprite sheet
const wolfPng = await fs.readFile(path.join(SOURCE_DIR, 'enemies/wolf.png'));
await fs.writeFile(path.join(SOURCE_DIR, 'enemies/forest_wolf.png'), wolfPng);
console.log('wrote assets/source/enemies/forest_wolf.png (copy of wolf)');
