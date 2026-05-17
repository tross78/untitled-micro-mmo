// @ts-check
// VPS seam: replace this module with vps-signal.js when a real signaling server
// is available. Swap the 3 exports; callers in index.js don't change.
import { getArbiterUrl } from '../infra/runtime.js';
import { ARBITER_URL } from '../infra/constants.js';

const url = () => getArbiterUrl(ARBITER_URL);

/**
 * Register with the arbiter and return peer hints for the shard immediately.
 * @param {string} shard
 * @param {object} registration
 * @returns {Promise<Array<{id: string, ph: string}>>}
 */
export const registerWithHints = async (shard, registration) => {
    const base = url();
    if (!base) return [];
    try {
        const res = await fetch(`${base}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registration),
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.peers) ? data.peers : [];
    } catch { return []; }
};

/**
 * Drop a signal payload into a peer's mailbox on the arbiter.
 * @param {string} toPeerId
 * @param {string} fromPeerId
 * @param {unknown} payload
 */
export const sendSignal = async (toPeerId, fromPeerId, payload) => {
    const base = url();
    if (!base) return;
    try {
        await fetch(`${base}/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toPeerId, fromPeerId, payload }),
            signal: AbortSignal.timeout(2000),
        });
    } catch { /* ignore */ }
};

/**
 * Drain pending signals for myPeerId from the arbiter mailbox.
 * On VPS, replace with a WebSocket subscription: ws.onmessage = (e) => onSignal(JSON.parse(e.data))
 * @param {string} myPeerId
 * @param {(signal: {fromPeerId: string, payload: unknown}) => void} onSignal
 */
export const pollSignals = async (myPeerId, onSignal) => {
    const base = url();
    if (!base) return;
    try {
        const res = await fetch(`${base}/signal/${encodeURIComponent(myPeerId)}`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return;
        const signals = await res.json();
        if (Array.isArray(signals)) signals.forEach(s => onSignal(s));
    } catch { /* ignore */ }
};
