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
    gain: {
        value: 0,
        cancelScheduledValues: jest.fn(),
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
    }
};
const mockBufferSource = {
    connect: jest.fn(),
    start: jest.fn(),
};
const mockFilter = {
    connect: jest.fn(),
    type: 'lowpass',
    frequency: { value: 0 },
};
const mockAudioCtx = {
    currentTime: 0,
    createOscillator: jest.fn(() => mockOscillator),
    createGain: jest.fn(() => mockGain),
    createBufferSource: jest.fn(() => mockBufferSource),
    createBiquadFilter: jest.fn(() => mockFilter),
    createBuffer: jest.fn(() => ({
        getChannelData: jest.fn(() => new Float32Array(32)),
    })),
    sampleRate: 44100,
    destination: {},
    resume: jest.fn().mockResolvedValue(null),
    state: 'suspended'
};

global.AudioContext = jest.fn(() => mockAudioCtx);

describe('Audio System (Phase 7.5 Audit)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

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

    test('audio settings can be toggled and persisted', () => {
        const start = audio.getAudioSettings();
        expect(start.muted).toBe(false);

        const muted = audio.toggleAudioMute();
        expect(muted.muted).toBe(true);

        const changed = audio.stepAudioVolume('music', 0.2);
        expect(changed.music).toBeGreaterThanOrEqual(start.music);
        expect(JSON.parse(localStorage.getItem('fenhollow_audio_settings_v1')).muted).toBe(true);
    });
});
