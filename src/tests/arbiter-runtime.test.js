import { createOptionalGistPublisher } from '../network/arbiter-gist-publisher.js';
import {
    installArbiterConsoleNoiseFilter,
    isNonfatalNetworkLog,
} from '../network/arbiter-log-filter.js';
import { buildArbiterRoomConfig } from '../network/arbiter-runtime-config.js';
import { buildTorrentConfig } from '../network/config.js';
import { ARBITER_ICE_SERVERS } from '../infra/constants.js';

describe('arbiter runtime hardening', () => {
    test('arbiter room config enables mDNS host fallback without changing browser room config', () => {
        const browserConfig = buildTorrentConfig({ iceServers: [] });
        const arbiterConfig = buildArbiterRoomConfig(browserConfig);

        expect(browserConfig._test_only_mdnsHostFallbackToLoopback).toBeUndefined();
        expect(arbiterConfig._test_only_mdnsHostFallbackToLoopback).toBe(true);
        expect(arbiterConfig.relayUrls).toBe(browserConfig.relayUrls);
    });

    test('arbiter ICE keeps UDP TURN fallback while excluding noisy TCP TURN', () => {
        const urls = ARBITER_ICE_SERVERS.flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]);

        expect(urls.some(url => String(url).startsWith('stun:'))).toBe(true);
        expect(urls.some(url => String(url).startsWith('turn:'))).toBe(true);
        expect(urls.some(url => String(url).includes('transport=tcp'))).toBe(false);
    });

    test('network log filter detects nested error details beyond the first console argument', () => {
        const err = new Error('getaddrinfo EAI_AGAIN api.github.com');
        err.code = 'EAI_AGAIN';
        err.hostname = 'api.github.com';

        expect(isNonfatalNetworkLog(['[Arbiter] Gist error:', err])).toBe(true);
    });

    test('console noise filter collapses library network stacks to one warning', () => {
        const originalError = jest.fn();
        const targetConsole = {
            error: originalError,
            warn: jest.fn(),
        };
        const restore = installArbiterConsoleNoiseFilter(targetConsole);
        const err = new Error('connect ECONNREFUSED 0.0.0.0:443');
        err.code = 'ECONNREFUSED';

        targetConsole.error('error', err);

        expect(originalError).not.toHaveBeenCalled();
        expect(targetConsole.warn).toHaveBeenCalledWith(
            '[Arbiter] Network noise (non-fatal):',
            expect.stringContaining('ECONNREFUSED')
        );
        restore();
    });

    test('gist publisher backs off after DNS failures instead of retrying every beacon', async () => {
        let now = 1000;
        const fetchImpl = jest.fn(() => {
            const err = new Error('getaddrinfo EAI_AGAIN api.github.com');
            err.code = 'EAI_AGAIN';
            throw err;
        });
        const log = { log: jest.fn(), warn: jest.fn() };
        const publisher = createOptionalGistPublisher({
            gistId: 'gist-id',
            token: 'token',
            fetchImpl,
            log,
            now: () => now,
            retryMs: 5000,
            maxRetryMs: 30000,
        });
        const packet = { state: { day: 1 }, signature: 'sig' };

        await publisher.publish(packet);
        await publisher.publish(packet);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 5s'));

        now += 5000;
        await publisher.publish(packet);

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(publisher.getStatus().failureCount).toBe(2);
    });
});
