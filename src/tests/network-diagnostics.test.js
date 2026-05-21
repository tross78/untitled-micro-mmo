import {
    candidateTypeFromString,
    installNetworkDiagnostics,
    probeIceGathering,
    probeTrackerWebSocket,
    setNetworkDiagnosticContextProvider,
} from '../network/diagnostics.js';

describe('network diagnostics', () => {
    const originalWebSocket = global.WebSocket;
    const originalRtc = global.RTCPeerConnection;

    afterEach(() => {
        Object.defineProperty(global, 'WebSocket', {
            configurable: true,
            value: originalWebSocket,
        });
        Object.defineProperty(global, 'RTCPeerConnection', {
            configurable: true,
            value: originalRtc,
        });
        setNetworkDiagnosticContextProvider(null);
        delete window.__fenhollowNetDiag;
        delete window.__fenhollowNetSnapshot;
    });

    test('extracts ICE candidate type from SDP candidate strings', () => {
        expect(candidateTypeFromString('candidate:1 1 udp 1 10.0.0.2 555 typ host')).toBe('host');
        expect(candidateTypeFromString('candidate:2 1 udp 1 1.2.3.4 444 typ srflx')).toBe('srflx');
        expect(candidateTypeFromString('candidate:3 1 udp 1 5.6.7.8 333 typ relay')).toBe('relay');
        expect(candidateTypeFromString('')).toBe('unknown');
    });

    test('tracker probe reports open WebSocket connections', async () => {
        class MockWebSocket {
            constructor(url) {
                this.url = url;
                setTimeout(() => this.onopen?.(), 0);
            }
            close() {
                this.closed = true;
            }
        }
        Object.defineProperty(global, 'WebSocket', {
            configurable: true,
            value: MockWebSocket,
        });

        const result = await probeTrackerWebSocket('wss://tracker.example', 100);

        expect(result).toMatchObject({
            url: 'wss://tracker.example',
            status: 'open',
        });
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    test('ICE probe reports unsupported when RTCPeerConnection is unavailable', async () => {
        Object.defineProperty(global, 'RTCPeerConnection', {
            configurable: true,
            value: undefined,
        });

        await expect(probeIceGathering(10)).resolves.toMatchObject({
            status: 'unsupported',
            candidateCount: 0,
            candidatesByType: {},
        });
    });

    test('window diagnostic snapshot includes provided runtime context', () => {
        setNetworkDiagnosticContextProvider(() => ({ globalPeers: 0, shardPeers: 0, synced: true }));
        installNetworkDiagnostics();

        expect(window.__fenhollowNetSnapshot()).toMatchObject({
            current: { globalPeers: 0, shardPeers: 0, synced: true },
            peerConnections: [],
        });
        expect(typeof window.__fenhollowNetDiag).toBe('function');
    });
});
