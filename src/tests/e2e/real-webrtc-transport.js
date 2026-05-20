/**
 * Real-WebRTC E2E transport.
 *
 * Implements the same Trystero room API used by src/network/transport.js so
 * the full game networking stack runs unmodified, but routes data through
 * actual RTCPeerConnections instead of torrent-tracker connections.
 *
 * Signaling (SDP offer/answer + ICE candidates) uses BroadcastChannel —
 * same-origin tabs only, no internet required.  The data path is real WebRTC,
 * so this exercises ICE gathering, STUN, DataChannel reliability, and the
 * full message serialization stack.
 *
 * Install by setting ?e2e=1&transport=real in the URL (see useFakeTransport()
 * in src/infra/runtime.js).  The game detects this and skips installFakeTransport.
 * bootstrap.js calls patchIceGatheringTimeout() unconditionally, so the timeout
 * patch is still applied before any RTCPeerConnection is created.
 */

// ICE servers mirror src/infra/constants.js — keep in sync.
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];

// Encode/decode Uint8Array values at any nesting depth so that
// JSON.stringify does not silently discard binary presence/move packets.
const encodePayload = (v) => {
    if (v instanceof Uint8Array) {
        // Convert to base64 via charCode — works for large arrays without stack overflow
        let bin = '';
        for (let i = 0; i < v.length; i++) bin += String.fromCharCode(v[i]);
        return { __u8: btoa(bin) };
    }
    if (Array.isArray(v)) return v.map(encodePayload);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
        return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, encodePayload(val)]));
    }
    return v;
};

const decodePayload = (v) => {
    if (v && typeof v === 'object' && '__u8' in v && typeof v.__u8 === 'string') {
        const bin = atob(v.__u8);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    }
    if (Array.isArray(v)) return v.map(decodePayload);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
        return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, decodePayload(val)]));
    }
    return v;
};

const normalizeTargets = (t) => {
    if (!t) return null;
    return Array.isArray(t) ? t : [t];
};

// Expose ICE stats for test assertions.
window.__realWebRTCStats = window.__realWebRTCStats || {
    totalCandidates: 0,
    candidatesByType: {},
    connections: 0,
};

