import { STUN_SERVERS, TORRENT_TRACKERS, APP_ID } from '../infra/constants.js';
import { recordPeerConnection } from './diagnostics.js';


export const isWebKitRtcBrowser = () => {
    if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
    const ua = navigator.userAgent;
    return /AppleWebKit/i.test(ua) && !/(Chrome|Chromium|Edg|OPR)/i.test(ua);
};

export const shouldUseAggressiveDataChannelTuning = () => !isWebKitRtcBrowser();

/**
 * @typedef {RTCPeerConnection & { __dcPatched?: boolean }} PatchedPeerInstance
 * @typedef {(new (configuration?: RTCConfiguration) => PatchedPeerInstance) & {
 *   prototype: PatchedPeerInstance,
 *   generateCertificate: typeof RTCPeerConnection.generateCertificate,
 *   __iceTimeoutPatched?: boolean
 * }} PatchedPeerCtor
 */

// One-time RTCPeerConnection patches applied at startup:
//   2. Unreliable data channels — all Trystero channels get UDP-like semantics
//      (maxPacketLifeTime 150 ms). Game state is latest-wins so stale packets
//      should be dropped, not queued. Critical actions have app-layer retries.
//      Disabled on WebKit/Safari: empirical — no current public bug citation for
//      Safari breaking partial-reliability handshakes (webkit.org/b/173052 was
//      historical), but Safari data-channel behaviour under load is less tested.
//   3. SCTP warm-up — 1200-byte dummy on first channel open. 1200 bytes is the
//      conservative SCTP/IP MTU floor (RFC 8831 §5.1). Sending early triggers
//      PMTU discovery and widens the cwnd before real traffic flows. Not a
//      documented WebRTC best practice; treat as empirical optimisation.
//      Disabled on WebKit/Safari for the same reason as (2).
export const patchIceGatheringTimeout = () => {
    if (typeof RTCPeerConnection === 'undefined') return;
    /** @type {PatchedPeerCtor} */
    const NativePeer = /** @type {PatchedPeerCtor} */ (RTCPeerConnection);
    if (NativePeer.__iceTimeoutPatched) return;
    const _NativePeer = NativePeer;
    const useAggressiveDataChannels = shouldUseAggressiveDataChannelTuning();

    // 2. Unreliable data channels (patch the native prototype once).
    if (useAggressiveDataChannels && !_NativePeer.prototype.__dcPatched) {
        const _nativeCreateDC = _NativePeer.prototype.createDataChannel;
        _NativePeer.prototype.createDataChannel = function(label, opts) {
            const o = (opts && typeof opts === 'object') ? { ...opts } : {};
            if (o.maxRetransmits === undefined && o.maxPacketLifeTime === undefined) {
                o.ordered = false;
                o.maxPacketLifeTime = 150;
            }
            return _nativeCreateDC.call(this, label, o);
        };
        _NativePeer.prototype.__dcPatched = true;
    }

    // ICE gathering timeout note: with trickleIce: true (our config), Trystero
    // signals the SDP immediately without waiting for gathering to complete, then
    // sends individual candidates as they arrive. The icegatheringstatechange event
    // is only checked by Trystero's waitForIceGathering which is only called in
    // non-trickle mode. Dispatching a fake event is therefore a no-op and removed.
    // Trystero has its own 15s internal ICE timeout for non-trickle paths.

    const PatchedPeer = function(...args) {
        const pc = new _NativePeer(...args);
        recordPeerConnection(pc, {
            aggressiveDataChannels: useAggressiveDataChannels,
            config: args[0] || null,
        });
        // 3. SCTP warm-up on inbound data channels.
        if (useAggressiveDataChannels) {
            pc.addEventListener('datachannel', (e) => {
                const ch = e.channel;
                const doWarmup = () => { try { ch.send(new Uint8Array(1200)); } catch (_) { /* ignore warmup failures */ } };
                if (ch.readyState === 'open') doWarmup();
                else ch.addEventListener('open', doWarmup, { once: true });
            });
        }
        return pc;
    };
    /** @type {PatchedPeerCtor} */
    const patchedPeerCtor = /** @type {PatchedPeerCtor} */ (/** @type {unknown} */ (PatchedPeer));
    patchedPeerCtor.prototype = _NativePeer.prototype;
    if (typeof _NativePeer.generateCertificate === 'function') {
        patchedPeerCtor.generateCertificate = _NativePeer.generateCertificate.bind(_NativePeer);
    }
    patchedPeerCtor.__iceTimeoutPatched = true;
    Object.defineProperty(patchedPeerCtor, 'name', { value: 'RTCPeerConnection' });
    try {
        globalThis.RTCPeerConnection = /** @type {typeof RTCPeerConnection} */ (patchedPeerCtor);
        NativePeer.__iceTimeoutPatched = true;
    } catch (_) { /* sandboxed env — skip silently */ }
};

