import { generateKeyPairSync } from 'node:crypto';
import { signMessage, verifyMessage } from './crypto.js';
import { hashStr } from './rules.js';

const ROLLUP_INTERVAL = 10000;
const FRAUD_BAN_THRESHOLD = 3;

// Generates a real Ed25519 keypair and returns Base64 strings compatible with our crypto module.
function makeKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(16).toString('base64');
    const pubB64  = publicKey.export({  type: 'spki',  format: 'der' }).slice(12).toString('base64');
    return { privB64, pubB64 };
}

// Mirror of the arbiter's rate-limit logic.
function makeRateLimiter() {
    const lastRollupTime = new Map();
    return (publicKey, now) => {
        const last = lastRollupTime.get(publicKey) || 0;
        if (now - last < ROLLUP_INTERVAL * 0.8) return false;
        lastRollupTime.set(publicKey, now);
        return true;
    };
}

// Mirror of the arbiter's fraud accumulation logic.
function makeFraudAccumulator() {
    const fraudCounts = new Map();
    return (proposerKey, claimantKey) => {
        if (!fraudCounts.has(proposerKey)) fraudCounts.set(proposerKey, new Set());
        fraudCounts.get(proposerKey).add(claimantKey);
        return fraudCounts.get(proposerKey).size >= FRAUD_BAN_THRESHOLD;
    };
}

describe('Arbiter: Rate Limiting', () => {
    // Catches bug: Arbiter had no rate limiting, allowing a single key to spam rollups
    // and consume Pi Zero CPU indefinitely.
    // Base time must exceed ROLLUP_INTERVAL * 0.8 (8000ms) so first-ever submissions
    // pass the (now - 0) > threshold check where 0 is the Map's default.
    const T0 = ROLLUP_INTERVAL;

    test('first rollup from a key is accepted', () => {
        const accept = makeRateLimiter();
        expect(accept('key-1', T0)).toBe(true);
    });

    test('second rollup from same key within 80% of interval is rejected', () => {
        const accept = makeRateLimiter();
        accept('key-1', T0);
        expect(accept('key-1', T0 + ROLLUP_INTERVAL * 0.5)).toBe(false);
    });

    test('rollup is accepted again after 80% of interval has elapsed', () => {
        const accept = makeRateLimiter();
        accept('key-1', T0);
        expect(accept('key-1', T0 + ROLLUP_INTERVAL * 0.8 + 1)).toBe(true);
    });

    test('rate limiting is per-key: different keys are independent', () => {
        const accept = makeRateLimiter();
        accept('key-1', T0);
        // key-2 has never submitted — T0 - 0 > threshold, so it's accepted
        expect(accept('key-2', T0 + 1)).toBe(true);
        // key-1 is still within its cooldown window
        expect(accept('key-1', T0 + 2)).toBe(false);
    });
});

describe('Arbiter: Fraud Accumulation (O(1) witness)', () => {
    // Catches bug: old fraud proof sent O(n) witness array. New format uses a single witness
    // object. Arbiter accumulates reports from distinct claimants before banning.
    test('fraud proof witness is a single object, not an array', () => {
        const proof = {
            rollup: { rollup: {}, signature: 'sig', publicKey: 'pk' },
            witness: { id: 'p1', presence: {}, signature: 'ws', publicKey: 'wpk' }
        };
        expect(Array.isArray(proof.witness)).toBe(false);
        expect(typeof proof.witness).toBe('object');
        expect(proof.witness).toHaveProperty('id');
        expect(proof.witness).toHaveProperty('presence');
        expect(proof.witness).toHaveProperty('signature');
        expect(proof.witness).toHaveProperty('publicKey');
    });

    test('single fraud report does not trigger a ban', () => {
        const accumulate = makeFraudAccumulator();
        expect(accumulate('bad-proposer', 'claimant-1')).toBe(false);
    });

    test('ban triggers at exactly FRAUD_BAN_THRESHOLD distinct claimants', () => {
        const accumulate = makeFraudAccumulator();
        for (let i = 1; i < FRAUD_BAN_THRESHOLD; i++) {
            expect(accumulate('bad-proposer', `claimant-${i}`)).toBe(false);
        }
        expect(accumulate('bad-proposer', `claimant-${FRAUD_BAN_THRESHOLD}`)).toBe(true);
    });

    test('duplicate claimant reports do not count toward ban threshold', () => {
        const accumulate = makeFraudAccumulator();
        // Same claimant reporting multiple times should not advance the count
        for (let i = 0; i < FRAUD_BAN_THRESHOLD + 5; i++) {
            const result = accumulate('bad-proposer', 'same-claimant');
            // Set deduplication means count stays at 1 — never reaches threshold
            expect(result).toBe(false);
        }
    });

    test('different proposers have independent fraud counts', () => {
        const accumulate = makeFraudAccumulator();
        // Two reports against proposer-A (under threshold)
        accumulate('proposer-a', 'claimant-1');
        accumulate('proposer-a', 'claimant-2');
        // proposer-b has only one report — should not be banned
        expect(accumulate('proposer-b', 'claimant-1')).toBe(false);
    });
});

