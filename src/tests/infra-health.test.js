import { jest } from '@jest/globals';

/**
 * Infrastructure Health Tests
 * Verifies that the system can distinguish between up and down trackers/relays.
 */

const probeWebSocket = async (url, timeout = 2000) => {
    return new Promise((resolve) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            if (ws.readyState !== 1) {
                ws.close();
                resolve(false);
            }
        }, timeout);

        ws.onopen = () => {
            clearTimeout(timer);
            ws.close();
            resolve(true);
        };

        ws.onerror = () => {
            clearTimeout(timer);
            ws.close();
            resolve(false);
        };
    });
};

describe('Infrastructure Health Probing', () => {
    let mockWs;
    
    beforeEach(() => {
        mockWs = {
            readyState: 0,
            close: jest.fn(),
            onopen: null,
            onerror: null,
        };
        global.WebSocket = jest.fn(() => mockWs);
    });

    test('Identifies a healthy node (onopen fires)', async () => {
        const probePromise = probeWebSocket('wss://healthy.com');
        
        // Simulate successful connection
        mockWs.readyState = 1;
        mockWs.onopen();

        const result = await probePromise;
        expect(result).toBe(true);
        expect(mockWs.close).toHaveBeenCalled();
    });

    test('Identifies a dead node (onerror fires)', async () => {
        const probePromise = probeWebSocket('wss://dead.com');
        
        // Simulate error
        mockWs.onerror();

        const result = await probePromise;
        expect(result).toBe(false);
    });

    test('Identifies a slow/hanging node (timeout)', async () => {
        jest.useFakeTimers();
        const probePromise = probeWebSocket('wss://slow.com', 1000);
        
        // Advance time past timeout
        jest.advanceTimersByTime(1500);

        const result = await probePromise;
        expect(result).toBe(false);
        expect(mockWs.close).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('Can prune a list of infrastructure nodes', async () => {
        const nodes = ['wss://up1.com', 'wss://down.com', 'wss://up2.com'];
        
        // Mock implementation that succeeds for 'up' nodes
        global.WebSocket = jest.fn((url) => {
            const ws = { ...mockWs };
            setTimeout(() => {
                if (url.includes('up')) ws.onopen();
                else ws.onerror();
            }, 10);
            return ws;
        });

        const results = await Promise.all(nodes.map(n => probeWebSocket(n)));
        const healthyNodes = nodes.filter((_, i) => results[i]);

        expect(healthyNodes).toContain('wss://up1.com');
        expect(healthyNodes).toContain('wss://up2.com');
        expect(healthyNodes).not.toContain('wss://down.com');
    });
});
