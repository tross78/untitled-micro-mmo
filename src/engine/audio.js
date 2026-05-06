/**
 * Hearthwick Web Audio System
 * Lightweight procedural music and feedback tuned for the friend-demo slice.
 */

const AUDIO_SETTINGS_KEY = 'hearthwick_audio_settings_v1';
const DEFAULT_AUDIO_SETTINGS = Object.freeze({
    muted: false,
    music: 0.5,
    sfx: 0.7,
});

let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let currentBgm = null;
let bgmInterval = null;
let bgmStep = 0;
let cachedSettings = null;

const clamp01 = (value) => Math.max(0, Math.min(1, Math.round(value * 100) / 100));

const readStoredSettings = () => {
    if (cachedSettings) return { ...cachedSettings };
    if (typeof localStorage === 'undefined') {
        cachedSettings = { ...DEFAULT_AUDIO_SETTINGS };
        return { ...cachedSettings };
    }
    try {
        const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
        if (!raw) {
            cachedSettings = { ...DEFAULT_AUDIO_SETTINGS };
            return { ...cachedSettings };
        }
        const parsed = JSON.parse(raw);
        cachedSettings = {
            muted: !!parsed.muted,
            music: clamp01(typeof parsed.music === 'number' ? parsed.music : DEFAULT_AUDIO_SETTINGS.music),
            sfx: clamp01(typeof parsed.sfx === 'number' ? parsed.sfx : DEFAULT_AUDIO_SETTINGS.sfx),
        };
    } catch {
        cachedSettings = { ...DEFAULT_AUDIO_SETTINGS };
    }
    return { ...cachedSettings };
};

const persistSettings = () => {
    if (typeof localStorage === 'undefined' || !cachedSettings) return;
    try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(cachedSettings));
    } catch (_e) {
        // Ignore storage failures in constrained environments.
    }
};

export function getAudioSettings() {
    return readStoredSettings();
}

function ensureSettings() {
    if (!cachedSettings) cachedSettings = readStoredSettings();
    return cachedSettings;
}

function applySettings() {
    if (!masterGain || !musicGain || !sfxGain) return;
    const settings = ensureSettings();
    masterGain.gain.value = settings.muted ? 0 : 1;
    musicGain.gain.value = settings.music;
    sfxGain.gain.value = settings.sfx;
}

function initAudio() {
    if (audioCtx || typeof window === 'undefined') return;
    try {
        audioCtx = new (window.AudioContext || (/** @type {any} */(window)).webkitAudioContext)();
        masterGain = audioCtx.createGain();
        musicGain = audioCtx.createGain();
        sfxGain = audioCtx.createGain();
        musicGain.connect(masterGain);
        sfxGain.connect(masterGain);
        masterGain.connect(audioCtx.destination);
        applySettings();
    } catch {
        audioCtx = null;
        masterGain = null;
        musicGain = null;
        sfxGain = null;
        return;
    }

    if (audioCtx.state === 'suspended') {
        const resume = () => {
            audioCtx.resume();
            window.removeEventListener('keydown', resume);
            window.removeEventListener('click', resume);
            window.removeEventListener('touchstart', resume);
        };
        window.addEventListener('keydown', resume);
        window.addEventListener('click', resume);
        window.addEventListener('touchstart', resume);
    }
}

function makeEnvelope(targetGain, startTime, attack, release, peak) {
    targetGain.gain.cancelScheduledValues(startTime);
    targetGain.gain.setValueAtTime(0.0001, startTime);
    targetGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), startTime + attack);
    targetGain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + release);
}

function playTone(freq, type, duration, volume, endFreq = null, bus = 'sfx', attack = 0.01) {
    initAudio();
    if (!audioCtx || !musicGain || !sfxGain) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const output = bus === 'music' ? musicGain : sfxGain;
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        if (endFreq) {
            osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);
        }
        makeEnvelope(gain, audioCtx.currentTime, attack, duration, volume);
        osc.connect(gain);
        gain.connect(output);
        osc.start();
        osc.stop(audioCtx.currentTime + attack + duration + 0.02);
    } catch (_e) {
        // Ignore unsupported audio edge cases.
    }
}

