import { HyParView } from '../network/hyparview.js';

describe('HyParView overlay policy', () => {
    test('first three peers enter active view and overflow goes passive', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e'].forEach(id => hpv.onJoin(id));

        expect(hpv.eagerPeers()).toEqual(['a', 'b', 'c']);
        expect(hpv.lazyPeers()).toEqual(['d', 'e']);
        expect(hpv.allPeers()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    test('leaving active peer promotes oldest passive peer', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd'].forEach(id => hpv.onJoin(id));

        hpv.onLeave('b');

        expect(hpv.eagerPeers()).toEqual(['a', 'c', 'd']);
        expect(hpv.lazyPeers()).toEqual([]);
    });

    test('promote moves passive peer to active and demotes oldest active when full', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd'].forEach(id => hpv.onJoin(id));

        hpv.promote('d');

        expect(hpv.eagerPeers()).toEqual(['b', 'c', 'd']);
        expect(hpv.lazyPeers()).toEqual(['a']);
    });

    test('markSeen returns false for duplicates and evicts oldest after capacity', () => {
        const hpv = new HyParView();
        expect(hpv.markSeen('first')).toBe(true);
        expect(hpv.markSeen('first')).toBe(false);

        for (let i = 0; i < 256; i++) hpv.markSeen(`m-${i}`);

        expect(hpv.hasSeen('first')).toBe(false);
        expect(hpv.hasSeen('m-255')).toBe(true);
    });

    test('msgId is deterministic for strings and objects', () => {
        const hashFn = (s) => {
            let h = 0;
            for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
            return h;
        };

        expect(HyParView.msgId(hashFn, 'payload')).toBe(HyParView.msgId(hashFn, 'payload'));
        expect(HyParView.msgId(hashFn, { a: 1 })).toBe(HyParView.msgId(hashFn, { a: 1 }));
        expect(HyParView.msgId(hashFn, 'payload')).toMatch(/^[0-9a-f]{8}$/);
    });
});
