#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const SHAPES = {
  'assets/source/players/player_attack.png': [
    '0000000000000000',
    '0000012222110000',
    '0002222222222200',
    '0121221211222200',
    '0142112444211141',
    '0141341444144341',
    '0001441444144100',
    '0012214444411110',
    '0141223212222210',
    '1442122222222100',
    '1111112222211110',
    '0112222212222111',
    '0001112112211100',
    '0001121101221000',
    '0001111000111100',
    '0000000110000000',
  ],
  'assets/source/players/player_attack_back.png': [
    '0000000000000000',
    '0000002222110000',
    '0002222222222200',
    '0012222222222210',
    '0142222222222241',
    '0143222222222341',
    '0001112222211100',
    '0112221111122210',
    '1111222222222141',
    '1442122222221344',
    '1111112222211111',
    '0111222222222111',
    '0001112222211100',
    '0001122101221100',
    '0000111000111000',
    '0000000000000000',
  ],
  'assets/source/players/player_attack_side.png': [
    '0000000000000000',
    '0001122222221002',
    '0122222222222221',
    '1222222222131210',
    '0122222231444100',
    '0012141244414100',
    '0001144444444311',
    '0000122111111110',
    '0001221222222000',
    '0012144312222000',
    '0011122111114100',
    '0001144112222000',
    '0001111222111000',
    '0000012222122000',
    '0000001111110000',
    '0000000000000000',
  ],
  'assets/source/players/player_hurt.png': [
    '0000000000000000',
    '0000012222110000',
    '0002222222222200',
    '0121221211222200',
    '0142112444211141',
    '0141341444144341',
    '0001441444144100',
    '0012214444412210',
    '0141223212222241',
    '1442122222221244',
    '1111112222211111',
    '0011222212221110',
    '0000112112211000',
    '0000011101220000',
    '0000001111110000',
    '0000000000000000',
  ],
};

const COLORS = {
  '0': [0, 0, 0, 0],
  '1': [0, 0, 0, 255],
  '2': [136, 136, 136, 255],
  '3': [204, 204, 204, 255],
  '4': [255, 255, 255, 255],
  '5': [68, 68, 68, 255],
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
    for (const ch of row) pixels.push(...COLORS[ch]);
    imageRows.push(Buffer.from(pixels));
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(imageRows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

for (const [relPath, rows] of Object.entries(SHAPES)) {
  const fullPath = path.resolve(ROOT, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, encodeShapePng(rows));
}

console.log(`Generated ${Object.keys(SHAPES).length} player action pose PNGs.`);
