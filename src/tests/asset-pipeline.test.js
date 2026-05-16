import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileAssets, compileAssetManifestFile, decodePng, emitCompiledAssetModule, encodePng, remapPngToPalette } from '../../scripts/lib/asset-pipeline.js';

const rgba = (...values) => Uint8Array.from(values.flat());

describe('asset pipeline', () => {
    test('decodes a simple rgba png fixture', () => {
        const png = encodePng({
            width: 2,
            height: 1,
            rgba: rgba([0, 0, 0, 255], [255, 255, 255, 255]),
        });
        const decoded = decodePng(png);
        expect(decoded.width).toBe(2);
        expect(decoded.height).toBe(1);
        expect(Array.from(decoded.rgba.slice(0, 8))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    });

    test('compiles strict role-color PNGs into mask rows', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenhollow-assets-'));
        const pngPath = path.join(dir, 'player.png');
        const manifestPath = path.join(dir, 'manifest.json');
        const outputPath = path.join(dir, 'compiled-assets.js');
        const pixels = rgba(
            [0, 0, 0, 255], [136, 136, 136, 255],
            [204, 204, 204, 255], [68, 68, 68, 255]
        );
        await fs.writeFile(pngPath, encodePng({ width: 2, height: 2, rgba: pixels }));
        await fs.writeFile(manifestPath, JSON.stringify({
            compilerOptions: {
                palette: {
                    outline: '#000000',
                    secondary: '#888888',
                    primary: '#cccccc',
                    accent: '#ffffff',
                    shadow: '#444444',
                },
            },
            assetManifest: [{
                id: 'player_test',
                family: 'player',
                source: './player.png',
                variants: {
                    base: { x: 0, y: 0, w: 2, h: 2, logicalWidth: 1, logicalHeight: 1 }
                }
            }],
        }), 'utf8');

        const compiled = await compileAssetManifestFile({ manifestPath, outputPath });
        expect(compiled.assets.player_test).toEqual(['12', '35']);

        const generated = await fs.readFile(outputPath, 'utf8');
        expect(generated).toContain('"player_test": [');
        expect(generated).toContain('"12"');
        expect(generated).toContain('"35"');
        expect(generated).toContain('"family":"player"');
    });

    test('rejects unsupported colors under strict palette mode', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenhollow-assets-bad-'));
        const pngPath = path.join(dir, 'bad.png');
        const pixels = rgba([12, 34, 56, 255]);
        await fs.writeFile(pngPath, encodePng({ width: 1, height: 1, rgba: pixels }));
        await expect(compileAssets({
            compilerOptions: {
                palette: {
                    outline: '#000000',
                    secondary: '#888888',
                    primary: '#cccccc',
                    accent: '#ffffff',
                    shadow: '#444444',
                },
            },
            assetManifest: [{
                id: 'bad',
                family: 'scenery',
                source: './bad.png',
                variants: { base: { x: 0, y: 0, w: 1, h: 1 } },
            }],
        }, dir)).rejects.toThrow('Unsupported source color');
    });

    test('quantized color mode reduces arbitrary pixel colors into the role mask palette', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenhollow-assets-quantized-'));
        const pngPath = path.join(dir, 'tile.png');
        const pixels = rgba(
            [5, 5, 5, 255],
            [150, 150, 150, 255],
            [210, 210, 210, 255],
            [80, 80, 80, 255]
        );
        await fs.writeFile(pngPath, encodePng({ width: 2, height: 2, rgba: pixels }));

        const compiled = await compileAssets({
            compilerOptions: {
                colorMode: 'quantized',
                palette: {
                    outline: '#000000',
                    secondary: '#888888',
                    primary: '#cccccc',
                    accent: '#ffffff',
                    shadow: '#444444',
                },
            },
            assetManifest: [{
                id: 'tile_test',
                family: 'scenery',
                source: './tile.png',
                variants: { base: { x: 0, y: 0, w: 2, h: 2 } },
            }],
        }, dir);

        expect(compiled.assets.tile_test).toEqual(['12', '35']);
    });

    test('palette normalization rewrites arbitrary colors into strict palette values', () => {
        const remapped = remapPngToPalette({
            width: 2,
            height: 1,
            rgba: rgba([13, 13, 13, 255], [245, 245, 245, 255]),
        }, {
            outline: '#000000',
            secondary: '#888888',
            primary: '#cccccc',
            accent: '#ffffff',
            shadow: '#444444',
        });

        expect(Array.from(remapped.rgba)).toEqual([
            0, 0, 0, 255,
            255, 255, 255, 255,
        ]);
    });

    test('emits deterministic generated modules', async () => {
        const compiled = {
            assets: { tree_test: ['11', '33'] },
            meta: { tree_test: { family: 'scenery', variant: 'base', logicalWidth: 2, logicalHeight: 2 } },
        };
        expect(emitCompiledAssetModule(compiled)).toBe(emitCompiledAssetModule(compiled));
    });
});
