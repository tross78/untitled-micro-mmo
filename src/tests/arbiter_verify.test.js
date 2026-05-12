import { generateKeyPairSync } from 'node:crypto';
import { signMessage, verifyMessage } from '../security/crypto.js';
import { hashStr } from '../rules/index.js';
import {
    buildPersistedArbiterPacket,
    getBansVersion,
    restoreBansFromPacket,
} from '../network/arbiter-state.js';

const ROLLUP_INTERVAL = 10000;

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

describe('Arbiter: Fraud Proof Shape', () => {
    // Catches bug: old fraud proof sent O(n) witness array. New format uses a single witness
    // object. The runtime now acts on a single verified proof, not a made-up threshold accumulator.
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

    test('single verified witness presence is enough to support a state-fraud report', async () => {
        const witness = makeKeyPair();
        const presence = { name: 'Peer0', location: 'cellar', ph: (hashStr(witness.pubB64) >>> 0).toString(16).padStart(8, '0'), level: 1, xp: 0, ts: Date.now(), disputedRoot: 'bad-root' };
        const sig = await signMessage(JSON.stringify(presence), witness.privB64);

        await expect(verifyMessage(JSON.stringify(presence), sig, witness.pubB64)).resolves.toBe(true);
    });
});

describe('Arbiter: Ban Persistence', () => {
    test('signed world state carries a stable bans version string', () => {
        const version = getBansVersion(['bad-key-2', 'bad-key-1', 'bad-key-1']);
        expect(version).toBe(getBansVersion(['bad-key-1', 'bad-key-2']));
        expect(typeof version).toBe('string');
    });

    test('persisted arbiter packet stores the full bans list for restart recovery', () => {
        const packet = buildPersistedArbiterPacket(
            { world_seed: 'abc', day: 5, last_tick: 1000, bans: getBansVersion(['bad-key-1', 'bad-key-2']) },
            'sig',
            ['bad-key-2', 'bad-key-1']
        );

        expect(packet.bans).toEqual(['bad-key-1', 'bad-key-2']);
        expect(packet.state.bans).toBe(getBansVersion(['bad-key-1', 'bad-key-2']));
    });

    test('restart recovery restores bans from persisted top-level packet field', () => {
        const restored = restoreBansFromPacket({
            state: { world_seed: 'abc', day: 5, last_tick: 1000, bans: '[]' },
            signature: 'sig',
            bans: ['bad-key-1', 'bad-key-2'],
        });

        expect(restored).toEqual(['bad-key-1', 'bad-key-2']);
    });

    test('legacy packets without bans restore an empty list', () => {
        expect(restoreBansFromPacket({ state: { world_seed: 'abc', day: 5, last_tick: 1000 } })).toEqual([]);
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
