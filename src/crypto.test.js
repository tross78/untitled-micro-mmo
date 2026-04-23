import { computeHash, createMerkleRoot } from './crypto';

describe('Crypto Utilities', () => {
    describe('computeHash', () => {
        test('is deterministic', async () => {
            const h1 = await computeHash('hello');
            const h2 = await computeHash('hello');
            expect(h1).toBe(h2);
            expect(h1).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        });

        test('different inputs produce different hashes', async () => {
            const h1 = await computeHash('a');
            const h2 = await computeHash('b');
            expect(h1).not.toBe(h2);
        });
    });

    describe('createMerkleRoot', () => {
        test('is deterministic for same leaves', async () => {
            const leaves = ['alice:1:0:cellar', 'bob:1:0:cellar'];
            const r1 = await createMerkleRoot(leaves);
            const r2 = await createMerkleRoot(leaves);
            expect(r1).toBe(r2);
            expect(r1).toHaveLength(64); // SHA-256 hex
        });

        test('order of leaves matters', async () => {
            const l1 = ['a', 'b'];
            const l2 = ['b', 'a'];
            const r1 = await createMerkleRoot(l1);
            const r2 = await createMerkleRoot(l2);
            expect(r1).not.toBe(r2);
        });

        test('empty leaves returns empty string', async () => {
            expect(await createMerkleRoot([])).toBe('');
        });

        test('single leaf returns its own hash', async () => {
            const leaf = 'test';
            const root = await createMerkleRoot([leaf]);
            const hash = await computeHash(leaf);
            expect(root).toBe(hash);
        });

        test('odd number of leaves handles duplication correctly', async () => {
            const l1 = ['a', 'b', 'c'];
            // Merkle tree for [a,b,c] should be H(H(a,b) + H(c,c))
            const r1 = await createMerkleRoot(l1);
            expect(r1).toHaveLength(64);
            
            const hA = await computeHash('a');
            const hB = await computeHash('b');
            const hC = await computeHash('c');
            const hAB = await computeHash(hA + hB);
            const hCC = await computeHash(hC + hC);
            const expectedRoot = await computeHash(hAB + hCC);
            
            expect(r1).toBe(expectedRoot);
        });
    });
});
