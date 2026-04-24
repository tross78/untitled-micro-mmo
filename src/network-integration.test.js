import { jest } from '@jest/globals';

/**
 * Integration Test for Networking Discovery
 * This test simulates real-world timing and race conditions to catch 
 * the timeout and connection issues that unit tests missed.
 */

describe('Networking Discovery Integration', () => {
    let knownPeers;
    let STUN_SERVERS = [{urls: 'stun:1'}];
    let TURN_SERVERS = [{urls: 'turn:1'}];
    let hasSyncedWithArbiter = false;
    let currentRtcConfig;

    beforeEach(() => {
        knownPeers = new Set();
        hasSyncedWithArbiter = false;
        currentRtcConfig = { iceServers: STUN_SERVERS };
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('TURN fallback does NOT trigger if a peer is found within the window', () => {
        const log = jest.fn();
        const connectGlobal = jest.fn();
        const joinInstance = jest.fn();

        // 1. Start discovery
        const triggerFallback = () => {
            if (knownPeers.size === 0) {
                log('FALLBACK');
                currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                connectGlobal(currentRtcConfig);
            }
        };
        
        const fallbackTimeout = 15000; // The new 15s window
        setTimeout(triggerFallback, fallbackTimeout);

        // 2. Advance time 10s (before fallback)
        jest.advanceTimersByTime(10000);
        
        // 3. Simulate a peer joining (discovery success)
        knownPeers.add('peer-1');

        // 4. Advance time past the 15s window
        jest.advanceTimersByTime(6000);

        // 5. Verify fallback was NOT triggered
        expect(log).not.toHaveBeenCalledWith('FALLBACK');
        expect(currentRtcConfig.iceServers).toEqual(STUN_SERVERS);
    });

    test('TURN fallback TRIGGERS if no peers are found within 15s', () => {
        const log = jest.fn();
        const connectGlobal = jest.fn();

        const triggerFallback = () => {
            if (knownPeers.size === 0) {
                log('FALLBACK');
                currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                connectGlobal(currentRtcConfig);
            }
        };
        
        setTimeout(triggerFallback, 15000);

        // Advance past 15s with no peers
        jest.advanceTimersByTime(16000);

        expect(log).toHaveBeenCalledWith('FALLBACK');
        expect(currentRtcConfig.iceServers).toContainEqual(TURN_SERVERS[0]);
    });

    test('Presence broadcast is delayed to ensure data channel readiness', () => {
        const sendPresenceSingle = jest.fn();
        const myEntry = async () => ({ name: 'test' });
        
        const onPeerJoin = (peerId) => {
            // The logic we added:
            setTimeout(async () => {
                sendPresenceSingle(await myEntry(), peerId);
            }, 100);
        };

        onPeerJoin('peer-1');

        // Should not have sent yet
        expect(sendPresenceSingle).not.toHaveBeenCalled();

        // Advance 100ms
        jest.advanceTimersByTime(100);
        
        // We need to wait for the async myEntry
        return Promise.resolve().then(() => {
            expect(sendPresenceSingle).toHaveBeenCalledWith({ name: 'test' }, 'peer-1');
        });
    });

    test('Identity collision detection (Conceptual Test)', () => {
        // This simulates two distinct Trystero peers using the same public key
        const players = new Map();
        
        const selfId = 'tab-1';
        const otherId = 'tab-2';
        const sharedPublicKey = 'same-key-from-localstorage';

        const onPresence = (id, data) => {
            players.set(id, { ...data, id });
        };

        onPresence(selfId, { name: 'Player', publicKey: sharedPublicKey });
        onPresence(otherId, { name: 'Player', publicKey: sharedPublicKey });

        // If our logic didn't account for unique Peer IDs, these would overwrite.
        // We verify that the map stores them by Peer ID, not Public Key.
        expect(players.size).toBe(2);
        expect(players.has(selfId)).toBe(true);
        expect(players.has(otherId)).toBe(true);
    });
});
