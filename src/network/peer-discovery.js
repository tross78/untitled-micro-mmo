// @ts-check

/**
 * Pluggable peer discovery layer.
 *
 * Current: Arbiter-based peer registry (auto-register on join).
 * Fallback: WebTorrent tracker discovery (always available).
 *
 * To replace with VPS:
 * 1. Create discoverViaVPS() function
 * 2. Add to discoveryMethods with priority < 100
 * 3. Implement registerInPeerCache to post to VPS instead of Arbiter
 */

import { getArbiterUrl } from '../infra/runtime.js';

/**
 * Discover peers via Arbiter peer registry.
 * Returns: [{ id, ph }, ...]
 */
const discoverViaArbiter = async (shard) => {
    const arbiterUrl = getArbiterUrl();
    if (!arbiterUrl) {
        console.log(`[peer-discovery] No Arbiter URL configured`);
        return [];
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`${arbiterUrl}/peers?shard=${encodeURIComponent(shard)}`, {
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            console.log(`[peer-discovery] Arbiter returned HTTP ${res.status}`);
            return [];
        }

        const data = await res.json();
        if (!Array.isArray(data)) {
            console.warn(`[peer-discovery] Arbiter /peers returned non-array`);
            return [];
        }

        const peers = data
            .filter(p => p?.id && p?.ph)
            .map(p => ({ id: p.id, ph: p.ph, source: 'arbiter' }));

        if (peers.length > 0) {
            console.log(`[peer-discovery] Found ${peers.length} peers via Arbiter for shard ${shard}`);
        }

        return peers;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log(`[peer-discovery] Arbiter request timed out`);
        } else {
            console.log(`[peer-discovery] Arbiter discovery failed: ${err.message}`);
        }
        return [];
    }
};

/**
 * Discover peers via WebTorrent trackers (fallback).
 * This is already handled by Trystero's joinRoom(), but we expose it here
 * so it can be called explicitly if other methods fail.
 * Returns: [] (discovery happens asynchronously via Trystero)
 */
const discoverViaWebTorrent = async () => {
    console.log(`[peer-discovery] Falling back to WebTorrent tracker discovery`);
    // WebTorrent discovery is handled automatically by Trystero.joinRoom()
    // We just return empty here to signal "use Trystero's native flow"
    return [];
};

/**
 * Future: VPS-based peer discovery (to replace Arbiter).
 * To enable: uncomment in discoveryMethods below and implement discoverViaVPS.
 *
 * const discoverViaVPS = async (shard) => {
 *     const VPS_URL = process.env.FENHOLLOW_VPS_DISCOVERY || '';
 *     if (!VPS_URL) return [];
 *     try {
 *         const res = await fetch(`${VPS_URL}/peers?shard=${shard}`);
 *         if (!res.ok) return [];
 *         const { peers } = await res.json();
 *         return (peers || []).map(p => ({ id: p.peerId, publicKey: p.publicKey, source: 'vps' }));
 *     } catch (err) {
 *         console.log(`[peer-discovery] VPS discovery failed: ${err.message}`);
 *         return [];
 *     }
 * };
 */

const discoveryMethods = [
    {
        name: 'arbiter',
        fn: (shard) => discoverViaArbiter(shard),
        timeout: 2000,
        priority: 1  // Try first
    },
    {
        name: 'webtorrent',
        fn: () => discoverViaWebTorrent(),
        timeout: 1000,
        priority: 100  // Fallback
    },
];

/**
 * Discover peers for a given shard.
 *
 * Strategy:
 * 1. Try all discovery methods in priority order (parallel)
 * 2. Return first non-empty result
 * 3. If all fail, return empty (Trystero will use its native tracker discovery)
 *
 * Robustness guarantees:
 * - Each method has a timeout (won't hang)
 * - Errors in one method don't block others
 * - Returns [] on total failure (safe fallback)
 * - All peer data is validated before use
 */
export const discoverPeers = async (shard) => {
    if (!shard) {
        console.warn(`[peer-discovery] No shard specified`);
        return [];
    }

    const sortedMethods = [...discoveryMethods].sort((a, b) => a.priority - b.priority);

    // Race all methods with timeout
    const promises = sortedMethods.map(async (method) => {
        try {
            const result = await Promise.race([
                method.fn(shard),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), method.timeout)
                )
            ]);

            // Validate result is an array of peers
            if (!Array.isArray(result)) {
                console.warn(`[peer-discovery] ${method.name} returned non-array: ${typeof result}`);
                return null;
            }

            if (result.length > 0) {
                console.log(`[peer-discovery] ✓ ${method.name} succeeded with ${result.length} peers`);
                return result;
            }

            return null;
        } catch (err) {
            console.log(`[peer-discovery] ✗ ${method.name}: ${err.message}`);
            return null;
        }
    });

    // Return first successful result
    for (const promise of promises) {
        const result = await promise;
        if (result?.length > 0) {
            return result;
        }
    }

    console.log(`[peer-discovery] All methods failed, falling back to native tracker discovery`);
    return [];
};

/**
 * Register this peer in the Arbiter peer registry.
 * Call this after joining a shard so other peers can discover you.
 *
 * Future: replace Arbiter with VPS endpoint by changing the URL.
 */
export const registerInPeerCache = async (peerId, shard, _publicKey) => {
    const arbiterUrl = getArbiterUrl();
    if (!arbiterUrl) {
        console.log(`[peer-discovery] No Arbiter URL, skipping peer registration`);
        return;
    }

    try {
        // Generate ph (8-char hex hash) from peerId for presence tracking
        const hash = peerId
            .split('')
            .reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0);
        const ph = (Math.abs(hash) >>> 0).toString(16).padStart(8, '0').slice(0, 8);

        const payload = {
            id: peerId,
            ph,
            shard,
            name: 'Player',
            location: shard,  // Presence cache requires this
            level: 1,
            ts: Date.now(),
            x: 5,
            y: 5
        };

        const res = await fetch(`${arbiterUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.log(`[peer-discovery] Arbiter registration failed: HTTP ${res.status}`);
            return;
        }

        console.log(`[peer-discovery] ✓ Registered with Arbiter for shard ${shard}`);
    } catch (err) {
        console.log(`[peer-discovery] Arbiter registration error: ${err.message}`);
    }
};