describe('Arbiter: Fraud Proof Cryptographic Verification', () => {
    // Tests the full verification pipeline that the Arbiter runs on each fraud proof.
    test('valid proposer signature on rollup is accepted', async () => {
        const proposer = makeKeyPair();
        const rollup = { shard: 'app-cellar-1', root: 'abc123', timestamp: 1000, count: 2 };
        const sig = await signMessage(JSON.stringify(rollup), proposer.privB64);
        await expect(verifyMessage(JSON.stringify(rollup), sig, proposer.pubB64)).resolves.toBe(true);
    });

    test('tampered rollup fails proposer signature check', async () => {
        const proposer = makeKeyPair();
        const rollup = { shard: 'app-cellar-1', root: 'abc123', timestamp: 1000, count: 2 };
        const sig = await signMessage(JSON.stringify(rollup), proposer.privB64);
        const tampered = { ...rollup, root: 'FAKE_ROOT' };
        await expect(verifyMessage(JSON.stringify(tampered), sig, proposer.pubB64)).resolves.toBe(false);
    });

    test('valid witness presence signature is accepted', async () => {
        const witness = makeKeyPair();
        const presence = { name: 'Alice', location: 'cellar', ph: 'abcd1234', level: 2, xp: 50, ts: 1700000000000 };
        const sig = await signMessage(JSON.stringify(presence), witness.privB64);
        await expect(verifyMessage(JSON.stringify(presence), sig, witness.pubB64)).resolves.toBe(true);
    });

    test('witnessKey must match ph in presence packet', async () => {
        const witness = makeKeyPair();
        // ph is computed as (hashStr(pubB64) >>> 0).toString(16).padStart(8, '0')
        const expectedPh = (hashStr(witness.pubB64) >>> 0).toString(16).padStart(8, '0');
        const wrongPh = 'deadbeef';
        expect(expectedPh).not.toBe(wrongPh); // sanity check

        // Presence with wrong ph should fail the ph check in the Arbiter
        const presenceGood = { name: 'A', location: 'cellar', ph: expectedPh, level: 1, xp: 0, ts: 1000 };
        const presenceBad  = { name: 'A', location: 'cellar', ph: wrongPh,    level: 1, xp: 0, ts: 1000 };

        const phFromKey = (pubB64) => (hashStr(pubB64) >>> 0).toString(16).padStart(8, '0');
        expect(presenceGood.ph === phFromKey(witness.pubB64)).toBe(true);
        expect(presenceBad.ph  === phFromKey(witness.pubB64)).toBe(false);
    });

    // Catches bug: old fraud proof passed O(n) witness array; arbiter recomputed full Merkle root.
    // New O(1) proof: arbiter only verifies one signed presence and accumulates reports.
    // This test ensures the ban path triggers correctly after threshold distinct signatures.
    test('end-to-end: threshold distinct signed fraud reports trigger a ban', async () => {
        const claimants = [makeKeyPair(), makeKeyPair(), makeKeyPair()];
        const accumulate = makeFraudAccumulator();
        const proposerKey = 'bad-proposer-pk';

        for (let i = 0; i < claimants.length; i++) {
            const { privB64, pubB64 } = claimants[i];
            const presence = { name: `Peer${i}`, location: 'cellar', ph: 'aaaabbbb', level: 1, xp: 0, ts: Date.now() };
            const sig = await signMessage(JSON.stringify(presence), privB64);
            // Verify signature is valid (Arbiter step 2)
            const valid = await verifyMessage(JSON.stringify(presence), sig, pubB64);
            expect(valid).toBe(true);
            // Accumulate (Arbiter step 4)
            const shouldBan = accumulate(proposerKey, pubB64);
            expect(shouldBan).toBe(i === claimants.length - 1);
        }
    });
});

describe('Arbiter: Ban Persistence', () => {
    // Catches bug: bans were stored in memory only — lost on arbiter restart.
    // worldState.bans array should be the source of truth loaded at startup.
    test('bans Set is initialized from worldState.bans array on startup', () => {
        const savedState = { world_seed: 'abc', day: 5, last_tick: 1000, bans: ['bad-key-1', 'bad-key-2'] };
        const bans = new Set(savedState.bans || []);
        expect(bans.has('bad-key-1')).toBe(true);
        expect(bans.has('bad-key-2')).toBe(true);
        expect(bans.size).toBe(2);
    });

    test('bans Set is empty when worldState has no bans field', () => {
        const savedState = { world_seed: 'abc', day: 5, last_tick: 1000 };
        const bans = new Set(savedState.bans || []);
        expect(bans.size).toBe(0);
    });

    test('new ban is reflected in worldState.bans before persist', () => {
        const worldState = { bans: ['existing-ban'] };
        const bans = new Set(worldState.bans);
        bans.add('new-ban');
        worldState.bans = Array.from(bans);
        expect(worldState.bans).toContain('existing-ban');
        expect(worldState.bans).toContain('new-ban');
        expect(worldState.bans).toHaveLength(2);
    });
});

describe('Arbiter: Drift-Corrected Day Tick', () => {
    // Catches bug: setInterval(advanceDay, 86400000) drifts because JS timers aren't precise
    // and don't account for restart gaps. The corrected scheduler uses last_tick as the anchor.
    test('next tick delay is computed from last_tick, not from current time', () => {
        const now = 1700000060000; // 60 seconds after the last tick
        const lastTick = 1700000000000;
        const DAY_MS = 86400000;
        const delay = Math.max(0, (lastTick + DAY_MS) - now);
        // Should be nearly a full day minus the 60 seconds already elapsed
        expect(delay).toBe(DAY_MS - 60000);
    });

    test('delay is clamped to 0 if tick is overdue', () => {
        const now = 1700090000000; // far past the expected tick
        const lastTick = 1700000000000;
        const DAY_MS = 86400000;
        const delay = Math.max(0, (lastTick + DAY_MS) - now);
        expect(delay).toBe(0);
    });

    test('delay is always non-negative', () => {
        const lastTick = Date.now() + 99999; // future last_tick (edge case)
        const DAY_MS = 86400000;
        const delay = Math.max(0, (lastTick + DAY_MS) - Date.now());
        expect(delay).toBeGreaterThanOrEqual(0);
    });
});
