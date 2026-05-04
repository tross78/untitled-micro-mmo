#!/usr/bin/env node
import path from 'node:path';
import { compileAssetManifestFile } from './lib/asset-pipeline.js';

const manifestPath = process.argv[2] || path.resolve('assets/spec/manifest.json');
const outputPath = process.argv[3] || path.resolve('src/generated/assets/compiled-assets.js');

compileAssetManifestFile({ manifestPath, outputPath })
  .then(({ assets }) => {
    console.log(`Compiled ${Object.keys(assets).length} asset frame(s) to ${outputPath}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
