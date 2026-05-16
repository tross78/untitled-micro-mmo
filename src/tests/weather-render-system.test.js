import { WeatherRenderSystem } from '../systems/weather-render-system.js';

function makeCtx() {
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        fillRect: jest.fn(),
        stroke: jest.fn(),
    };
}

describe('WeatherRenderSystem', () => {
    test('skips drawing weather overlays in dungeon rooms', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        sys.draw(ctx, { weather: 'storm' }, 'ruins', 1);

        expect(ctx.fillRect).not.toHaveBeenCalled();
        expect(ctx.stroke).not.toHaveBeenCalled();
    });

    test('draws storm overlay in wilderness rooms', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        sys.draw(ctx, { weather: 'storm' }, 'forest_edge', 1);

        expect(ctx.fillRect).toHaveBeenCalled();
        expect(ctx.beginPath).toHaveBeenCalled();
        expect(ctx.stroke).toHaveBeenCalled();
        expect(ctx.lineWidth).toBe(2);
    });

    test('draws fog as patch grid rather than using gradients', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 32, CH: 24 });

        sys.drawFog(ctx, 'wilderness', 1, 2);

        expect(ctx.fillRect).toHaveBeenCalled();
    });
});
