/**
 * Peer Discovery Monitor for Arbiter
 *
 * Periodically updates GitHub Gist with active peers from the presence directory.
 * This allows the public frontend to discover peers via Gist without needing
 * access to the private Arbiter (which runs on Tailscale).
 *
 * Requires GH_GIST_TOKEN and GH_GIST_ID in environment.
 */

export const startPeerMonitor = (presenceDirectory, config = {}) => {
    const {
        ghGistToken = process.env.GH_GIST_TOKEN,
        ghGistId = process.env.GH_GIST_ID,
        ghGistUsername = process.env.GH_GIST_USERNAME,
        intervalMs = 8000,  // Update Gist every 8s
    } = config;

    if (!ghGistToken || !ghGistId || !ghGistUsername) {
        console.warn('[Peer Monitor] GitHub Gist config incomplete, peer monitoring disabled');
        return null;
    }

    /**
     * Get all active peers across all shards, filtered to recent activity.
     */
    const collectActivePeers = () => {
        if (!presenceDirectory) return [];

        // Get peers from all known shards (any shard with at least one peer)
        const peers = presenceDirectory.list() || [];
        const now = Date.now();
        const thirtySecondsAgo = now - 30_000;

        // Filter to only recent peers
        return peers.filter(p => {
            return p?.id && p?.ph && p?.shard && p?.ts > thirtySecondsAgo;
        }).map(p => ({
            id: p.id,
            ph: p.ph,
            shard: p.shard,
            ts: p.ts,
        }));
    };

    /**
     * Publish peers to GitHub Gist.
     */
    const publishToGist = async (peers) => {
        try {
            const content = JSON.stringify({ peers }, null, 2);

            const res = await fetch(`https://api.github.com/gists/${ghGistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${ghGistToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json',
                },
                body: JSON.stringify({
                    files: {
                        'fenhollow-peers.json': { content }
                    }
                })
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.warn(`[Peer Monitor] Gist update failed: HTTP ${res.status} - ${errorText.slice(0, 150)}`);
                return false;
            }

            if (peers.length > 0) {
                console.log(`[Peer Monitor] Published ${peers.length} peers to Gist`);
            }
            return true;
        } catch (err) {
            console.warn(`[Peer Monitor] Gist publish error: ${err.message}`);
            return false;
        }
    };

    /**
     * Main loop: collect peers and publish to Gist.
     */
    const tick = async () => {
        const peers = collectActivePeers();
        await publishToGist(peers);
    };

    // Start monitoring
    console.log(`[Peer Monitor] Started (interval: ${intervalMs}ms)`);
    const intervalId = setInterval(tick, intervalMs);

    // Do an immediate tick to populate Gist on startup
    tick().catch(err => console.warn(`[Peer Monitor] Initial tick failed: ${err.message}`));

    // Return stop function
    return () => clearInterval(intervalId);
};
