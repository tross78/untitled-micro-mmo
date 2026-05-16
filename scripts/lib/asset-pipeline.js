import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ROLE_DIGITS = new Map([
  ['outline', '1'],
  ['secondary', '2'],
  ['primary', '3'],
  ['accent', '4'],
  ['shadow', '5'],
]);

const sq = (n) => n * n;

const hexToRgb = (hex) => {
  const normalized = hex.toLowerCase();
  const raw = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (raw.length !== 6) throw new Error(`Invalid palette color "${hex}"`);
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
};

const readUInt32BE = (buffer, offset) =>
  (buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
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

export const decodePng = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Invalid PNG signature');
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth;
  let colorType = 0;
  const idat = [];

  while (offset < bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = bytes.slice(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = readUInt32BE(data, 0);
      height = readUInt32BE(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
      if (colorType !== 6 && colorType !== 2) throw new Error(`Unsupported PNG color type ${colorType}`);
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Unsupported PNG compression/filter/interlace configuration');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * bytesPerPixel;
  const rgba = new Uint8Array(width * height * 4);
  let inOffset = 0;
  let outOffset = 0;
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inOffset++];
    const raw = inflated.slice(inOffset, inOffset + stride);
    inOffset += stride;
    const row = new Uint8Array(stride);

    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= bytesPerPixel ? prev[x - bytesPerPixel] || 0 : 0;
      if (filter === 0) row[x] = raw[x];
      else if (filter === 1) row[x] = (raw[x] + left) & 0xff;
      else if (filter === 2) row[x] = (raw[x] + up) & 0xff;
      else if (filter === 3) row[x] = (raw[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (raw[x] + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter type ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const base = x * bytesPerPixel;
      rgba[outOffset++] = row[base];
      rgba[outOffset++] = row[base + 1];
      rgba[outOffset++] = row[base + 2];
      rgba[outOffset++] = colorType === 6 ? row[base + 3] : 255;
    }
    prev = row;
  }

  return { width, height, rgba };
};

export const encodePng = ({ width, height, rgba }) => {
  const signature = Buffer.from(PNG_SIGNATURE);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)));
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const findExactPaletteEntry = (rgb, paletteEntries) => paletteEntries.find(({ rgb: entry }) =>
  entry[0] === rgb[0] && entry[1] === rgb[1] && entry[2] === rgb[2]
);

const findNearestPaletteEntry = (rgb, paletteEntries) => {
  let best = paletteEntries[0] || null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of paletteEntries) {
    const distance = sq(entry.rgb[0] - rgb[0]) + sq(entry.rgb[1] - rgb[1]) + sq(entry.rgb[2] - rgb[2]);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
};

export const remapPngToPalette = ({ width, height, rgba }, palette, alphaCutoff = 1) => {
  const paletteEntries = Object.entries(palette).map(([role, hex]) => ({ role, rgb: hexToRgb(hex) }));
  const out = new Uint8Array(rgba.length);

  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha < alphaCutoff) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    const match = findNearestPaletteEntry([rgba[i], rgba[i + 1], rgba[i + 2]], paletteEntries);
    out[i] = match.rgb[0];
    out[i + 1] = match.rgb[1];
    out[i + 2] = match.rgb[2];
    out[i + 3] = 255;
  }

  return { width, height, rgba: out };
};

export const frameToMaskRows = ({ width, height, rgba }, palette, colorMode = 'strict') => {
  const paletteEntries = Object.entries(palette).map(([role, hex]) => ({ role, rgb: hexToRgb(hex) }));
  const rows = [];

  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = rgba[idx + 3];
      if (alpha === 0) {
        row += '0';
        continue;
      }
      const rgb = [rgba[idx], rgba[idx + 1], rgba[idx + 2]];
      const match = findExactPaletteEntry(rgb, paletteEntries)
        || (colorMode === 'quantized' ? findNearestPaletteEntry(rgb, paletteEntries) : null);
      if (!match) {
        throw new Error(`Unsupported source color rgb(${rgb.join(',')}) in strict role import`);
      }
      row += ROLE_DIGITS.get(match.role);
    }
    rows.push(row);
  }
  return rows;
};

const rleEncodeRow = (row) => {
  if (!row.length) return [];
  const runs = [];
  let cur = row[0], count = 1;
  for (let i = 1; i < row.length; i++) {
    if (row[i] === cur) { count++; }
    else { runs.push([count, cur]); cur = row[i]; count = 1; }
  }
  runs.push([count, cur]);
  return runs;
};

