import { IBLT } from './iblt';
import { packMove, unpackMove, packPresence, unpackPresence } from './packer';

describe('Network Protocol Integration', () => {
    describe('Proposer Election', () => {
        test('peers deterministically elect the lowest ID', () => {
            const peers = ['abc', 'def', '123', 'ghi'].sort();
            const elected = peers[0];
            expect(elected).toBe('123');
            
            const isProposer = (selfId, others) => {
                const all = [...others, selfId].sort();
                return selfId === all[0];
            };

            expect(isProposer('123', ['abc', 'def', 'ghi'])).toBe(true);
            expect(isProposer('abc', ['123', 'def', 'ghi'])).toBe(false);
        });
    });

    describe('IBLT Reconciliation Flow', () => {
        test('peers can identify missing keys via sketches', () => {
            // Peer A has [user1, user2]
            const ibltA = new IBLT();
            ibltA.insert('user1');
            ibltA.insert('user2');

            // Peer B has [user1, user3]
            const ibltB = new IBLT();
            ibltB.insert('user1');
            ibltB.insert('user3');

            // B receives A's sketch and subtracts
            const diff = IBLT.subtract(ibltA, ibltB);
            const { added, removed, success } = diff.decode();

            expect(success).toBe(true);
            
            // From B's perspective:
            // 'added' (positive count) are keys A has but B doesn't (user2)
            // 'removed' (negative count) are keys B has but A doesn't (user3)
            const keyUser2 = ibltA._hashKey('user2');
            const keyUser3 = ibltA._hashKey('user3');

            expect(added).toContain(keyUser2);
            expect(removed).toContain(keyUser3);
        });
    });

    describe('Binary Packet Chaining', () => {
        test('Move packets survive round-trip', () => {
            const buf = packMove('cellar', 'hallway');
            const data = unpackMove(buf);
            expect(data.from).toBe('cellar');
            expect(data.to).toBe('hallway');
        });

        test('Presence packets survive round-trip', () => {
            const original = {
                name: 'Test',
                location: 'tavern',
                ph: '12345678',
                level: 10,
                xp: 5000,
                ts: Date.now(),
                signature: btoa('s'.repeat(64))
            };
            const buf = packPresence(original);
            const unpacked = unpackPresence(buf);
            
            expect(unpacked.name).toBe(original.name);
            expect(unpacked.level).toBe(original.level);
            expect(unpacked.ph).toBe(original.ph);
        });
    });

    describe('State Channel Logic', () => {
        test('Combat rounds advance deterministically', () => {
            const peerA = 'peerA';
            const peerB = 'peerB';
            const day = 1;
            const round = 1;
            
            const { hashStr, seededRNG, resolveAttack } = require('./rules');
            
            // Both peers calculate round result
            const seed = hashStr(peerA + peerB + day + round);
            const rngA = seededRNG(seed);
            const rngB = seededRNG(seed);
            
            const dmgA = resolveAttack(10, 5, rngA);
            const dmgB = resolveAttack(10, 5, rngB);
            
            expect(dmgA).toBe(dmgB);
        });
    });
});
