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
            const primary = makeRoom();
            const fallback = makeRoom();
            const room = createCompositeRoom([
                { name: 'primary', room: primary },
                { name: 'fallback', room: fallback },
            ]);
            const joins = [];
            const leaves = [];
            room.onPeerJoin(peerId => joins.push(peerId));
            room.onPeerLeave(peerId => leaves.push(peerId));

            primary.emitJoin('peer-a');
            fallback.emitJoin('peer-a');
            primary.emitLeave('peer-a');
            fallback.emitLeave('peer-a');
            // Wait past the peer-leave grace window for the final drop to propagate.
            jest.advanceTimersByTime(3500);

            expect(joins).toEqual(['peer-a']);
            expect(leaves).toEqual(['peer-a']);
        } finally {
            jest.useRealTimers();
        }
    });

    test('deduplicates matching action payloads received through multiple strategies', () => {
        const primary = makeRoom();
        const fallback = makeRoom();
        const room = createCompositeRoom([
            { name: 'primary', room: primary },
            { name: 'fallback', room: fallback },
        ]);
        const [, receive] = room.makeAction('presence_single');
        const handler = jest.fn();
        receive(handler);

        primary.emitAction('presence_single', { ph: 'aaaaaaaa' }, 'peer-a');
        fallback.emitAction('presence_single', { ph: 'aaaaaaaa' }, 'peer-a');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('distinct binary payloads with matching length/endpoints are not collapsed', () => {
        const primary = makeRoom();
        const fallback = makeRoom();
        const room = createCompositeRoom([
            { name: 'primary', room: primary },
            { name: 'fallback', room: fallback },
        ]);
        const [, receive] = room.makeAction('move');
        const handler = jest.fn();
        receive(handler);

        const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const b = new Uint8Array([1, 9, 9, 9, 9, 9, 9, 8]);
        primary.emitAction('move', a, 'peer-a');
        fallback.emitAction('move', b, 'peer-a');

        expect(handler).toHaveBeenCalledTimes(2);
    });

    test('peer-leave is held for a grace period and cancelled if peer re-joins', () => {
        jest.useFakeTimers();
        try {
            const primary = makeRoom();
            const fallback = makeRoom();
            const room = createCompositeRoom([
                { name: 'primary', room: primary },
                { name: 'fallback', room: fallback },
            ]);
            const leaves = [];
            room.onPeerLeave(peerId => leaves.push(peerId));

            // Peer is only seen via primary; primary drops them.
            primary.emitJoin('flap-peer');
            primary.emitLeave('flap-peer');
            // 2s later, before grace expires, they re-appear on fallback.
            jest.advanceTimersByTime(2000);
            fallback.emitJoin('flap-peer');
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
            const primary = makeRoom();
            const fallback = makeRoom();
            const room = createCompositeRoom([
                { name: 'primary', room: primary },
                { name: 'fallback', room: fallback },
            ]);
            const leaves = [];
            room.onPeerLeave(peerId => leaves.push(peerId));

            primary.emitJoin('gone-peer');
            primary.emitLeave('gone-peer');
            jest.advanceTimersByTime(3500);

            expect(leaves).toEqual(['gone-peer']);
        } finally {
            jest.useRealTimers();
        }
    });

    test('leave emits peer-leave for still-present peers', () => {
        const primary = makeRoom();
        const fallback = makeRoom();
        const room = createCompositeRoom([
            { name: 'primary', room: primary },
            { name: 'fallback', room: fallback },
        ]);
        const leaves = [];
        room.onPeerLeave(peerId => leaves.push(peerId));
        primary.emitJoin('peer-a');
        fallback.emitJoin('peer-b');

        room.leave();

        expect(leaves.sort()).toEqual(['peer-a', 'peer-b']);
    });

    test('exposes strategy timings and race winner via observer', () => {
        const primary = makeRoom();
        const fallback = makeRoom();
        const events = [];
        const room = createCompositeRoom(
            [
                { name: 'primary', room: primary },
                { name: 'fallback', room: fallback },
            ],
            (event, detail) => events.push({ event, detail }),
        );

        primary.emitJoin('peer-a');
        fallback.emitJoin('peer-b');

        expect(room.getRaceWinner()).toBe('primary');
        expect(events.some(e => e.event === 'strategy_race_won' && e.detail.strategy === 'primary')).toBe(true);
        expect(events.filter(e => e.event === 'strategy_first_peer').map(e => e.detail.strategy).sort())
            .toEqual(['fallback', 'primary']);
    });

    test('routes targeted sends to known strategy room for that peer', async () => {
        const primary = makeRoom();
        const fallback = makeRoom();
        const room = createCompositeRoom([
            { name: 'primary', room: primary },
            { name: 'fallback', room: fallback },
        ]);
        const [send] = room.makeAction('identity_handshake');
        primary.emitJoin('peer-a');

        await send({ ok: true }, ['peer-a']);

        expect(primary.sent).toHaveLength(1);
        expect(fallback.sent).toHaveLength(0);
    });
});
