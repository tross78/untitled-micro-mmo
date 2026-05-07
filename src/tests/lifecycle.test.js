import { jest } from '@jest/globals';
import { GameLoop } from '../app/loop.js';
import { bindSessionLifecycle } from '../main/lifecycle.js';
import { flushSync } from '../state/persistence.js';

jest.mock('../state/persistence.js', () => ({
    flushSync: jest.fn(),
}));

describe('browser lifecycle hooks', () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('GameLoop resets resume timestamp on visibilitychange', () => {
        let now = 1000;
        const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);
        global.requestAnimationFrame = jest.fn();
        global.cancelAnimationFrame = jest.fn();

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });

        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        expect(loop.last).toBe(1000);

        now = 2500;
        document.dispatchEvent(new Event('visibilitychange'));

        expect(loop.last).toBe(2500);
        loop.stop();
        nowSpy.mockRestore();
    });

    test('GameLoop stop removes the visibility listener', () => {
        const addSpy = jest.spyOn(document, 'addEventListener');
        const removeSpy = jest.spyOn(document, 'removeEventListener');
        global.requestAnimationFrame = jest.fn();
        global.cancelAnimationFrame = jest.fn();
        const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(1000);

        const loop = new GameLoop({ update: jest.fn(), render: jest.fn() });
        loop.start();
        expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

        loop.stop();

        expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        addSpy.mockRestore();
        removeSpy.mockRestore();
        nowSpy.mockRestore();
    });

    test('bindSessionLifecycle flushes on pagehide and beforeunload', () => {
        const localPlayer = { name: 'Tester', hp: 10 };
        const cleanup = bindSessionLifecycle(localPlayer);

        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new Event('beforeunload'));

        expect(flushSync).toHaveBeenCalledTimes(2);
        expect(flushSync).toHaveBeenNthCalledWith(1, localPlayer);
        expect(flushSync).toHaveBeenNthCalledWith(2, localPlayer);

        cleanup();
        window.dispatchEvent(new Event('beforeunload'));
        expect(flushSync).toHaveBeenCalledTimes(2);
    });
});
