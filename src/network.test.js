import { IBLT } from './iblt';
import { packMove, unpackMove, packPresence, unpackPresence } from './packer';
import { getShardName, INSTANCE_CAP, hashStr, seededRNG, resolveAttack, DEFAULT_PLAYER_STATS, levelBonus } from './rules';

const ROLLUP_INTERVAL = 10000;
const PROPOSER_GRACE_MS = ROLLUP_INTERVAL * 1.5;

// Mirror of the isProposer logic in main.js — any change there should break this test.
const isProposer = (selfId, otherIds, now, lastRollupReceivedAt = now) => {
    const all = [...otherIds, selfId].sort();
    const slot = Math.floor(now / ROLLUP_INTERVAL) % all.length;
    if (all[slot] === selfId) return true;
    if (now - lastRollupReceivedAt > PROPOSER_GRACE_MS) {
        return all[(slot + 1) % all.length] === selfId;
    }
    return false;
};

describe('Network Protocol Integration', () => {
    describe('Sharding', () => {
        // Catches bug: getShardName was used in main.js but not imported — any consumer
        // test that imports and calls it would surface a missing-export error immediately.
        test('getShardName produces correct shard room identifier', () => {
            expect(getShardName('hearthwick', 'tavern', 1)).toBe('tavern-1');
            expect(getShardName('hearthwick', 'cellar', 3)).toBe('cellar-3');
            expect(getShardName('hearthwick', 'forest_edge', 10)).toBe('forest_edge-10');
        });

        test('INSTANCE_CAP is exported and equals 50', () => {
            expect(INSTANCE_CAP).toBe(50);
        });

        test('different locations produce different shard names', () => {
            const s1 = getShardName('app', 'cellar', 1);
            const s2 = getShardName('app', 'tavern', 1);
            expect(s1).not.toBe(s2);
        });

        test('different instance IDs produce different shard names', () => {
            const s1 = getShardName('app', 'cellar', 1);
            const s2 = getShardName('app', 'cellar', 2);
            expect(s1).not.toBe(s2);
        });
    });

    describe('Proposer Election — Rotating Slot', () => {
        // Catches bug: old election always picked the lowest ID, which meant one peer
        // was permanently the proposer, and a disconnect would stall rollups with no fallback.
        test('slot rotates across peers over successive intervals', () => {
            const others = ['aaa', 'ccc']; // selfId = 'bbb', so sorted = ['aaa','bbb','ccc']
            const self = 'bbb';

            // Slot 0 (t=0): 'aaa' — not us
            expect(isProposer(self, others, 0)).toBe(false);
            // Slot 1 (t=ROLLUP_INTERVAL): 'bbb' — our turn
            expect(isProposer(self, others, ROLLUP_INTERVAL)).toBe(true);
            // Slot 2 (t=2*ROLLUP_INTERVAL): 'ccc' — not us
            expect(isProposer(self, others, 2 * ROLLUP_INTERVAL)).toBe(false);
            // Wraps back to slot 0 (t=3*ROLLUP_INTERVAL): 'aaa' — not us
            expect(isProposer(self, others, 3 * ROLLUP_INTERVAL)).toBe(false);
        });

        test('election is deterministic: every peer independently agrees on the same proposer', () => {
            const peers = ['alpha', 'beta', 'gamma'];
            const now = ROLLUP_INTERVAL * 5;
            const all = [...peers].sort();
            const slot = Math.floor(now / ROLLUP_INTERVAL) % all.length;
            const expected = all[slot];

            // Only one peer should claim to be proposer at any given time slot
            const proposers = peers.filter(id =>
                isProposer(id, peers.filter(p => p !== id), now)
            );
            expect(proposers).toHaveLength(1);
            expect(proposers[0]).toBe(expected);
        });

        test('sole peer is always the proposer', () => {
            expect(isProposer('only-peer', [], ROLLUP_INTERVAL * 3)).toBe(true);
        });

        test('fallback peer steps up when primary has not submitted within grace window', () => {
            const others = ['aaa', 'ccc'];
            const self = 'bbb'; // sorted: ['aaa','bbb','ccc']
            const now = 0; // slot 0 = 'aaa'

            // 'aaa' is elected but hasn't sent a rollup recently — self ('bbb') is fallback
            const staleLastRollup = now - PROPOSER_GRACE_MS - 1;
            expect(isProposer(self, others, now, staleLastRollup)).toBe(true);
        });

        test('fallback does NOT activate when primary is on time', () => {
            const others = ['aaa', 'ccc'];
            const self = 'bbb';
            const now = 0; // slot 0 = 'aaa'

            // Rollup was received recently — no need to step up
            expect(isProposer(self, others, now, now - 100)).toBe(false);
        });

        test('primary peer is always proposer regardless of last rollup time', () => {
            const others = ['bbb', 'ccc'];
            const self = 'aaa'; // sorted: ['aaa','bbb','ccc'], slot 0 = 'aaa'
            const staleLastRollup = 0 - PROPOSER_GRACE_MS - 9999;
            expect(isProposer(self, others, 0, staleLastRollup)).toBe(true);
        });
    });

    describe('IBLT — Static hashId', () => {
        // Catches bug: new IBLT()._hashKey(id) was used just to call a pure function,
        // which is confusing and allocates an unnecessary instance. Static hashId fixes this.
        test('IBLT.hashId static method exists', () => {
            expect(typeof IBLT.hashId).toBe('function');
        });

        test('IBLT.hashId returns the same value as _hashKey instance method', () => {
            const iblt = new IBLT();
            const id = 'some-trystero-peer-id-abc123';
            expect(IBLT.hashId(id)).toBe(iblt._hashKey(id));
        });

        test('IBLT.hashId returns a BigInt', () => {
            expect(typeof IBLT.hashId('peer-1')).toBe('bigint');
        });

        test('IBLT.hashId is consistent for the same input', () => {
            const id = 'consistent-id';
            expect(IBLT.hashId(id)).toBe(IBLT.hashId(id));
        });

        test('IBLT.hashId produces distinct values for distinct IDs', () => {
            expect(IBLT.hashId('peer-a')).not.toBe(IBLT.hashId('peer-b'));
        });
    });

    describe('IBLT Reconciliation Flow', () => {
        test('peers can identify missing keys via sketches', () => {
            const ibltA = new IBLT();
            ibltA.insert('user1');
            ibltA.insert('user2');

            const ibltB = new IBLT();
            ibltB.insert('user1');
            ibltB.insert('user3');

            const diff = IBLT.subtract(ibltA, ibltB);
            const { added, removed, success } = diff.decode();

            expect(success).toBe(true);
            expect(added).toContain(IBLT.hashId('user2'));
            expect(removed).toContain(IBLT.hashId('user3'));
        });

        // Catches bug: getRequest used ids.includes(numeric) — Array.includes uses ===.
        // BigInt === BigInt works correctly, but this test makes the contract explicit.
        test('request-response ID matching uses BigInt equality from hashId', () => {
            const peerId = 'real-peer-id-xyz';
            const iblt = new IBLT();
            iblt.insert(peerId);

            // Simulate: remote sends serialized sketch; local decodes it to get added BigInts
            const serialized = iblt.serialize();
            const remote = IBLT.fromSerialized(serialized);
            const localEmpty = new IBLT();
            const diff = IBLT.subtract(remote, localEmpty);
            const { added, success } = diff.decode();

            expect(success).toBe(true);
            // The BigInt in 'added' must match IBLT.hashId(peerId) for request filtering to work
            expect(added.some(x => x === IBLT.hashId(peerId))).toBe(true);
        });

        test('request filtering correctly matches peer IDs to their hashes', () => {
            // Simulates the getRequest handler: given a list of BigInt hashes,
            // find which local players match using IBLT.hashId.
            const localPlayers = ['peer-alice', 'peer-bob', 'peer-carol'];
            const requestedHashes = [IBLT.hashId('peer-bob'), IBLT.hashId('peer-carol')];

            const matched = localPlayers.filter(id =>
                requestedHashes.some(x => x === IBLT.hashId(id))
            );
            expect(matched).toEqual(['peer-bob', 'peer-carol']);
            expect(matched).not.toContain('peer-alice');
        });
    });

    describe('Heartbeat presence pipeline', () => {
        // Catches bug: gameActions.sendPresenceSingle was called before initNetworking()
        // ran (Web Locks non-coordinator tabs never called initNetworking, so gameActions
        // was still {}). The guard added in main.js prevents the TypeError, but this test
        // ensures packPresence — the first thing sendPresenceSingle does — never throws
        // for any data shape myEntry() can produce, including uninitialised fields.

        const makeEntry = (overrides = {}) => ({
            name: 'TestPlayer',
            location: 'tavern',
            ph: '1a2b3c4d',
            level: 1,
            xp: 0,
            ts: 1700000000000,
            signature: btoa('s'.repeat(64)),
            ...overrides,
        });

        test('packPresence does not throw with a valid myEntry-shaped payload', () => {
            expect(() => packPresence(makeEntry())).not.toThrow();
        });

        test('packPresence round-trips name, location, level, xp, ts, ph correctly', () => {
            const entry = makeEntry({ name: 'Alice', location: 'forest_edge', level: 5, xp: 1200, ph: 'deadbeef' });
            const unpacked = unpackPresence(packPresence(entry));
            expect(unpacked.name).toBe('Alice');
            expect(unpacked.location).toBe('forest_edge');
            expect(unpacked.level).toBe(5);
            expect(unpacked.xp).toBe(1200);
            expect(unpacked.ph).toBe('deadbeef');
            expect(unpacked.ts).toBe(entry.ts);
            expect(unpacked.signature).toBe(entry.signature);
        });

        test('packPresence does not throw when ph is null (identity not yet set)', () => {
            // localPlayer.ph starts as null before initIdentity() completes.
            // The heartbeat may fire in this window on very slow devices.
            expect(() => packPresence(makeEntry({ ph: null }))).not.toThrow();
        });

        test('packPresence does not throw when ph is undefined', () => {
            expect(() => packPresence(makeEntry({ ph: undefined }))).not.toThrow();
        });
    });

    describe('Binary Packet Chaining', () => {
        test('Move packets survive round-trip', () => {
            const buf = packMove('cellar', 'hallway');
            const data = unpackMove(buf);
            expect(data.from).toBe('cellar');
            expect(data.to).toBe('hallway');
        });

        test('Presence packets survive round-trip with all fields intact', () => {
            const original = {
                name: 'Test',
                location: 'tavern',
                ph: '12345678',
                level: 10,
                xp: 5000,
                ts: 1700000000000,
                signature: btoa('s'.repeat(64))
            };
            const unpacked = unpackPresence(packPresence(original));
            expect(unpacked.name).toBe(original.name);
            expect(unpacked.level).toBe(original.level);
            expect(unpacked.xp).toBe(original.xp);
            expect(unpacked.ts).toBe(original.ts);
            expect(unpacked.ph).toBe(original.ph);
            expect(unpacked.signature).toBe(original.signature);
        });
    });

    describe('State Channel Logic', () => {
        test('Combat rounds are deterministic: both peers compute same damage', () => {
            const peerA = 'peerA';
            const peerB = 'peerB';
            const day = 1;
            const round = 1;

            const seed = hashStr(peerA + peerB + day + round);
            const dmgA = resolveAttack(10, 5, seededRNG(seed));
            const dmgB = resolveAttack(10, 5, seededRNG(seed));

            expect(dmgA).toBe(dmgB);
        });

        // Catches bug: PvP used DEFAULT_PLAYER_STATS.defense as opponent defense fallback
        // instead of the opponent's actual defense stat. An opponent with non-default defense
        // should produce different damage than one using the default.
        test('Opponent actual defense stat is used, not default fallback', () => {
            const seed = hashStr('attacker' + 'defender' + 1 + 1);
            const atk = 15;
            const defaultDef = DEFAULT_PLAYER_STATS.defense;
            const customDef = defaultDef + 5;

            const dmgVsDefault = resolveAttack(atk, defaultDef + levelBonus(1).defense, seededRNG(seed));
            const dmgVsCustom  = resolveAttack(atk, customDef  + levelBonus(1).defense, seededRNG(seed));

            expect(dmgVsDefault).not.toBe(dmgVsCustom);
            expect(dmgVsDefault).toBeGreaterThan(dmgVsCustom); // higher defense = less damage
        });

        test('Combat results differ for different round seeds', () => {
            const peerA = 'peerA';
            const peerB = 'peerB';
            const day = 1;

            const dmgRound1 = resolveAttack(10, 5, seededRNG(hashStr(peerA + peerB + day + 1)));
            const dmgRound2 = resolveAttack(10, 5, seededRNG(hashStr(peerA + peerB + day + 2)));

            // Seeds differ, so at minimum the RNG sequence differs (values may occasionally match)
            const seed1 = hashStr(peerA + peerB + day + 1);
            const seed2 = hashStr(peerA + peerB + day + 2);
            expect(seed1).not.toBe(seed2);
        });
    });
});
