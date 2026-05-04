#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const STARTER_SHAPES = {
  'assets/source/players/player.png': [
    '00011000', '00133100', '01333310', '01333310', '00133100', '00011000',
    '00133100', '01333310', '13333331', '01333310', '01133110', '01133110',
    '01100110', '01100110',
  ],
  'assets/source/players/player_back.png': [
    '00011000', '00122100', '01222210', '01222210', '00122100', '00011000',
    '00133100', '01333310', '13333331', '01333310', '01133110', '01133110',
    '01100110', '01100110',
  ],
  'assets/source/players/player_side.png': [
    '00011100', '00133310', '01333310', '01333110', '00133100', '00011000',
    '00133100', '01333310', '01333110', '01333110', '01133100', '01133100',
    '01100000', '01100000',
  ],
  'assets/source/enemies/forest_wolf.png': [
    '00000000', '00000000', '00000000', '30000300', '33003300', '03333000',
    '03131300', '13414310', '03333000', '02333200', '03303300', '03000300', '11000110',
  ],
  'assets/source/enemies/goblin.png': [
    '00011000', '00133100', '01333310', '00133100', '00111100', '01111110',
    '12333321', '01311310', '01311310', '00111100', '00111100', '01100110', '01100110',
  ],
  'assets/source/enemies/bandit.png': [
    '00111100', '01333310', '01311310', '01333310', '00111100', '00133100',
    '01333310', '13333331', '01333310', '01111110', '01133110', '01100110', '01100110',
  ],
  'assets/source/enemies/cave_troll.png': [
    '00011000', '00133100', '01333310', '01333310', '00133100', '01111110',
    '13333331', '13333331', '13333331', '01333310', '01333310', '01133110', '01100110', '01100110',
  ],
  'assets/source/enemies/mountain_troll.png': [
    '00011000', '00133100', '01333310', '01333310', '00133100', '01111110',
    '13333331', '13344331', '13333331', '13333331', '01333310', '01333310', '01133110', '01100110',
  ],
  'assets/source/enemies/ruin_shade.png': [
    '00011000', '00144100', '01444410', '01411410', '01444410', '00144100',
    '00133100', '01333310', '01333310', '01300310', '12000210', '02000200', '00000000',
  ],
  'assets/source/enemies/wraith.png': [
    '00011000', '00144100', '01444410', '01411410', '01444410', '00144100',
    '00133100', '01333310', '01333310', '01300310', '12000210', '02000200', '00000000',
  ],
  'assets/source/enemies/skeleton.png': [
    '00011000', '00133100', '01311310', '01333310', '00111100', '00011000',
    '00133100', '01311310', '01311310', '00111100', '00111100', '01100110', '01100110',
  ],
  'assets/source/enemies/crab.png': [
    '00000000', '00000000', '01000010', '00111100', '01333310', '13333331',
    '01111110', '01011010', '11000011', '00000000', '00000000', '00000000',
  ],
  'assets/source/npcs/guard.png': [
    '00111100', '01333310', '01344310', '01311310', '00111100', '02333320',
    '23333332', '23333332', '23333332', '23333332', '02200220', '02200220', '01100110',
  ],
  'assets/source/scenery/tree.png': [
    '00033000', '00333300', '00333300', '03333330', '03333330', '33333333',
    '33333333', '00011000', '00011000', '00011000', '00011000', '00011000',
  ],
  'assets/source/scenery/stall.png': [
    '11111111', '14444431', '14444431', '01111110', '00000000', '01133110',
    '11333311', '11333311', '01133110', '00000000', '00000000', '00000000',
  ],
  'assets/source/scenery/bookshelf.png': [
    '11111111', '12321231', '12321231', '11111111',
    '13212312', '13212312', '11111111', '12321231',
    '12321231', '11111111', '00000000', '00000000',
  ],
  'assets/source/scenery/fireplace.png': [
    '11111111', '12222221', '12222221', '12344321',
    '12443421', '12344321', '12222221', '11111111',
    '00000000', '00000000', '00000000', '00000000',
  ],
};

const COLORS = {
  '0': [0, 0, 0, 0],
  '1': [0, 0, 0, 255],
  '2': [136, 136, 136, 255],
  '3': [204, 204, 204, 255],
  '4': [255, 255, 255, 255],
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const out = Buffer.alloc(8 + payload.length + 4);
  out.writeUInt32BE(payload.length, 0);
  typeBytes.copy(out, 4);
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return out;
};

const encodeShapePng = (rows) => {
  const height = rows.length;
  const width = rows[0].length;
  const imageRows = [];
  for (const row of rows) {
    imageRows.push(Buffer.from([0]));
    const pixels = [];
    for (const char of row) pixels.push(...COLORS[char]);
    imageRows.push(Buffer.from(pixels));
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(Buffer.concat(imageRows));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

for (const [relPath, rows] of Object.entries(STARTER_SHAPES)) {
  const fullPath = path.resolve(relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, encodeShapePng(rows));
}

console.log(`Bootstrapped ${Object.keys(STARTER_SHAPES).length} starter PNG asset(s).`);
