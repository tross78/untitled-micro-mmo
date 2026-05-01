import { cmpHLC, packHLC, recvHLC, sendHLC, unpackHLC } from '../network/hlc.js';

describe('Hybrid Logical Clock', () => {
    let nowSpy;

    afterEach(() => {
        nowSpy?.mockRestore();
        nowSpy = null;
    });

    test('sendHLC increments logical counter when wall clock does not advance', () => {
        nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1777594000000);

        const a = sendHLC();
        const b = sendHLC();

        expect(b.wall).toBe(a.wall);
        expect(b.logical).toBeGreaterThan(a.logical);
    });

    test('recvHLC advances to newer remote wall time', () => {
        nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1777594000000);

        const received = recvHLC({ wall: 1777594000500, logical: 3 });

        expect(received).toEqual({ wall: 1777594000500, logical: 4 });
    });

    test('recvHLC merges equal wall time by taking max logical plus one', () => {
        nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1777594001000);
        recvHLC({ wall: 1777594001000, logical: 1 });

        const received = recvHLC({ wall: 1777594001000, logical: 9 });

        expect(received.wall).toBe(1777594001000);
        expect(received.logical).toBe(10);
    });

    test('cmpHLC orders by wall then logical', () => {
        expect(cmpHLC({ wall: 1, logical: 9 }, { wall: 2, logical: 0 })).toBeLessThan(0);
        expect(cmpHLC({ wall: 2, logical: 1 }, { wall: 2, logical: 0 })).toBeGreaterThan(0);
        expect(cmpHLC({ wall: 2, logical: 1 }, { wall: 2, logical: 1 })).toBe(0);
    });

    test('packHLC round-trips current 48-bit millisecond wall time', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        const hlc = { wall: 1777594233739, logical: 65535 };

        packHLC(hlc, view, 0);

        expect(unpackHLC(view, 0)).toEqual(hlc);
    });
});
