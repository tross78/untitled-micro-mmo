import { IBLT } from './iblt.js';

describe('IBLT (Invertible Bloom Lookup Table)', () => {
    test('Can reconcile small set differences', () => {
        const alice = new IBLT();
        const bob = new IBLT();

        const common = ['user1', 'user2', 'user3'];
        common.forEach(id => {
            alice.insert(id);
            bob.insert(id);
        });

        const onlyAlice = 'userA';
        const onlyBob = 'userB';

        alice.insert(onlyAlice);
        bob.insert(onlyBob);

        // Bob subtracts his table from Alice's
        const diff = IBLT.subtract(alice, bob);
        const { added, removed, success } = diff.decode();

        if (!success) {
            console.log('Decode failed');
            console.log('Added:', added);
            console.log('Removed:', removed);
            console.log('Table after decode:', diff.count);
        }

        expect(success).toBe(true);
        
        // Convert string IDs to their numeric keys for comparison
        const keyA = alice._hashKey(onlyAlice);
        const keyB = alice._hashKey(onlyBob);

        expect(added).toContain(keyA);
        expect(removed).toContain(keyB);
    });

    test('Fails gracefully if difference exceeds capacity', () => {
        const alice = new IBLT(4); // Very small table
        const bob = new IBLT(4);

        for (let i = 0; i < 20; i++) {
            alice.insert('userA' + i);
            bob.insert('userB' + i);
        }

        const diff = IBLT.subtract(alice, bob);
        const { success } = diff.decode();
        expect(success).toBe(false);
    });

    test('Serialization and deserialization', () => {
        const original = new IBLT();
        original.insert('test-user');
        
        const data = original.serialize();
        const copy = IBLT.fromSerialized(data);
        
        expect(Array.from(copy.count)).toEqual(Array.from(original.count));
        expect(Array.from(copy.keySum)).toEqual(Array.from(original.keySum));
        expect(Array.from(copy.hashSum)).toEqual(Array.from(original.hashSum));
    });

    test('Can insert BigInt keys directly', () => {
        const iblt = new IBLT();
        const key = 12345n;
        expect(() => iblt.insert(key)).not.toThrow();
        const data = ibkle_test_extract(iblt);
        expect(data.keySum.some(k => k !== 0n)).toBe(true);
    });

    test('Double-inserting the same key causes decode to fail (not silently corrupt)', () => {
        const iblt = new IBLT();
        iblt.insert('user1');
        iblt.insert('user1'); // second insert cancels keySum to 0
        const { success } = iblt.decode();
        // A double-inserted key leaves non-zero count cells that can't be peeled,
        // so decode must fail rather than silently return wrong results.
        expect(success).toBe(false);
    });

    test('Empty IBLT decodes successfully with empty sets', () => {
        const iblt = new IBLT();
        const { added, removed, success } = iblt.decode();
        expect(success).toBe(true);
        expect(added).toHaveLength(0);
        expect(removed).toHaveLength(0);
    });
});

function ibkle_test_extract(iblt) {
    return {
        keySum: Array.from(iblt.keySum)
    };
}
