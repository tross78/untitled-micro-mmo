import * as audio from '../engine/audio.js';

// Mock AudioContext
const mockOscillator = {
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    type: '',
    frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }
};
const mockGain = {
    connect: jest.fn(),
    gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }
};
const mockAudioCtx = {
    currentTime: 0,
    createOscillator: jest.fn(() => mockOscillator),
    createGain: jest.fn(() => mockGain),
    destination: {},
    resume: jest.fn().mockResolvedValue(null),
    state: 'suspended'
};

global.AudioContext = jest.fn(() => mockAudioCtx);

describe('Audio System (Phase 7.5 Audit)', () => {
    test('sound functions attempt to initialize and play', () => {
        // Just verify they don't crash and call the expected APIs
        audio.playHit();
        expect(global.AudioContext).toHaveBeenCalled();
        expect(mockAudioCtx.createOscillator).toHaveBeenCalled();
    });

    test('multiple calls reuse the context', () => {
        audio.playHit();
        audio.playCrit();
        
        // Context should have been initialized exactly once 
        // (already called in the first test, should not be called again)
        expect(global.AudioContext).toHaveBeenCalledTimes(1);
    });
});
