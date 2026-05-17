// @ts-check

/**
 * Pluggable peer discovery layer.
 *
 * Current: GitHub Gist as public peer cache (updated by Arbiter monitoring script).
 * Fallback: WebTorrent tracker discovery (always available).
 *
 * To replace with VPS:
 * 1. Create discoverViaVPS() function
 * 2. Add to discoveryMethods with priority < 100
 * 3. No other code changes needed
 */

import { GH_GIST_ID, GH_GIST_USERNAME } from '../infra/constants.js';

/**
 * Discover peers via GitHub Gist peer cache.
 * The Gist is updated by an Arbiter monitoring script.
 * Returns: [{ id, ph }, ...]
 */
const discoverViaGist = async (shard) => {
    try {
        const url = `https://raw.githubusercontent.com/${GH_GIST_USERNAME}/${GH_GIST_ID}/raw/fenhollow-peers.json`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            console.log(`[peer-discovery] Gist returned HTTP ${res.status}`);
            return [];
        }

        let data;
        try {
            data = await res.json();
        } catch (_err) {
            console.log(`[peer-discovery] Gist returned invalid JSON`);
            return [];
        }

        if (!Array.isArray(data?.peers)) {
            console.log(`[peer-discovery] Gist peers is not an array`);
            return [];
        }

        const now = Date.now();
        const thirtySecondsAgo = now - 30_000;

        // Filter: same shard, valid data, online within last 30s
        const peers = data.peers
            .filter(p => p?.id && p?.ph && p?.shard === shard && p?.ts > thirtySecondsAgo)
            .map(p => ({ id: p.id, ph: p.ph, source: 'gist' }));

        if (peers.length > 0) {
            console.log(`[peer-discovery] Found ${peers.length} peers via Gist for shard ${shard}`);
        }

        return peers;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log(`[peer-discovery] Gist request timed out`);
        } else {
            console.log(`[peer-discovery] Gist discovery failed: ${err.message}`);
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
    return [];
};

/**
 * Future: VPS-based peer discovery.
 * To enable: uncomment in discoveryMethods below and implement discoverViaVPS.
 *
 * const discoverViaVPS = async (shard) => {
 *     const VPS_URL = process.env.FENHOLLOW_VPS_DISCOVERY || '';
 *     if (!VPS_URL) return [];
 *     try {
 *         const res = await fetch(`${VPS_URL}/peers?shard=${shard}`);
 *         if (!res.ok) return [];
 *         const { peers } = await res.json();
 *         return (peers || []).map(p => ({ id: p.id, ph: p.ph, source: 'vps' }));
 *     } catch (err) {
 *         console.log(`[peer-discovery] VPS failed: ${err.message}`);
 *         return [];
 *     }
 * };
 */

const discoveryMethods = [
    {
        name: 'gist',
        fn: (shard) => discoverViaGist(shard),
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
 * Tries discovery methods in priority order, returns first successful result.
 */
export const discoverPeers = async (shard) => {
    if (!shard) return [];

    const sortedMethods = [...discoveryMethods].sort((a, b) => a.priority - b.priority);
    const promises = sortedMethods.map(async (method) => {
        try {
            const result = await Promise.race([
                method.fn(shard),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), method.timeout)
                )
            ]);

            if (Array.isArray(result) && result.length > 0) {
                console.log(`[peer-discovery] ✓ ${method.name} succeeded with ${result.length} peers`);
                return result;
            }
            return null;
        } catch (err) {
            console.log(`[peer-discovery] ✗ ${method.name}: ${err.message}`);
            return null;
        }
    });

    for (const promise of promises) {
        const result = await promise;
        if (result?.length > 0) return result;
    }

    console.log(`[peer-discovery] All methods failed, falling back to native tracker discovery`);
    return [];
};
