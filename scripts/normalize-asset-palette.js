#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePng, encodePng, remapPngToPalette } from './lib/asset-pipeline.js';

const DEFAULT_PALETTE = {
  outline: '#000000',
  secondary: '#888888',
  primary: '#cccccc',
  accent: '#ffffff',
};

const [, , inputArg, outputArg, ...rest] = process.argv;

if (!inputArg) {
  console.error('Usage: node scripts/normalize-asset-palette.js <input.png> [output.png] [--alpha-cutoff=1]');
  process.exitCode = 1;
} else {
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg || inputArg);
  const alphaCutoffArg = rest.find((arg) => arg.startsWith('--alpha-cutoff='));
  const alphaCutoff = alphaCutoffArg ? Number.parseInt(alphaCutoffArg.split('=')[1], 10) : 1;

  const png = decodePng(await fs.readFile(inputPath));
  const remapped = remapPngToPalette(png, DEFAULT_PALETTE, alphaCutoff);
  await fs.writeFile(outputPath, encodePng(remapped));
  console.log(`Normalized ${path.relative(process.cwd(), inputPath)} -> ${path.relative(process.cwd(), outputPath)}`);
}
