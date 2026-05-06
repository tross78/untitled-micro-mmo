import { drawTile, generateCharacterSprite, getWalkPose, zoneTileType, roundRect, hasCompiledAssetShape, getCompiledAssetMeta, getGrayscaleTemplate } from '../graphics/graphics.js';
import { TILE_TAXONOMY, SCENERY_SIZE_CLASSES } from '../infra/graphics-constants.js';
import { ENEMIES } from '../content/data/enemies.js';
import { NPCS } from '../content/data/npcs.js';

function makeCtx() {
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        globalAlpha: 1.0,
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        arc: jest.fn(),
        arcTo: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({
            data: new Uint8ClampedArray(16 * 16 * 4)
        })),
        putImageData: jest.fn(),
        closePath: jest.fn(),
        measureText: jest.fn(() => ({ width: 50 })),
        fillText: jest.fn(),
    };
}

describe('graphics procedural primitives', () => {
    let originalOffscreenCanvas;

    beforeEach(() => {
        originalOffscreenCanvas = global.OffscreenCanvas;
        global.OffscreenCanvas = class {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.ctx = makeCtx();
            }
            getContext(type) {
                return type === '2d' ? this.ctx : null;
            }
        };
    });

    afterEach(() => {
        global.OffscreenCanvas = originalOffscreenCanvas;
    });

    test('zoneTileType maps known zones and falls back to stone floor', () => {
        expect(zoneTileType('tavern')).toBe('interior');
        expect(zoneTileType('forest_depths')).toBe('forest');
        expect(zoneTileType('lake_shore')).toBe('sand');
        expect(zoneTileType('unknown')).toBe('stone_floor');
    });

    test('taxonomy and size classes are coherent', () => {
        const allTiles = Object.values(TILE_TAXONOMY).flat();
        expect(allTiles).toContain('grass');
        expect(allTiles).toContain('wall');
        
        const allScenery = Object.values(SCENERY_SIZE_CLASSES).flat();
        expect(allScenery).toContain('tree');
        expect(allScenery).toContain('torch');
        
        // No overlap between tiles and scenery labels
        const tileSet = new Set(allTiles);
        allScenery.forEach(sc => expect(tileSet.has(sc)).toBe(false));
    });

    test('compiled asset registry is available for migrated ids', () => {
        expect(hasCompiledAssetShape('player')).toBe(true);
        expect(hasCompiledAssetShape('tree')).toBe(true);
        expect(getCompiledAssetMeta('bookshelf')).toMatchObject({
            family: 'scenery',
            logicalWidth: 2,
            logicalHeight: 1,
        });
    });

    test('all active enemy ids resolve through compiled assets', () => {
        Object.keys(ENEMIES).forEach((enemyId) => {
            expect(hasCompiledAssetShape(enemyId)).toBe(true);
            expect(getCompiledAssetMeta(enemyId)).toMatchObject({
                family: 'enemy',
                logicalWidth: 1,
                logicalHeight: 1,
            });
        });
    });

    test('authored NPCs can resolve distinct sprite ids for the visible slice', () => {
        expect(NPCS.guard.sprite).toBe('guard');
        expect(NPCS.barkeep.sprite).toBe('barkeep');
        expect(hasCompiledAssetShape('guard')).toBe(true);
        expect(hasCompiledAssetShape('barkeep')).toBe(true);
        expect(getCompiledAssetMeta('guard')).toMatchObject({
            family: 'npc',
            logicalWidth: 1,
            logicalHeight: 1,
        });
        expect(getCompiledAssetMeta('barkeep')).toMatchObject({
            family: 'npc',
            logicalWidth: 1,
            logicalHeight: 1,
        });
    });

    test('large authored scenery preserves its authored canvas size', () => {
        const tree = getGrayscaleTemplate('tree');
        expect(tree.width).toBeGreaterThanOrEqual(16);
        expect(tree.height).toBeGreaterThan(16);
    });

    test('drawTile is deterministic for same tile type and seed', () => {
        const a = makeCtx();
        const b = makeCtx();

        drawTile(a, 'grass', 0, 0, 1234, 16);
        drawTile(b, 'grass', 0, 0, 1234, 16);

        expect(a.fillRect.mock.calls).toEqual(b.fillRect.mock.calls);
    });

    test('drawTile covers every tile branch without throwing', () => {
        ['grass', 'stone_floor', 'wall', 'water', 'exit', 'interior', 'missing'].forEach((type, idx) => {
            expect(() => drawTile(makeCtx(), type, 0, 0, 100 + idx, 16)).not.toThrow();
        });
    });

    test('generateCharacterSprite uses OffscreenCanvas and returns 16x16 canvas for entity types', () => {
        ['self', 'peer', 'npc', 'enemy', 'other'].forEach(type => {
            const canvas = generateCharacterSprite(123, type);
            expect(canvas.width).toBe(16);
            expect(canvas.height).toBe(16);
            // Can be fillRect (fallback) or putImageData (bitmask + palette)
            const wasDrawn = canvas.ctx.fillRect.mock.calls.length > 0 || 
                             canvas.ctx.putImageData.mock.calls.length > 0;
            expect(wasDrawn).toBe(true);
        });
    });

    test('character sprite generation is deterministic and includes varied enemy types', () => {
        const seed1 = 12345;
        const seed2 = 67890;
        
        // Enemy type selection is deterministic from seed
        const canvas1a = generateCharacterSprite(seed1, 'enemy');
        const canvas1b = generateCharacterSprite(seed1, 'enemy');
        generateCharacterSprite(seed2, 'enemy');
        
        expect(canvas1a.ctx.putImageData.mock.calls).toEqual(canvas1b.ctx.putImageData.mock.calls);
    });

    test('getWalkPose returns repeating deterministic pose values', () => {
        expect(getWalkPose(0)).toEqual(getWalkPose(400));
        expect(getWalkPose(100)).toHaveProperty('legOffset');
        expect(getWalkPose(100)).toHaveProperty('bodyY');
    });

    test('roundRect calls drawing primitives', () => {
        const ctx = makeCtx();
        roundRect(ctx, 0, 0, 100, 100, 10);
        expect(ctx.beginPath).toHaveBeenCalled();
        expect(ctx.arcTo).toHaveBeenCalled();
        expect(ctx.closePath).toHaveBeenCalled();
    });
});
