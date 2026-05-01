import { jest } from '@jest/globals';
import {
    getArbiterUrl,
    resolveBootstrapArbiterUrl,
    setResolvedArbiterUrl,
} from './runtime.js';

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
