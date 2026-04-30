/**
 * Hearthwick Web Audio System
 * Zero-dependency procedural sound effects.
 */

let audioCtx = null;

function initAudio() {
    if (audioCtx || typeof window === 'undefined') return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        audioCtx = null;
        return;
    }
    // Resume context on user gesture if needed
    if (audioCtx.state === 'suspended') {
        const resume = () => {
            audioCtx.resume();
            window.removeEventListener('keydown', resume);
            window.removeEventListener('click', resume);
        };
        window.addEventListener('keydown', resume);
        window.addEventListener('click', resume);
    }
}

function playTone(freq, type, duration, volume, endFreq = null) {
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
    } catch (e) { console.warn('[Audio] Playback failed:', e); }
}

export function playHit() { initAudio(); playTone(150, 'sawtooth', 0.1, 0.1); }
export function playCrit() { initAudio(); playTone(300, 'sawtooth', 0.2, 0.15); }
export function playLevelUp() { 
    initAudio(); 
    playTone(440, 'sine', 0.1, 0.1); 
    setTimeout(() => playTone(554, 'sine', 0.1, 0.1), 100);
    setTimeout(() => playTone(659, 'sine', 0.3, 0.1), 200);
}
export function playPickup() { initAudio(); playTone(880, 'sine', 0.05, 0.05); }
export function playPortal() { initAudio(); playTone(400, 'sine', 0.5, 0.1, 50); }
export function playDeath() { initAudio(); playTone(100, 'square', 0.5, 0.1, 10); }
