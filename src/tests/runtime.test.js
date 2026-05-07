import { jest } from '@jest/globals';
import {
    getArbiterUrl,
    resolveBootstrapArbiterUrl,
    setResolvedArbiterUrl,
} from '../infra/runtime.js';
import { appRuntime } from '../app/runtime.js';

describe('runtime bootstrap resolution', () => {
    beforeEach(() => {
        localStorage.clear();
        setResolvedArbiterUrl('');
        jest.restoreAllMocks();
        global.fetch = jest.fn();
    });

    test('getArbiterUrl prefers stored resolved arbiter url', () => {
        setResolvedArbiterUrl('https://arbiter.tysonross.com');
        expect(getArbiterUrl('')).toBe('https://arbiter.tysonross.com');
    });

    test('resolveBootstrapArbiterUrl loads arbiter url from domain config', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ arbiterUrl: 'https://arbiter.tysonross.com' }),
        });

        const url = await resolveBootstrapArbiterUrl('tysonross.com');

        expect(global.fetch).toHaveBeenCalled();
        expect(url).toBe('https://arbiter.tysonross.com');
        expect(getArbiterUrl('')).toBe('https://arbiter.tysonross.com');
    });

    test('resolveBootstrapArbiterUrl ignores invalid config', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ nope: true }),
        });

        const url = await resolveBootstrapArbiterUrl('tysonross.com');

        expect(url).toBe('');
        expect(getArbiterUrl('fallback')).toBe('fallback');
    });
});

describe('viewport sizing on mobile layouts', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('updateViewport uses portrait sizing on narrow screens', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockImplementation((id) => (id === 'game-canvas' ? canvas : null));
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 });

        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();

        expect(appRuntime.VP.S).toBe(50);
        expect(appRuntime.VP.W).toBe(12);
        expect(appRuntime.VP.H).toBe(24);
        expect(canvas.width).toBe(appRuntime.VP.CW);
        expect(canvas.height).toBe(appRuntime.VP.CH);
    });

    test('updateViewport uses landscape sizing on wide screens', () => {
        const canvas = document.createElement('canvas');
        jest.spyOn(document, 'getElementById').mockImplementation((id) => (id === 'game-canvas' ? canvas : null));
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

        appRuntime.mapRender = null;
        appRuntime.entityRender = null;
        appRuntime.uiRender = null;
        appRuntime.updateViewport();

        expect(appRuntime.VP.S).toBe(46);
        expect(appRuntime.VP.W).toBe(26);
        expect(appRuntime.VP.H).toBe(13);
        expect(canvas.width).toBe(appRuntime.VP.CW);
        expect(canvas.height).toBe(appRuntime.VP.CH);
    });
});
