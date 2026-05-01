const cloneValue = (value) => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return value;
};

const normalizeTargets = (target) => {
    if (!target) return null;
    if (Array.isArray(target)) return target;
    return [target];
};

const makeRoom = (peerId, appId, roomId) => {
    const channelName = `hearthwick-e2e:${appId}:${roomId}`;
    const channel = new BroadcastChannel(channelName);
    const peers = new Set();
    const joinHandlers = new Set();
    const leaveHandlers = new Set();
    const actionHandlers = new Map();
    let closed = false;

    const notifyJoin = (remotePeerId) => {
        if (remotePeerId === peerId || peers.has(remotePeerId)) return;
        peers.add(remotePeerId);
        joinHandlers.forEach(handler => handler(remotePeerId));
    };

    const notifyLeave = (remotePeerId) => {
        if (!peers.delete(remotePeerId)) return;
        leaveHandlers.forEach(handler => handler(remotePeerId));
    };

    channel.onmessage = ({ data }) => {
        if (!data || data.from === peerId || data.roomId !== roomId) return;

        switch (data.type) {
            case 'join':
                notifyJoin(data.from);
                channel.postMessage({ type: 'presence', roomId, from: peerId });
                break;
            case 'presence':
                notifyJoin(data.from);
                break;
            case 'leave':
                notifyLeave(data.from);
                break;
            case 'action': {
                const targets = data.targets;
                if (targets && !targets.includes(peerId)) return;
                const listeners = actionHandlers.get(data.name) || [];
                const payload = cloneValue(data.payload);
                listeners.forEach(listener => setTimeout(() => listener(payload, data.from), 0));
                break;
            }
        }
    };

    setTimeout(() => {
        if (!closed) channel.postMessage({ type: 'join', roomId, from: peerId });
    }, 0);

    return {
        makeAction(name) {
            const send = (payload, target) => {
                if (closed) return;
                channel.postMessage({
                    type: 'action',
                    roomId,
                    from: peerId,
                    name,
                    payload: cloneValue(payload),
                    targets: normalizeTargets(target),
                });
            };

            const onReceive = (handler) => {
                const handlers = actionHandlers.get(name) || [];
                handlers.push(handler);
                actionHandlers.set(name, handlers);
            };

            return [send, onReceive];
        },
        onPeerJoin(handler) {
            joinHandlers.add(handler);
        },
        onPeerLeave(handler) {
            leaveHandlers.add(handler);
        },
        getPeers() {
            return Object.fromEntries(Array.from(peers).map(id => [id, { peerId: id }]));
        },
        leave() {
            if (closed) return;
            closed = true;
            channel.postMessage({ type: 'leave', roomId, from: peerId });
            channel.close();
            peers.clear();
            actionHandlers.clear();
            joinHandlers.clear();
            leaveHandlers.clear();
        },
    };
};

export const installFakeTransport = () => {
    const params = new URLSearchParams(window.location.search);
    const peerId = params.get('peer') || `peer-${crypto.randomUUID().slice(0, 8)}`;

    window.__HEARTHWICK_TRANSPORT__ = {
        selfId: peerId,
        joinRoom(config, roomId) {
            return makeRoom(peerId, config.appId, roomId);
        },
    };
};
