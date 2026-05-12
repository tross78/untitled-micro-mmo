import { HyParView } from '../network/hyparview.js';

describe('HyParView overlay policy', () => {
    test('first 8 peers enter active view and overflow goes passive', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].forEach(id => hpv.onJoin(id));

        expect(hpv.eagerPeers()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
        expect(hpv.lazyPeers()).toEqual(['i', 'j']);
        expect(hpv.allPeers()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    });

    test('leaving active peer promotes oldest passive peer', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].forEach(id => hpv.onJoin(id));

        hpv.onLeave('b');

        expect(hpv.eagerPeers()).toContain('i'); // i promoted from passive
        expect(hpv.eagerPeers()).not.toContain('b');
        expect(hpv.lazyPeers()).toEqual([]);
    });

    test('promote moves passive peer to active and demotes oldest active when full', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x'].forEach(id => hpv.onJoin(id));
        // active: a-h, passive: x

        hpv.promote('x');

        expect(hpv.eagerPeers()).toContain('x');
        expect(hpv.eagerPeers()).toHaveLength(8);
        expect(hpv.lazyPeers()).toContain('a'); // oldest active demoted
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

    test('shuffle returns up to 3 passive peers without repetition', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].forEach(id => hpv.onJoin(id));
        // passive: i, j, k
        const sample = hpv.shuffle();
        expect(sample.length).toBeLessThanOrEqual(3);
        expect(new Set(sample).size).toBe(sample.length); // no duplicates
        sample.forEach(id => expect(hpv.lazyPeers()).toContain(id));
    });

    test('mergeShuffle adds new peers to passive view without overflow', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(id => hpv.onJoin(id));
        hpv.mergeShuffle(['x', 'y', 'z'], 'self');
        expect(hpv.lazyPeers()).toContain('x');
        expect(hpv.lazyPeers()).toContain('y');
        expect(hpv.lazyPeers()).toContain('z');
    });

    test('mergeShuffle ignores self and already-known peers', () => {
        const hpv = new HyParView();
        ['a', 'b'].forEach(id => hpv.onJoin(id));
        hpv.mergeShuffle(['a', 'self', 'z'], 'self');
        expect(hpv.lazyPeers()).not.toContain('self');
        expect(hpv.lazyPeers()).toContain('z');
    });

    test('prioritize forces a peer into active view', () => {
        const hpv = new HyParView();
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x'].forEach(id => hpv.onJoin(id));
        // x is in passive
        hpv.prioritize('x');
        expect(hpv.eagerPeers()).toContain('x');
        expect(hpv.eagerPeers()).toHaveLength(8);
    });
});
