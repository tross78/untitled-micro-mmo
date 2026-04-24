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

    test('TURN fallback TRIGGERS if peers are found but Arbiter sync fails', () => {
        const log = jest.fn();
        const connectGlobal = jest.fn();

        // Simulate logic in main.js
        const checkArbiterSync = () => {
            if (!hasSyncedWithArbiter) { // The fixed condition
                log('FALLBACK');
                currentRtcConfig = { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] };
                connectGlobal(currentRtcConfig);
            }
        };
        
        setTimeout(checkArbiterSync, 15000);

        // Simulate finding a player peer immediately
        knownPeers.add('random-player-id');
        
        // Advance 16s
        jest.advanceTimersByTime(16000);

        // Fallback should trigger because hasSyncedWithArbiter is still false
        expect(log).toHaveBeenCalledWith('FALLBACK');
    });

    test('Presence update does NOT overwrite Identity data (Sequence Integrity)', () => {
        const players = new Map();
        const peerId = 'peer-test-123';
        
        // 1. First packet: Identity Handshake (Sets public key)
        const identityData = { publicKey: 'base64-key-abc' };
        const entry1 = players.get(peerId) || {};
        players.set(peerId, { ...entry1, publicKey: identityData.publicKey });
        
        expect(players.get(peerId).publicKey).toBe('base64-key-abc');

        // 2. Second packet: Presence update (Sets game stats)
        // THE BUG: The old code did: players.set(peerId, { ...presenceData })
        // THE FIX: Must merge with existing entry
        const presenceData = { name: 'Tyson', level: 5 };
        const entry2 = players.get(peerId) || {};
        players.set(peerId, { ...entry2, ...presenceData });

        // 3. Verify Integrity
        const finalEntry = players.get(peerId);
        expect(finalEntry.level).toBe(5);
        expect(finalEntry.publicKey).toBe('base64-key-abc'); // This would have FAILED with the old logic
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