function playNoise(duration, volume, tone = 'bright') {
    initAudio();
    if (!audioCtx || !sfxGain) return;
    try {
        const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            const base = Math.random() * 2 - 1;
            data[i] = tone === 'soft' ? base * 0.35 : tone === 'dark' ? base * 0.55 : base;
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = tone === 'dark' ? 'lowpass' : 'highpass';
        filter.frequency.value = tone === 'dark' ? 900 : tone === 'soft' ? 700 : 1500;

        const gain = audioCtx.createGain();
        makeEnvelope(gain, audioCtx.currentTime, 0.005, duration, volume);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(sfxGain);
        noise.start();
    } catch (_e) {
        // Ignore unsupported audio edge cases.
    }
}

export function toggleAudioMute() {
    const settings = ensureSettings();
    settings.muted = !settings.muted;
    persistSettings();
    applySettings();
    return { ...settings };
}

export function stepAudioVolume(field, delta) {
    if (!['music', 'sfx'].includes(field)) return getAudioSettings();
    const settings = ensureSettings();
    settings[field] = clamp01(settings[field] + delta);
    persistSettings();
    applySettings();
    return { ...settings };
}

export function playHit() {
    playTone(180, 'square', 0.08, 0.09, 130, 'sfx', 0.002);
    playTone(96, 'triangle', 0.1, 0.05, null, 'sfx', 0.003);
    playNoise(0.04, 0.035, 'dark');
}

export function playCrit() {
    playTone(220, 'sawtooth', 0.1, 0.12, 330, 'sfx', 0.002);
    playTone(440, 'triangle', 0.15, 0.06, 660, 'sfx', 0.01);
    playNoise(0.06, 0.05, 'bright');
}

export function playLevelUp() {
    [392, 523.25, 659.25, 783.99].forEach((freq, index) => {
        setTimeout(() => playTone(freq, 'triangle', 0.14, 0.08, null, 'sfx', 0.01), index * 90);
    });
}

export function playPickup() {
    playTone(740, 'sine', 0.08, 0.055, 988, 'sfx', 0.003);
}

export function playPortal() {
    playTone(320, 'triangle', 0.45, 0.06, 96, 'sfx', 0.01);
    playTone(640, 'sine', 0.35, 0.025, 220, 'sfx', 0.03);
}

export function playDeath() {
    playTone(140, 'square', 0.45, 0.09, 42, 'sfx', 0.005);
    playNoise(0.2, 0.03, 'dark');
}

export function playStep() {
    playNoise(0.025, 0.012, 'soft');
    playTone(120, 'triangle', 0.03, 0.012, 90, 'sfx', 0.002);
}

const BGM_PATTERNS = {
    grass: {
        pulseMs: 380,
        bass: [130.81, null, 146.83, null, 164.81, null, 146.83, null],
        lead: [261.63, 329.63, 392.0, 329.63, 349.23, 392.0, 329.63, 293.66],
    },
    town: {
        pulseMs: 320,
        bass: [146.83, null, 146.83, null, 196.0, null, 164.81, null],
        lead: [293.66, 369.99, 440.0, 493.88, 440.0, 369.99, 329.63, 369.99],
    },
    dungeon: {
        pulseMs: 430,
        bass: [98.0, null, 92.5, null, 87.31, null, 82.41, null],
        lead: [196.0, 233.08, 246.94, 233.08, 174.61, 196.0, 233.08, 174.61],
    },
};

function scheduleBgmStep() {
    if (!audioCtx || audioCtx.state === 'suspended' || !currentBgm) return;
    const pattern = BGM_PATTERNS[currentBgm] || BGM_PATTERNS.grass;
    const bassNote = pattern.bass[bgmStep % pattern.bass.length];
    const leadNote = pattern.lead[bgmStep % pattern.lead.length];

    if (bassNote) {
        playTone(bassNote, 'triangle', 0.22, 0.025, null, 'music', 0.01);
    }
    if (leadNote) {
        playTone(leadNote, 'sine', 0.16, 0.02, null, 'music', 0.01);
        if (bgmStep % 2 === 1) {
            playTone(leadNote * 0.5, 'triangle', 0.12, 0.012, null, 'music', 0.01);
        }
    }
    bgmStep++;
}

export function playBGM(zoneType) {
    initAudio();
    if (!audioCtx || currentBgm === zoneType) return;
    stopBGM();
    currentBgm = zoneType;
    bgmStep = 0;
    scheduleBgmStep();
    const pulseMs = (BGM_PATTERNS[zoneType] || BGM_PATTERNS.grass).pulseMs;
    bgmInterval = setInterval(scheduleBgmStep, pulseMs);
}

export function stopBGM() {
    if (bgmInterval) clearInterval(bgmInterval);
    bgmInterval = null;
    currentBgm = null;
}
