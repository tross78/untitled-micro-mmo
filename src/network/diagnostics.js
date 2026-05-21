import { ICE_SERVERS, TORRENT_TRACKERS } from '../infra/constants.js';

const MAX_PC_RECORDS = 24;
const MAX_EVENTS = 80;
let nextPeerConnectionId = 1;
const peerConnectionRecords = [];
let contextProvider = null;

const now = () => Date.now();

const pushBounded = (list, value, cap = MAX_EVENTS) => {
    list.push(value);
    if (list.length > cap) list.shift();
};

export const candidateTypeFromString = (candidate) => {
    if (!candidate || typeof candidate !== 'string') return 'unknown';
    return candidate.match(/ typ ([a-z0-9]+)/i)?.[1] || 'unknown';
};

const candidateType = (candidate) => candidate?.type || candidateTypeFromString(candidate?.candidate);

const safeIceServers = () => ICE_SERVERS.map(server => ({
    urls: server.urls,
    username: server.username ? '<set>' : undefined,
    credential: server.credential ? '<set>' : undefined,
}));

export const setNetworkDiagnosticContextProvider = (provider) => {
    contextProvider = typeof provider === 'function' ? provider : null;
};

const currentContext = () => {
    try {
        return contextProvider ? contextProvider() : {};
    } catch {
        return {};
    }
};

const recordEvent = (record, event, detail = null) => {
    pushBounded(record.events, { at: now(), event, detail });
};

const monitorDataChannel = (record, channel, direction, label = channel?.label || '') => {
    if (!channel) return;
    const channelRecord = {
        direction,
        label,
        createdAt: now(),
        openAt: null,
        closeAt: null,
        errorAt: null,
        readyState: channel.readyState,
    };
    record.dataChannels.push(channelRecord);
    const update = (event) => {
        channelRecord.readyState = channel.readyState;
        if (event === 'open') channelRecord.openAt = now();
        if (event === 'close') channelRecord.closeAt = now();
        if (event === 'error') channelRecord.errorAt = now();
        recordEvent(record, `datachannel:${event}`, { direction, label, readyState: channel.readyState });
    };
    channel.addEventListener?.('open', () => update('open'));
    channel.addEventListener?.('close', () => update('close'));
    channel.addEventListener?.('error', () => update('error'));
};

export const recordPeerConnection = (pc, detail = {}) => {
    if (!pc || pc.__fenhollowDiagId) return;
    const record = {
        id: nextPeerConnectionId++,
        createdAt: now(),
        detail,
        candidateCount: 0,
        candidatesByType: {},
        states: {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
        },
        dataChannels: [],
        events: [],
    };
    pc.__fenhollowDiagId = record.id;
    peerConnectionRecords.push(record);
    if (peerConnectionRecords.length > MAX_PC_RECORDS) peerConnectionRecords.shift();

    const updateState = (event) => {
        record.states = {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
        };
        recordEvent(record, event, record.states);
    };

    pc.addEventListener?.('connectionstatechange', () => updateState('connectionstatechange'));
    pc.addEventListener?.('iceconnectionstatechange', () => updateState('iceconnectionstatechange'));
    pc.addEventListener?.('icegatheringstatechange', () => updateState('icegatheringstatechange'));
    pc.addEventListener?.('signalingstatechange', () => updateState('signalingstatechange'));
    pc.addEventListener?.('icecandidate', (event) => {
        if (!event.candidate) {
            recordEvent(record, 'icecandidate:end');
            return;
        }
        const type = candidateType(event.candidate);
        record.candidateCount += 1;
        record.candidatesByType[type] = (record.candidatesByType[type] || 0) + 1;
        recordEvent(record, 'icecandidate', { type });
    });
    pc.addEventListener?.('datachannel', (event) => {
        monitorDataChannel(record, event.channel, 'inbound');
    });

    const nativeCreateDataChannel = pc.createDataChannel?.bind(pc);
    if (nativeCreateDataChannel && !pc.__fenhollowDiagCreateDcPatched) {
        pc.createDataChannel = (label, options) => {
            const channel = nativeCreateDataChannel(label, options);
            monitorDataChannel(record, channel, 'outbound', label);
            return channel;
        };
        pc.__fenhollowDiagCreateDcPatched = true;
    }
};