const cropFrame = (png, rect) => {
  const rgba = new Uint8Array(rect.w * rect.h * 4);
  let out = 0;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const srcX = rect.x + x;
      const srcY = rect.y + y;
      const src = (srcY * png.width + srcX) * 4;
      rgba[out++] = png.rgba[src];
      rgba[out++] = png.rgba[src + 1];
      rgba[out++] = png.rgba[src + 2];
      rgba[out++] = png.rgba[src + 3];
    }
  }
  return { width: rect.w, height: rect.h, rgba };
};

export const compileAssets = async (manifest, baseDir) => {
  const assets = {};
  const meta = {};
  const palette = manifest.compilerOptions?.palette || {
    outline: '#000000',
    secondary: '#888888',
    primary: '#cccccc',
    accent: '#ffffff',
    shadow: '#444444',
  };
  const colorMode = manifest.compilerOptions?.colorMode || 'strict';
  if (!['strict', 'quantized'].includes(colorMode)) {
    throw new Error(`Unsupported colorMode "${colorMode}"`);
  }

  for (const spec of manifest.assetManifest || []) {
    const sourcePath = path.resolve(baseDir, spec.source);
    const png = decodePng(await fs.readFile(sourcePath));
    const frameCount = spec.frameCount ?? 1;
    const frameRate = spec.frameRate ?? null;

    for (const [variant, rect] of Object.entries(spec.variants || {})) {
      const key = variant === 'base' ? spec.id : `${spec.id}_${variant}`;

      if (frameCount > 1) {
        // Multi-frame: source PNG is a horizontal strip (frameCount × rect.w wide)
        // Frame 0 goes into COMPILED_ASSET_SHAPES as the static fallback.
        // All frames are RLE-encoded into COMPILED_ASSET_META.frames.
        const encodedFrames = [];
        for (let f = 0; f < frameCount; f++) {
          const frameRect = { ...rect, x: rect.x + f * rect.w };
          const framePng = cropFrame(png, frameRect);
          const rows = frameToMaskRows(framePng, palette, colorMode);
          encodedFrames.push(rows.map(rleEncodeRow));
          if (f === 0) assets[key] = rows; // frame 0 as static fallback
        }
        meta[key] = {
          family: spec.family,
          variant,
          logicalWidth: rect.logicalWidth ?? spec.logicalWidth ?? 1,
          logicalHeight: rect.logicalHeight ?? spec.logicalHeight ?? 1,
          ...(rect.renderHeightTiles != null ? { renderHeightTiles: rect.renderHeightTiles } : {}),
          ...(rect.renderYOffsetTiles != null ? { renderYOffsetTiles: rect.renderYOffsetTiles } : {}),
          frames: encodedFrames,
          frameRate,
        };
      } else {
        const frame = cropFrame(png, rect);
        assets[key] = frameToMaskRows(frame, palette, colorMode);
        meta[key] = {
          family: spec.family,
          variant,
          logicalWidth: rect.logicalWidth ?? spec.logicalWidth ?? 1,
          logicalHeight: rect.logicalHeight ?? spec.logicalHeight ?? 1,
          ...(rect.renderHeightTiles != null ? { renderHeightTiles: rect.renderHeightTiles } : {}),
          ...(rect.renderYOffsetTiles != null ? { renderYOffsetTiles: rect.renderYOffsetTiles } : {}),
        };
      }
    }
  }

  return { assets, meta };
};

export const emitCompiledAssetModule = ({ assets, meta }) => {
  const lines = [];
  lines.push('// Generated by scripts/compile-assets.js. Do not edit by hand.');
  lines.push('export const COMPILED_ASSET_SHAPES = {');
  for (const [id, rows] of Object.entries(assets)) {
    lines.push(`  ${JSON.stringify(id)}: [`);
    for (const row of rows) lines.push(`    ${JSON.stringify(row)},`);
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push('export const COMPILED_ASSET_META = {');
  for (const [id, info] of Object.entries(meta)) {
    lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(info)},`);
  }
  lines.push('};');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const compileAssetManifestFile = async ({ manifestPath, outputPath }) => {
  const resolvedManifest = path.resolve(manifestPath);
  const ext = path.extname(resolvedManifest).toLowerCase();
  let manifest;
  if (ext === '.json') {
    manifest = JSON.parse(await fs.readFile(resolvedManifest, 'utf8'));
  } else {
    const moduleUrl = pathToFileURL(resolvedManifest).href;
    manifest = await import(`${moduleUrl}?t=${Date.now()}`);
  }
  const compiled = await compileAssets(manifest, path.dirname(resolvedManifest));
  const output = emitCompiledAssetModule(compiled);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), output, 'utf8');
  return compiled;
};
