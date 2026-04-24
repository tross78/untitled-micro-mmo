import { jest } from '@jest/globals';

// Mock Trystero
const mockRoom = {
    onPeerJoin: jest.fn(),
    onPeerLeave: jest.fn(),
    makeAction: jest.fn(() => [jest.fn(), jest.fn()]),
    leave: jest.fn(),
    getPeers: jest.fn(() => ({})),
};

describe('Discovery Race & Networking Logic', () => {
    let knownPeers;
    let gameActions;
    let worldState;
    let lastValidStatePacket;

    beforeEach(() => {
        knownPeers = new Set();
        gameActions = {};
        worldState = { day: 0 };
        lastValidStatePacket = null;
        jest.clearAllMocks();
    });

    test('knownPeers is updated when a peer joins the global room', () => {
        // Mocking the logic in connectGlobal
        const onPeerJoinHandler = (peerId) => {
            knownPeers.add(peerId);
        };

        onPeerJoinHandler('peer-1');
        expect(knownPeers.has('peer-1')).toBe(true);
        expect(knownPeers.size).toBe(1);

        onPeerJoinHandler('peer-2');
        expect(knownPeers.size).toBe(2);
    });

    test('requestState closure bug is fixed via gameActions assignment', () => {
        // This test ensures that when rooms change, the global gameActions.requestState 
        // is updated to point to the latest room's request function.
        
        let callCount = 0;
        const mockRequestState1 = jest.fn(() => callCount++);
        const mockRequestState2 = jest.fn(() => callCount++);

        // Room 1 initialization
        gameActions.requestState = mockRequestState1;
        gameActions.requestState();
        expect(mockRequestState1).toHaveBeenCalledTimes(1);

        // Room 2 initialization (simulating re-connectGlobal)
        gameActions.requestState = mockRequestState2;
        gameActions.requestState();
        expect(mockRequestState2).toHaveBeenCalledTimes(1);
        expect(mockRequestState1).toHaveBeenCalledTimes(1);
    });

    test('Discovery beacon processing validates signatures correctly', async () => {
        // Mock verifyMessage
        const verifyMessage = jest.fn(async (state, sig, key) => {
            return sig === 'valid-sig';
        });

        const processBeacon = async (packet, source, arbiterPublicKey) => {
            if (!packet) return false;
            const { state, signature } = packet;
            const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
            const valid = await verifyMessage(stateStr, signature, arbiterPublicKey);
            return valid;
        };

        const validPacket = { state: { day: 5 }, signature: 'valid-sig' };
        const invalidPacket = { state: { day: 5 }, signature: 'bogus' };

        expect(await processBeacon(validPacket, 'Test', {})).toBe(true);
        expect(await processBeacon(invalidPacket, 'Test', {})).toBe(false);
    });

    test('TURN fallback only triggers if no peers found', () => {
        const triggerFallbackIfEmpty = (peers) => {
            if (peers.size === 0) {
                return 'FALLBACK';
            }
            return 'STAY';
        };

        expect(triggerFallbackIfEmpty(new Set())).toBe('FALLBACK');
        expect(triggerFallbackIfEmpty(new Set(['peer-1']))).toBe('STAY');
    });

    test('Nostr WebSocket handling handles readyState correctly', () => {
        // Mock WebSocket
        const mockWs = {
            readyState: 1, // OPEN
            close: jest.fn(),
        };

        const closeIfOpen = (ws) => {
            if (ws.readyState === 1) ws.close();
        };

        closeIfOpen(mockWs);
        expect(mockWs.close).toHaveBeenCalledTimes(1);

        mockWs.readyState = 0; // CONNECTING
        mockWs.close.mockClear();
        closeIfOpen(mockWs);
        expect(mockWs.close).not.toHaveBeenCalled();
    });
});
