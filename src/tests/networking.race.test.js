import { jest } from '@jest/globals';

// Mock transport to control the timing of joinRoom
jest.mock('../network/transport.js', () => ({
    joinRoom: jest.fn(() => ({
        makeAction: jest.fn((name) => [jest.fn(), jest.fn()]),
        getPeers: jest.fn(() => ({})),
        leave: jest.fn(),
        onPeerJoin: jest.fn(),
        onPeerLeave: jest.fn(),
    })),
    selfId: 'race-peer-id',
}));

import { initNetworking, gameActions } from '../networking.js';
import { localPlayer } from '../store.js';
import { joinRoom } from '../network/transport.js';

describe('Networking Race Condition Simulation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localPlayer.ph = null; // Ensure we start uninitialized
    });

    test('sendMove is blocked when ph is null (simulated startup gap)', async () => {
        // 1. Setup the mock action
        const mockSendMove = jest.fn();
        const mockTorrent = joinRoom();
        mockTorrent.makeAction.mockImplementation((name) => {
            if (name === 'move') return [mockSendMove, jest.fn()];
            return [jest.fn(), jest.fn()];
        });

        // 2. Initialize networking (simulates the app starting up)
        await initNetworking();

        // 3. Trigger a move action BEFORE ph is set
        // In the real bug, this happened because heartbeat or UI events fired 
        // during the WebCrypto promise window.
        await gameActions.sendMove({ from: 'cellar', to: 'hallway', x: 5, y: 5 });

        // 4. Verify the lockdown: Nothing should have been broadcast
        expect(mockSendMove).not.toHaveBeenCalled();
    });

    test('sendPresenceSingle is blocked when ph is null', async () => {
        const mockSendPresence = jest.fn();
        const mockTorrent = joinRoom();
        mockTorrent.plumSend = mockSendPresence; // Presence uses plumSend (gossip)
        
        await initNetworking();
        
        // Attempt to send presence while uninitialized
        gameActions.sendPresenceSingle({ name: 'Race' });
        
        // Should not call plumSend
        expect(mockSendPresence).not.toHaveBeenCalled();
    });

    test('ghost-to-live promotion: trackPlayer clears ghost flag on real identity receipt', () => {
        const peerId = 'promoted-peer';
        const ph = 'abcdef12';
        
        // 1. Seed as a ghost
        localPlayer.ph = 'self-ph'; // Avoid self-ghost filtering
        const { trackPlayer, players } = require('../store.js');
        trackPlayer(peerId, { name: 'Alice', ph, location: 'cellar', ghost: true });
        expect(players.get(peerId).ghost).toBe(true);
        
        // 2. Receive real P2P data (identity handshake)
        // trackPlayer should be called without ghost: true
        trackPlayer(peerId, { name: 'Alice', ph, location: 'cellar', publicKey: 'real-key' });
        
        // 3. Verify ghost flag is now false
        expect(players.get(peerId).ghost).toBe(false);
    });
});
