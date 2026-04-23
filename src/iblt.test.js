import { IBLT } from './iblt';

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
        
        expect(copy.table).toEqual(original.table);
    });
});
