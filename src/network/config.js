import { STUN_SERVERS, TORRENT_TRACKERS, APP_ID } from '../infra/constants.js';
import { recordPeerConnection } from './diagnostics.js';

const ICE_GATHER_TIMEOUT_MS = 1500;
// Safari/WebKit STUN resolution is significantly slower than Chrome (~2-4s vs <1s).
// Without a longer budget, the 1500ms flush fires before srflx candidates arrive,
// leaving only host candidates in the SDP and causing NAT traversal failures.
const ICE_GATHER_TIMEOUT_WEBKIT_MS = 5000;

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
//   1. ICE gathering timeout — prevents Chromium's 10 s hang on VPN/virtual adapters.
//   2. Unreliable data channels — all Trystero channels get UDP-like semantics
//      (maxPacketLifeTime 150 ms). Game state is latest-wins so stale packets
//      should be dropped, not queued. Critical actions have app-layer retries.
//      Disabled on WebKit/Safari, where partial-reliability data channels are a
//      higher compatibility risk during initial Trystero handshakes.
//   3. SCTP warm-up — 1200-byte dummy on first channel open triggers PMTU
//      discovery and stabilises the congestion window before real traffic flows.
//      Also disabled on WebKit/Safari for the same compatibility reason.
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

    // 1. ICE gathering timeout wrapper.
    const iceGatherTimeoutMs = useAggressiveDataChannels ? ICE_GATHER_TIMEOUT_MS : ICE_GATHER_TIMEOUT_WEBKIT_MS;

    const PatchedPeer = function(...args) {
        const pc = new _NativePeer(...args);
        recordPeerConnection(pc, {
            aggressiveDataChannels: useAggressiveDataChannels,
            config: args[0] || null,
        });
        let timer = null;
        const flush = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (pc.iceGatheringState !== 'complete') {
                pc.dispatchEvent(new Event('icegatheringstatechange'));
            }
        };
        pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete' && timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
        pc.addEventListener('icecandidate', (e) => {
            if (!e.candidate && timer) { clearTimeout(timer); timer = null; return; }
            if (e.candidate && !timer) {
                timer = setTimeout(flush, iceGatherTimeoutMs);
            }
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
export const NETWORK_HANDSHAKE_TIMEOUT_MS = 5000;
export const NETWORK_STARTUP_TURN_FALLBACK_MS = 3000;
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
    return { ...base, iceCandidatePoolSize: 3 };
};

export const buildTorrentConfig = (rtcConfig) => {
    return {
        appId: APP_ID,
        relayUrls: TORRENT_TRACKERS,
        trickleIce: true,
        // iceCandidatePoolSize pre-gathers ICE candidates immediately on
        // RTCPeerConnection creation, hiding gathering latency behind the
        // tracker signaling round-trip (item 6 — pre-warmed connections).
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