const makeRealRoom = (peerId, appId, roomId) => {
    const sigChannel = new BroadcastChannel(`fenhollow-rtc-sig:${appId}:${roomId}`);

    // peerId → { pc, dc, connected, pendingIce }
    const peerConns = new Map();

    const joinHandlers   = new Set();
    const leaveHandlers  = new Set();
    // action name → handler[]
    const actionHandlers = new Map();

    let closed = false;

    // ── Dispatch a received action message ───────────────────────────────────
    const dispatchAction = (name, payload, fromId) => {
        const handlers = actionHandlers.get(name);
        if (!handlers) return;
        const cloned = structuredClone(payload);
        handlers.forEach(h => setTimeout(() => h(cloned, fromId), 0));
    };

    // ── Attach listeners to a DataChannel ────────────────────────────────────
    // Also fires joinHandlers once the channel is open (guarantees the DC is
    // ready before the game sends any messages).
    const wireDataChannel = (dc, fromId) => {
        const state = peerConns.get(fromId);

        const onOpen = () => {
            if (state && !state.connected) {
                state.connected = true;
                window.__realWebRTCStats.connections++;
                joinHandlers.forEach(h => h(fromId));
                // Drain any messages queued before the channel opened
                if (state.sendQueue.length > 0) {
                    const q = state.sendQueue.splice(0);
                    for (const serialized of q) {
                        try { dc.send(serialized); } catch (_) {}
                    }
                }
            }
        };

        if (dc.readyState === 'open') {
            onOpen();
        } else {
            dc.addEventListener('open', onOpen, { once: true });
        }

        dc.addEventListener('message', (e) => {
            let msg;
            try {
                const raw = e.data instanceof ArrayBuffer
                    ? new TextDecoder().decode(e.data)
                    : e.data;
                msg = JSON.parse(raw);
            } catch { return; }
            if (msg?.name !== undefined) {
                dispatchAction(msg.name, decodePayload(msg.payload), fromId);
            }
        });
    };

    // ── Create or retrieve a peer connection ──────────────────────────────────
    const getPeerConn = (remotePeerId) => {
        if (peerConns.has(remotePeerId)) return peerConns.get(remotePeerId);

        const pc = new RTCPeerConnection({
            iceServers: ICE_SERVERS,
            iceCandidatePoolSize: 3,
        });
        // sendQueue holds messages to drain once the DC opens
        const state = { pc, dc: null, connected: false, pendingIce: [], sendQueue: [] };
        peerConns.set(remotePeerId, state);

        // Collect ICE stats for test assertions
        pc.addEventListener('icecandidate', (e) => {
            if (!e.candidate) return;
            const type = e.candidate.type
                || (e.candidate.candidate.match(/typ (\w+)/)?.[1] ?? 'unknown');
            window.__realWebRTCStats.totalCandidates++;
            window.__realWebRTCStats.candidatesByType[type] =
                (window.__realWebRTCStats.candidatesByType[type] || 0) + 1;

            // Forward candidate to remote peer via signaling channel
            sigChannel.postMessage({
                type: 'ice', from: peerId, to: remotePeerId, roomId,
                candidate: e.candidate.toJSON(),
            });
        });

        // Disconnect / failure cleanup only — join is handled by DC 'open' event
        // to guarantee the DataChannel is ready before game networking sends messages.
        pc.addEventListener('connectionstatechange', () => {
            const cs = pc.connectionState;
            if (cs === 'disconnected' || cs === 'failed' || cs === 'closed') {
                if (peerConns.delete(remotePeerId)) {
                    leaveHandlers.forEach(h => h(remotePeerId));
                }
            }
        });

        return state;
    };

    // ── Initiate a connection (offerer) ───────────────────────────────────────
    const initiateConnection = async (remotePeerId) => {
        const state = getPeerConn(remotePeerId);
        if (state.dc) return; // already initiated

        const dc = state.pc.createDataChannel('game', {
            ordered: false,
            maxPacketLifeTime: 150,
        });
        state.dc = dc;
        wireDataChannel(dc, remotePeerId);

        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription(offer);
        sigChannel.postMessage({
            type: 'offer', from: peerId, to: remotePeerId, roomId,
            sdp: offer.sdp,
        });
    };

    // ── Handle incoming signaling messages ────────────────────────────────────
    sigChannel.addEventListener('message', async ({ data }) => {
        if (!data || data.roomId !== roomId || data.from === peerId) return;
        if (data.to && data.to !== peerId) return;

        if (data.type === 'join') {
            // Reply to let them know we're here; the lower peerId is the offerer
            sigChannel.postMessage({ type: 'presence', from: peerId, roomId });
            if (peerId < data.from) await initiateConnection(data.from);
        }

        if (data.type === 'presence') {
            if (!peerConns.has(data.from) && peerId < data.from) {
                await initiateConnection(data.from);
            }
        }

        if (data.type === 'offer') {
            // If we already have a connection for this peer (from a previous room
            // join), close it first so the new offer creates a fresh PC.
            const existing = peerConns.get(data.from);
            if (existing && existing.connected) {
                existing.pc.close();
                peerConns.delete(data.from);
            }
            const state = getPeerConn(data.from);
            await state.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });

            // Wire incoming data channel before creating the answer
            state.pc.addEventListener('datachannel', (e) => {
                state.dc = e.channel;
                wireDataChannel(e.channel, data.from);
            });

            const answer = await state.pc.createAnswer();
            await state.pc.setLocalDescription(answer);
            sigChannel.postMessage({
                type: 'answer', from: peerId, to: data.from, roomId,
                sdp: answer.sdp,
            });

            // Drain any ICE candidates that arrived before setRemoteDescription
            for (const c of state.pendingIce) {
                await state.pc.addIceCandidate(c).catch(() => {});
            }
            state.pendingIce = [];
        }

        if (data.type === 'answer') {
            const state = peerConns.get(data.from);
            if (!state) return;
            await state.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
            for (const c of state.pendingIce) {
                await state.pc.addIceCandidate(c).catch(() => {});
            }
            state.pendingIce = [];
        }

        if (data.type === 'ice') {
            const state = peerConns.get(data.from);
            if (!state) return;
            if (state.pc.remoteDescription) {
                await state.pc.addIceCandidate(data.candidate).catch(() => {});
            } else {
                state.pendingIce.push(data.candidate);
            }
        }

        if (data.type === 'leave') {
            const state = peerConns.get(data.from);
            if (state) {
                state.pc.close();
                peerConns.delete(data.from);
                leaveHandlers.forEach(h => h(data.from));
            }
        }
    });

    // Announce ourselves
    setTimeout(() => {
        if (!closed) sigChannel.postMessage({ type: 'join', from: peerId, roomId });
    }, 0);

    // ── Public room API (mirrors Trystero) ────────────────────────────────────
    return {
        makeAction(name) {
            const send = (payload, targets) => {
                if (closed) return;
                const targetList = normalizeTargets(targets);
                const serialized = JSON.stringify({ name, payload: encodePayload(payload) });
                for (const [id, state] of peerConns.entries()) {
                    if (targetList && !targetList.includes(id)) continue;
                    if (state.dc?.readyState === 'open') {
                        try { state.dc.send(serialized); } catch (_) {}
                    } else if (state.dc) {
                        // DC exists but not yet open — queue for drain on 'open'
                        state.sendQueue.push(serialized);
                    }
                }
            };
            const onReceive = (handler) => {
                const list = actionHandlers.get(name) || [];
                list.push(handler);
                actionHandlers.set(name, list);
            };
            return [send, onReceive];
        },
        onPeerJoin(handler)  { joinHandlers.add(handler); },
        onPeerLeave(handler) { leaveHandlers.add(handler); },
        getPeers() {
            return Object.fromEntries(
                Array.from(peerConns.entries())
                    .filter(([, s]) => s.connected)
                    .map(([id]) => [id, { peerId: id }])
            );
        },
        leave() {
            if (closed) return;
            closed = true;
            sigChannel.postMessage({ type: 'leave', from: peerId, roomId });
            sigChannel.close();
            for (const [, s] of peerConns.entries()) s.pc.close();
            peerConns.clear();
            actionHandlers.clear();
            joinHandlers.clear();
            leaveHandlers.clear();
        },
    };
};

export const installRealWebRTCTransport = () => {
    const params  = new URLSearchParams(window.location.search);
    const peerId  = params.get('peer') || `peer-${crypto.randomUUID().slice(0, 8)}`;

    window.__FENHOLLOW_TRANSPORT__ = {
        selfId: peerId,
        joinRoom(config, roomId) {
            return makeRealRoom(peerId, config.appId, roomId);
        },
    };
};
