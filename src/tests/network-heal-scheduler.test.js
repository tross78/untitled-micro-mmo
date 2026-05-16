import { shouldRunEventHeal } from '../network/heal.js';

describe('network event heal scheduling', () => {
    test('runs event heal only when usable shard peers are gone and cooldown elapsed', () => {
        expect(shouldRunEventHeal(0, 30000, 30000)).toBe(true);
        expect(shouldRunEventHeal(1, 30000, 30000)).toBe(false);
        expect(shouldRunEventHeal(0, 29999, 30000)).toBe(false);
    });
});