export const ROLLUP_INTERVAL = 10000;
export const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;
export const NETWORK_STALL_MS = 60000;
export const NETWORK_HEAL_COOLDOWN_MS = 30000;
export const NETWORK_EVENT_HEAL_DELAY_MS = 1500;
// Safari ICE gathering alone takes up to 5s; allowing 20s gives the full
// ICE+DTLS+SCTP stack plus two retry attempts before declaring failure.
export const NETWORK_HANDSHAKE_TIMEOUT_MS = 20000;
// Startup fallback delay: must exceed the worst-case ICE+DTLS+SCTP connection
// setup time before declaring "no peers" and re-running connectGlobal+joinInstance.
// Safari ICE gathering alone takes up to 5s; 15s covers the full stack.
// At 3s this fired while ICE was still in progress, causing spurious disconnects.
export const NETWORK_STARTUP_TURN_FALLBACK_MS = 15000;
export const NETWORK_PRESENCE_HEARTBEAT_MS = 5000;
export const NETWORK_PEER_STALE_MS = 20000;
export const NETWORK_PEER_SWEEP_MS = 5000;
// Ghost TTL: peers silent for this long get hard-evicted. Must be > STALE_MS.
export const GHOST_TTL_MS = 60_000;
// Relay escalation: after this many ms with zero usable peers, include TURN candidates.
export const EARLY_RELAY_ESCALATION_MS = 2000;
// Introducer TTLs: warm peers (recently verified presence) stay longer.
export const INTRODUCER_TTL_COLD_MS = 2 * 3600_000;  // 2h
export const INTRODUCER_TTL_WARM_MS = 8 * 3600_000;  // 8h

const buildRtcConfig = (rtcConfig) => {
    const base = rtcConfig || { iceServers: STUN_SERVERS };
    // iceCandidatePoolSize pre-gathers candidates to hide gathering latency (MDN).
    // Disabled on Safari: empirical — no citation for "Safari ICE scheduler stalls
    // under concurrent gather load" or "data-channel offers don't gather until
    // setRemoteDescription." Observed in practice with Trystero's 20-PC offer pool
    // (20×3 = 60 concurrent gathers) but treat as unconfirmed until reproduced.
    const poolSize = isWebKitRtcBrowser() ? 0 : 3;
    return { ...base, iceCandidatePoolSize: poolSize };
};

export const buildTorrentConfig = (rtcConfig) => {
    // All browsers use the full tracker set. (Previously webtorrent.dev was filtered out on Safari on
    // the assumption it was ECONNRESET-rejected there — but __fenhollowNetDiag shows it connecting fine
    // from WebKit, and stripping Safari to the single, slow openwebtorrent.com path left it unable to
    // pair in time while Chrome paired via the second tracker. Keep both paths for every browser.)
    return {
        appId: APP_ID,
        relayUrls: TORRENT_TRACKERS,
        trickleIce: true,
        rtcConfig: buildRtcConfig(rtcConfig),
    };
};

export const buildFastRoomConfig = (rtcConfig) => buildTorrentConfig(rtcConfig);

export const isUsingTurnFallback = (rtcConfig) => {
    const iceServers = rtcConfig?.iceServers || [];
    return iceServers.some(server => {
        const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
        return urls.some(url => typeof url === 'string' && url.startsWith('turn:'));
    });
};
