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

    test('weather fades in over 90 frames', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        // First draw starts transition
        sys.draw(ctx, { weather: 'storm' }, 'forest_edge', 1);
        expect(sys.overlayAlpha).toBeCloseTo(1 / 90);

        // After 89 more frames it should still be < 1
        for (let i = 0; i < 88; i++) {
            sys.draw(ctx, { weather: 'storm' }, 'forest_edge', i + 2);
        }
        expect(sys.overlayAlpha).toBeLessThan(1);

        // 90th frame should reach 1 (floating point: use toBeCloseTo)
        sys.draw(ctx, { weather: 'storm' }, 'forest_edge', 91);
        expect(sys.overlayAlpha).toBeCloseTo(1, 5);
    });

    test('switching weather captures previous weather for fade-out', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        // Bring storm to full alpha
        sys.overlayAlpha = 1;
        sys.targetWeather = 'storm';

        // Change to clear — should start fading storm out
        sys.draw(ctx, { weather: 'clear' }, 'forest_edge', 1);

        expect(sys.previousWeather).toBe('storm');
        expect(sys.previousAlpha).toBeGreaterThan(0);
        expect(sys.targetWeather).toBe('clear');
    });

    test('previous weather fades out rather than cutting to clear', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        // Storm at full alpha
        sys.overlayAlpha = 1;
        sys.targetWeather = 'storm';

        // Transition to clear — storm must still be drawn on this frame (fade-out)
        sys.draw(ctx, { weather: 'clear' }, 'forest_edge', 1);

        // fillRect is called for the storm overlay during fade-out
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    test('previous weather alpha decrements to zero and is cleared', () => {
        const ctx = makeCtx();
        const sys = new WeatherRenderSystem({ CW: 320, CH: 240 });

        sys.targetWeather = 'storm';
        sys.overlayAlpha = 1;
        // Trigger transition to clear
        sys.draw(ctx, { weather: 'clear' }, 'forest_edge', 1);
        expect(sys.previousWeather).toBe('storm');

        // Run 90+ frames to exhaust the fade-out
        for (let i = 0; i < 95; i++) {
            sys.draw(ctx, { weather: 'clear' }, 'forest_edge', i + 2);
        }
        expect(sys.previousWeather).toBeNull();
        expect(sys.previousAlpha).toBe(0);
    });
});
