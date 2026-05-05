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
]);

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

export const frameToMaskRows = ({ width, height, rgba }, palette) => {
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
      const match = paletteEntries.find(({ rgb: entry }) =>
        entry[0] === rgb[0] && entry[1] === rgb[1] && entry[2] === rgb[2]
      );
      if (!match) {
        throw new Error(`Unsupported source color rgb(${rgb.join(',')}) in strict 4-color import`);
      }
      row += ROLE_DIGITS.get(match.role);
    }
    rows.push(row);
  }
  return rows;
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
  };

  for (const spec of manifest.assetManifest || []) {
    const sourcePath = path.resolve(baseDir, spec.source);
    const png = decodePng(await fs.readFile(sourcePath));
    for (const [variant, rect] of Object.entries(spec.variants || {})) {
      const frame = cropFrame(png, rect);
      const key = variant === 'base' ? spec.id : `${spec.id}_${variant}`;
      assets[key] = frameToMaskRows(frame, palette);
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
