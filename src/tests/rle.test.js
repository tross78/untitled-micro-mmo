import { decodeRLEFrame } from '../graphics/graphics.js';

describe('RLE Decoder', () => {
    it('should correctly decode RLE encoded rows', () => {
        const rleRows = [
            [[3, '0'], [2, '4'], [3, '0']],
            [[2, '0'], [4, '1'], [2, '0']]
        ];
        const expected = [
            '00044000',
            '00111100'
        ];
        expect(decodeRLEFrame(rleRows)).toEqual(expected);
    });

    it('should handle empty rows', () => {
        expect(decodeRLEFrame([])).toEqual([]);
    });

    it('should handle null input', () => {
        expect(decodeRLEFrame(null)).toEqual([]);
    });
});
