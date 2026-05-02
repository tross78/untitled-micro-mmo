import { drawTile, generateCharacterSprite, getWalkPose, zoneTileType } from '../graphics/graphics.js';

function makeCtx() {
    return {
        fillStyle: '',
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        fillRect: jest.fn(),
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
        expect(zoneTileType('forest_depths')).toBe('grass');
        expect(zoneTileType('lake_shore')).toBe('water');
        expect(zoneTileType('unknown')).toBe('stone_floor');
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
            expect(canvas.ctx.fillRect).toHaveBeenCalled();
        });
    });

    test('getWalkPose returns repeating deterministic pose values', () => {
        expect(getWalkPose(0)).toEqual(getWalkPose(400));
        expect(getWalkPose(100)).toHaveProperty('legOffset');
        expect(getWalkPose(100)).toHaveProperty('bodyY');
    });
});