export const getPeerConnectionDiagnostics = () => peerConnectionRecords.map(record => ({
    ...record,
    detail: { ...record.detail },
    states: { ...record.states },
    candidatesByType: { ...record.candidatesByType },
    dataChannels: record.dataChannels.map(channel => ({ ...channel })),
    events: record.events.slice(),
}));

export const probeTrackerWebSocket = (url, timeoutMs = 6000) => new Promise(resolve => {
    if (typeof WebSocket === 'undefined') {
        resolve({ url, status: 'unsupported', elapsedMs: 0 });
        return;
    }
    const startedAt = now();
    let settled = false;
    let ws = null;
    const finish = (status, detail = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws?.close(); } catch (_err) { /* ignore close failures */ }
        resolve({ url, status, detail, elapsedMs: now() - startedAt });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    try {
        ws = new WebSocket(url);
        ws.onopen = () => finish('open');
        ws.onerror = () => finish('error');
        ws.onclose = event => finish('close', String(event?.code || ''));
    } catch (err) {
        finish('construct_error', err?.message || String(err));
    }
});

export const probeIceGathering = async (timeoutMs = 7000) => {
    if (typeof RTCPeerConnection === 'undefined') {
        return { status: 'unsupported', elapsedMs: 0, candidateCount: 0, candidatesByType: {} };
    }
    const startedAt = now();
    const candidatesByType = {};
    let candidateCount = 0;
    let completed = false;
    let error = null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 3 });
    try {
        pc.addEventListener('icecandidate', event => {
            if (!event.candidate) {
                completed = true;
                return;
            }
            const type = candidateType(event.candidate);
            candidateCount += 1;
            candidatesByType[type] = (candidatesByType[type] || 0) + 1;
        });
        pc.createDataChannel('fenhollow-diag');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await new Promise(resolve => {
            const timer = setTimeout(resolve, timeoutMs);
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
    } catch (err) {
        error = err?.message || String(err);
    } finally {
        try { pc.close(); } catch (_err) { /* ignore close failures */ }
    }
    return {
        status: error ? 'error' : (completed ? 'complete' : 'timeout'),
        error,
        elapsedMs: now() - startedAt,
        candidateCount,
        candidatesByType,
        finalState: {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
        },
    };
};

export const runNetworkDiagnostics = async (options = {}) => {
    const timeoutMs = options.timeoutMs || 7000;
    const trackerTimeoutMs = options.trackerTimeoutMs || 6000;
    const [trackers, ice] = await Promise.all([
        Promise.all(TORRENT_TRACKERS.map(url => probeTrackerWebSocket(url, trackerTimeoutMs))),
        probeIceGathering(timeoutMs),
    ]);
    return {
        at: now(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        location: typeof window !== 'undefined' ? window.location.href : '',
        capabilities: {
            webSocket: typeof WebSocket !== 'undefined',
            rtcPeerConnection: typeof RTCPeerConnection !== 'undefined',
        },
        config: {
            torrentTrackers: TORRENT_TRACKERS.slice(),
            iceServers: safeIceServers(),
        },
        current: currentContext(),
        trackers,
        ice,
        peerConnections: getPeerConnectionDiagnostics(),
    };
};

export const installNetworkDiagnostics = () => {
    if (typeof window === 'undefined') return;
    window['__fenhollowNetDiag'] = async (options = {}) => {
        const report = await runNetworkDiagnostics(options);
        console.log('[P2P] Network diagnostic report', report);
        return report;
    };
    window['__fenhollowNetSnapshot'] = () => ({
        at: now(),
        current: currentContext(),
        peerConnections: getPeerConnectionDiagnostics(),
    });
};
