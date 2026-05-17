// @ts-check

/**
 * Pluggable peer discovery layer.
 *
 * Design: Try multiple discovery methods in parallel with timeout.
 * Gracefully degrade if any method fails. Always falls back to WebTorrent.
 *
 * To plug in a VPS later:
 * 1. Create src/network/discovery/vps.js with discoverViaVPS()
 * 2. Add to discoveryMethods array below
 * 3. No other code changes needed
 */

import { GH_GIST_ID, GH_GIST_USERNAME } from '../infra/constants.js';

// Validate peer object shape before using
const isValidPeer = (peer) => {
    return peer
        && typeof peer === 'object'
        && typeof peer.peerId === 'string'
        && typeof peer.publicKey === 'string'
        && typeof peer.shard === 'string'
        && typeof peer.ts === 'number'
        && peer.peerId.length > 0
        && peer.publicKey.length > 0;
};

/**
 * Discover peers via GitHub Gist peer cache.
 * Returns: [{ peerId, publicKey }, ...]
 * Robustness: validates data, filters stale peers, handles network errors gracefully.
 */
const discoverViaPeerCache = async (shard) => {
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
            console.warn(`[peer-discovery] Gist returned HTTP ${res.status}`);
            return [];
        }

        let data;
        try {
            data = await res.json();
        } catch (err) {
            console.warn(`[peer-discovery] Gist returned invalid JSON: ${err.message}`);
            return [];
        }

        if (!Array.isArray(data?.peers)) {
            console.warn(`[peer-discovery] Gist peers is not an array`);
            return [];
        }

        const now = Date.now();
        const thirtySecondsAgo = now - 30_000;

        // Filter: same shard, valid data, online within last 30s
        const validPeers = data.peers.filter(p => {
            if (!isValidPeer(p)) {
                console.warn(`[peer-discovery] Invalid peer data: ${JSON.stringify(p)}`);
                return false;
            }
            if (p.shard !== shard) return false;
            if (p.ts < thirtySecondsAgo) {
                // Peer is stale, probably offline
                return false;
            }
            return true;
        });

        if (validPeers.length > 0) {
            console.log(`[peer-discovery] Found ${validPeers.length} peers via Gist for shard ${shard}`);
        }

        // Return safe subset (peerId, publicKey only)
        return validPeers.map(p => ({
            id: p.peerId,
            publicKey: p.publicKey,
            source: 'gist'
        }));

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
    // WebTorrent discovery is handled automatically by Trystero.joinRoom()
    // We just return empty here to signal "use Trystero's native flow"
    return [];
};

/**
 * Future: VPS-based peer discovery.
 * To enable: uncomment in discoveryMethods below.
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
        name: 'peer-cache',
        fn: (shard) => discoverViaPeerCache(shard),
        timeout: 2500,
        priority: 1  // Try first
    },
    // {
    //     name: 'vps',
    //     fn: (shard) => discoverViaVPS(shard),
    //     timeout: 2500,
    //     priority: 0.5  // Try before WebTorrent if enabled
    // },
    {
        name: 'webtorrent',
        fn: () => discoverViaWebTorrent(),
        timeout: 1000,
        priority: 100  // Always available, lowest priority
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
 * Register this peer in the peer cache (Gist).
 * Call this after joining a shard.
 *
 * Future: when you have a VPS, this becomes:
 *   POST ${VPS_URL}/register { peerId, shard, publicKey }
 *
 * For now: manual Gist management (can be automated via GitHub Actions + Gist API)
 */
export const registerInPeerCache = async (peerId, shard, _publicKey) => {
    // TODO: Implement Gist write (requires GitHub token)
    // For now, peers are registered manually or via monitoring script
    console.log(`[peer-discovery] TODO: Register ${peerId} in shard ${shard}`);
};
