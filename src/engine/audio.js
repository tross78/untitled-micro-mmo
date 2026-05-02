/**
 * Hearthwick Web Audio System
 * Zero-dependency procedural sound effects and music.
 */

let audioCtx = null;
let currentBgm = null;
let bgmInterval = null;

function initAudio() {
    if (audioCtx || typeof window === 'undefined') return;
    try {
        audioCtx = new (window.AudioContext || (/** @type {any} */(window)).webkitAudioContext)();
    } catch {
        audioCtx = null;
        return;
    }
    // Resume context on user gesture
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

function playTone(freq, type, duration, volume, endFreq = null) {
    initAudio();
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (_e) { /* ignore */ }
}

function playNoise(duration, volume) {
    initAudio();
    if (!audioCtx) return;
    try {
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        noise.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start();
    } catch (_e) { /* ignore */ }
}

export function playHit() { 
    playTone(150, 'sawtooth', 0.1, 0.1); 
    playNoise(0.05, 0.05); // Noise layer
}

export function playCrit() { 
    playTone(300, 'sawtooth', 0.2, 0.15); 
    playNoise(0.1, 0.1);
}

export function playLevelUp() { 
    playTone(440, 'sine', 0.1, 0.1); 
    setTimeout(() => playTone(554, 'sine', 0.1, 0.1), 100);
    setTimeout(() => playTone(659, 'sine', 0.3, 0.1), 200);
}

export function playPickup() { playTone(880, 'sine', 0.05, 0.05); }
export function playPortal() { playTone(400, 'sine', 0.5, 0.1, 50); }
export function playDeath() { playTone(100, 'square', 0.5, 0.1, 10); }
export function playStep() { playNoise(0.03, 0.02); }

// --- BGM ARPEGGIATOR ---

const SCALES = {
    grass: [261.63, 329.63, 392.00, 523.25], // C Major
    dungeon: [196.00, 233.08, 293.66, 311.13], // G Minor
    town: [293.66, 369.99, 440.00, 587.33], // D Major
};

export function playBGM(zoneType) {
    initAudio();
    if (!audioCtx || currentBgm === zoneType) return;
    stopBGM();
    currentBgm = zoneType;
    const scale = SCALES[zoneType] || SCALES.grass;
    let step = 0;

    bgmInterval = setInterval(() => {
        if (audioCtx.state === 'suspended') return;
        const freq = scale[step % scale.length];
        playTone(freq, 'triangle', 0.4, 0.03);
        step++;
    }, 200);
}

export function stopBGM() {
    if (bgmInterval) clearInterval(bgmInterval);
    bgmInterval = null;
    currentBgm = null;
}
