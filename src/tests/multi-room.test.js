import { createCompositeRoom } from '../network/multi-room.js';

const makeRoom = () => {
    const actions = new Map();
    let joinHandler = () => {};
    let leaveHandler = () => {};
    return {
        sent: [],
        makeAction(name) {
            const send = jest.fn((data, targets) => {
                this.sent.push({ name, data, targets });
                return Promise.resolve([]);
            });
            const receive = jest.fn(handler => actions.set(name, handler));
            const progress = jest.fn();
            return [send, receive, progress];
        },
        onPeerJoin(handler) { joinHandler = handler; },
        onPeerLeave(handler) { leaveHandler = handler; },
        getPeers: jest.fn(() => ({})),
        leave: jest.fn(),
        emitJoin(peerId) { joinHandler(peerId); },
        emitLeave(peerId) { leaveHandler(peerId); },
        emitAction(name, payload, peerId) { actions.get(name)?.(payload, peerId); },
    };
};

describe('composite signaling room', () => {
    test('emits one peer join until a peer leaves every strategy room', () => {
        jest.useFakeTimers();
        try {
            const nostr = makeRoom();
            const torrent = makeRoom();
            const room = createCompositeRoom([
                { name: 'nostr', room: nostr },
                { name: 'torrent', room: torrent },
            ]);
            const joins = [];
            const leaves = [];
            room.onPeerJoin(peerId => joins.push(peerId));
            room.onPeerLeave(peerId => leaves.push(peerId));

            nostr.emitJoin('peer-a');
            torrent.emitJoin('peer-a');
            nostr.emitLeave('peer-a');
            torrent.emitLeave('peer-a');
            // Wait past the peer-leave grace window for the final drop to propagate.
            jest.advanceTimersByTime(3500);

            expect(joins).toEqual(['peer-a']);
            expect(leaves).toEqual(['peer-a']);
        } finally {
            jest.useRealTimers();
        }
    });

    test('deduplicates matching action payloads received through multiple strategies', () => {
        const nostr = makeRoom();
        const torrent = makeRoom();
        const room = createCompositeRoom([
            { name: 'nostr', room: nostr },
            { name: 'torrent', room: torrent },
        ]);
        const [, receive] = room.makeAction('presence_single');
        const handler = jest.fn();
        receive(handler);

        nostr.emitAction('presence_single', { ph: 'aaaaaaaa' }, 'peer-a');
        torrent.emitAction('presence_single', { ph: 'aaaaaaaa' }, 'peer-a');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('distinct binary payloads with matching length/endpoints are not collapsed', () => {
        const nostr = makeRoom();
        const torrent = makeRoom();
        const room = createCompositeRoom([
            { name: 'nostr', room: nostr },
            { name: 'torrent', room: torrent },
        ]);
        const [, receive] = room.makeAction('move');
        const handler = jest.fn();
        receive(handler);

        const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const b = new Uint8Array([1, 9, 9, 9, 9, 9, 9, 8]);
        nostr.emitAction('move', a, 'peer-a');
        torrent.emitAction('move', b, 'peer-a');

        expect(handler).toHaveBeenCalledTimes(2);
    });

    test('peer-leave is held for a grace period and cancelled if peer re-joins', () => {
        jest.useFakeTimers();
        try {
            const nostr = makeRoom();
            const torrent = makeRoom();
            const room = createCompositeRoom([
                { name: 'nostr', room: nostr },
                { name: 'torrent', room: torrent },
            ]);
            const leaves = [];
            room.onPeerLeave(peerId => leaves.push(peerId));

            // Peer is only seen via nostr; nostr drops them.
            nostr.emitJoin('flap-peer');
            nostr.emitLeave('flap-peer');
            // 2s later, before grace expires, they re-appear on torrent.
            jest.advanceTimersByTime(2000);
            torrent.emitJoin('flap-peer');
            // Advance past where the grace would have fired.
            jest.advanceTimersByTime(5000);

            expect(leaves).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('peer-leave fires after grace if peer never returns', () => {
        jest.useFakeTimers();
        try {
            const nostr = makeRoom();
            const torrent = makeRoom();
            const room = createCompositeRoom([
                { name: 'nostr', room: nostr },
                { name: 'torrent', room: torrent },
            ]);
            const leaves = [];
            room.onPeerLeave(peerId => leaves.push(peerId));

            nostr.emitJoin('gone-peer');
            nostr.emitLeave('gone-peer');
            jest.advanceTimersByTime(3500);

            expect(leaves).toEqual(['gone-peer']);
        } finally {
            jest.useRealTimers();
        }
    });

    test('leave emits peer-leave for still-present peers', () => {
        const nostr = makeRoom();
        const torrent = makeRoom();
        const room = createCompositeRoom([
            { name: 'nostr', room: nostr },
            { name: 'torrent', room: torrent },
        ]);
        const leaves = [];
        room.onPeerLeave(peerId => leaves.push(peerId));
        nostr.emitJoin('peer-a');
        torrent.emitJoin('peer-b');

        room.leave();

        expect(leaves.sort()).toEqual(['peer-a', 'peer-b']);
    });

    test('exposes strategy timings and race winner via observer', () => {
        const nostr = makeRoom();
        const torrent = makeRoom();
        const events = [];
        const room = createCompositeRoom(
            [
                { name: 'nostr', room: nostr },
                { name: 'torrent', room: torrent },
            ],
            (event, detail) => events.push({ event, detail }),
        );

        nostr.emitJoin('peer-a');
        torrent.emitJoin('peer-b');

        expect(room.getRaceWinner()).toBe('nostr');
        expect(events.some(e => e.event === 'strategy_race_won' && e.detail.strategy === 'nostr')).toBe(true);
        expect(events.filter(e => e.event === 'strategy_first_peer').map(e => e.detail.strategy).sort())
            .toEqual(['nostr', 'torrent']);
    });

    test('routes targeted sends to known strategy room for that peer', async () => {
        const nostr = makeRoom();
        const torrent = makeRoom();
        const room = createCompositeRoom([
            { name: 'nostr', room: nostr },
            { name: 'torrent', room: torrent },
        ]);
        const [send] = room.makeAction('identity_handshake');
        nostr.emitJoin('peer-a');

        await send({ ok: true }, ['peer-a']);

        expect(nostr.sent).toHaveLength(1);
        expect(torrent.sent).toHaveLength(0);
    });
});
