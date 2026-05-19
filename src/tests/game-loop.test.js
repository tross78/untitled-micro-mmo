import { GameLoop } from '../app/loop.js';

describe('GameLoop', () => {
    beforeEach(() => {
        global.requestAnimationFrame = jest.fn((_cb) => { return 1; });
        global.cancelAnimationFrame = jest.fn();
        Object.defineProperty(global, 'performance', {
            value: { now: jest.fn(() => 1000) },
            configurable: true,
            writable: true,
        });
        document.addEventListener = jest.fn();
        document.removeEventListener = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('constructor defaults to 60 fps with stopped state', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        expect(loop.fps).toBe(60);
        expect(loop.delta).toBeCloseTo(1 / 60);
        expect(loop.stopped).toBe(true);
        expect(loop.gameTime).toBe(0);
    });

    test('start schedules requestAnimationFrame and marks running', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        expect(requestAnimationFrame).toHaveBeenCalled();
        expect(loop.stopped).toBe(false);
        loop.stop();
    });

    test('start is idempotent', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        const callCount = requestAnimationFrame.mock.calls.length;
        loop.start();
        expect(requestAnimationFrame.mock.calls.length).toBe(callCount);
        loop.stop();
    });

    test('stop cancels rAF and marks stopped', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        loop.stop();
        expect(loop.stopped).toBe(true);
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    test('stop is safe when not started', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        expect(() => loop.stop()).not.toThrow();
    });

    test('frame calls update and render for a normal timestep', () => {
        const update = jest.fn();
        const render = jest.fn();
        const loop = new GameLoop({ fps: 60, update, render });
        loop.start(); // assigns loop.frame
        loop.last = 1000;
        loop.frame(1017); // ~17ms = one 60fps step
        expect(update).toHaveBeenCalled();
        expect(render).toHaveBeenCalled();
    });

    test('frame does nothing if stopped', () => {
        const update = jest.fn();
        const render = jest.fn();
        const loop = new GameLoop({ fps: 60, update, render });
        loop.start();
        loop.stopped = true;
        loop.frame(1017);
        expect(update).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
    });

    test('gameTime advances monotonically', () => {
        const update = jest.fn();
        const render = jest.fn();
        const loop = new GameLoop({ fps: 60, update, render });
        loop.start();
        loop.last = 1000;
        loop.frame(1100); // 100ms
        expect(loop.gameTime).toBeGreaterThan(0);
        expect(update.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    test('dt is capped to prevent spiral of death', () => {
        const update = jest.fn();
        const loop = new GameLoop({ fps: 60, update, render: jest.fn() });
        loop.start();
        loop.last = 0;
        loop.frame(10000); // huge gap
        expect(update.mock.calls.length).toBeLessThanOrEqual(16);
    });

    test('visibilitychange listener is registered on start', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        loop.stop();
    });

    test('visibilitychange listener is removed on stop', () => {
        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        loop.stop();
        expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
});
