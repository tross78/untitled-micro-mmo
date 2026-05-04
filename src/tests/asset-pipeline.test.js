import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { compileAssets, compileAssetManifestFile, decodePng, emitCompiledAssetModule } from '../../scripts/lib/asset-pipeline.js';

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

const encodePng = ({ width, height, pixels }) => {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
        rows.push(Buffer.from(pixels.slice(y * width * 4, (y + 1) * width * 4)));
    }
    const idat = zlib.deflateSync(Buffer.concat(rows));
    return Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};

const rgba = (...values) => Uint8Array.from(values.flat());

describe('asset pipeline', () => {
    test('decodes a simple rgba png fixture', () => {
        const png = encodePng({
            width: 2,
            height: 1,
            pixels: rgba([0, 0, 0, 255], [255, 255, 255, 255]),
        });
        const decoded = decodePng(png);
        expect(decoded.width).toBe(2);
        expect(decoded.height).toBe(1);
        expect(Array.from(decoded.rgba.slice(0, 8))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    });

    test('compiles strict 4-color PNGs into mask rows', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hearthwick-assets-'));
        const pngPath = path.join(dir, 'player.png');
        const manifestPath = path.join(dir, 'manifest.json');
        const outputPath = path.join(dir, 'compiled-assets.js');
        const pixels = rgba(
            [0, 0, 0, 255], [136, 136, 136, 255],
            [204, 204, 204, 255], [255, 255, 255, 255]
        );
        await fs.writeFile(pngPath, encodePng({ width: 2, height: 2, pixels }));
        await fs.writeFile(manifestPath, JSON.stringify({
            compilerOptions: {
                palette: {
                    outline: '#000000',
                    secondary: '#888888',
                    primary: '#cccccc',
                    accent: '#ffffff',
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
        expect(compiled.assets.player_test).toEqual(['12', '34']);

        const generated = await fs.readFile(outputPath, 'utf8');
        expect(generated).toContain('"player_test": [');
        expect(generated).toContain('"12"');
        expect(generated).toContain('"34"');
        expect(generated).toContain('"family":"player"');
    });

    test('rejects unsupported colors under strict palette mode', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hearthwick-assets-bad-'));
        const pngPath = path.join(dir, 'bad.png');
        const pixels = rgba([12, 34, 56, 255]);
        await fs.writeFile(pngPath, encodePng({ width: 1, height: 1, pixels }));
        await expect(compileAssets({
            compilerOptions: {
                palette: {
                    outline: '#000000',
                    secondary: '#888888',
                    primary: '#cccccc',
                    accent: '#ffffff',
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

    test('emits deterministic generated modules', async () => {
        const compiled = {
            assets: { tree_test: ['11', '33'] },
            meta: { tree_test: { family: 'scenery', variant: 'base', logicalWidth: 2, logicalHeight: 2 } },
        };
        expect(emitCompiledAssetModule(compiled)).toBe(emitCompiledAssetModule(compiled));
    });
});
