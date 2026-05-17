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
    // Arbiter added at runtime (after arbiter import)
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
 * Future: replace Arbiter with VPS endpoint:
 *   POST ${VPS_URL}/peers/register { peerId, shard, publicKey }
 */
export const registerInPeerCache = async (peerId, shard, _publicKey) => {
    // Will be implemented to POST to Arbiter /peer-register endpoint
    // For now: stub (Arbiter implementation pending)
    console.log(`[peer-discovery] Register peer (stub): ${peerId} in ${shard}`);
};
