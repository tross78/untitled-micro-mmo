// @ts-check
// Arbiter HTTP presence registration. This returns peer-id hints only; it does
// not perform WebRTC signaling.
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
