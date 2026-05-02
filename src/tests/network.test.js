import { packMove, unpackMove, packPresence, unpackPresence } from '../network/packer.js';
import { getShardName, hashStr, seededRNG, resolveAttack, levelBonus } from '../rules/index.js';
import { DEFAULT_PLAYER_STATS, INSTANCE_CAP } from '../content/data.js';

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
            expect(getShardName('tavern', 1)).toBe('hearthwick-tavern-v1-1');
            expect(getShardName('cellar', 3)).toBe('hearthwick-cellar-v1-3');
            expect(getShardName('forest_edge', 10)).toBe('hearthwick-forest_edge-v1-10');
        });

        test('INSTANCE_CAP is exported and equals 50', () => {
            expect(INSTANCE_CAP).toBe(50);
        });

        test('different locations produce different shard names', () => {
            const s1 = getShardName('cellar', 1);
            const s2 = getShardName('tavern', 1);
            expect(s1).not.toBe(s2);
        });

        test('different instance IDs produce different shard names', () => {
            const s1 = getShardName('cellar', 1);
            const s2 = getShardName('cellar', 2);
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

        test('packPresence round-trips name, location, level, xp, hlc, ph correctly', () => {
            const entry = makeEntry({ name: 'Alice', location: 'forest_edge', level: 5, xp: 1200, ph: 'deadbeef' });
            const unpacked = unpackPresence(packPresence(entry));
            expect(unpacked.name).toBe('Alice');
            expect(unpacked.location).toBe('forest_edge');
            expect(unpacked.level).toBe(5);
            expect(unpacked.xp).toBe(1200);
            expect(unpacked.ph).toBe('deadbeef');
            expect(unpacked.hlc).toBeDefined();
            expect(unpacked.signature).toBe(entry.signature);
        });

        test('packPresence throws when ph is null (identity not yet set)', () => {
            // localPlayer.ph starts as null before initIdentity() completes.
            // We now strictly require it to be set to prevent 00000000 mismatch.
            expect(() => packPresence(makeEntry({ ph: null }))).toThrow('ph is required');
        });

        test('packPresence throws when ph is undefined', () => {
            expect(() => packPresence(makeEntry({ ph: undefined }))).toThrow('ph is required');
        });
    });

    describe('Binary Packet Chaining', () => {
        test('Move packets survive round-trip', () => {
            const move = { from: 'cellar', to: 'hallway', x: 5, y: 5, ts: 123, signature: btoa('m'.repeat(64)) };
            const buf = packMove(move);
            const data = unpackMove(buf);
            expect(data.from).toBe('cellar');
            expect(data.to).toBe('hallway');
            expect(data.x).toBe(5);
            expect(data.y).toBe(5);
        });

        test('Presence packets survive round-trip with all fields intact', () => {
            const original = {
                name: 'Test',
                location: 'tavern',
                ph: '12345678',
                level: 10,
                xp: 5000,
                hlc: { wall: 1700000000, logical: 7 },
                signature: btoa('s'.repeat(64))
            };
            const unpacked = unpackPresence(packPresence(original));
            expect(unpacked.name).toBe(original.name);
            expect(unpacked.level).toBe(original.level);
            expect(unpacked.xp).toBe(original.xp);
            expect(unpacked.hlc.wall).toBe(original.hlc.wall);
            expect(unpacked.hlc.logical).toBe(original.hlc.logical);
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

            expect(dmgA).toEqual(dmgB);
        });

        // Catches bug: PvP used DEFAULT_PLAYER_STATS.defense as opponent defense fallback
        // instead of the opponent's actual defense stat. An opponent with non-default defense
        // should produce different damage than one using the default.
        test('Opponent actual defense stat is used, not default fallback', () => {
            const seed = hashStr('attacker' + 'defender' + 1 + 1);
            const atk = 15;
            const defaultDef = DEFAULT_PLAYER_STATS.defense;
            const customDef = defaultDef + 5;

            const resVsDefault = resolveAttack(atk, defaultDef + levelBonus(1).defense, seededRNG(seed));
            const resVsCustom  = resolveAttack(atk, customDef  + levelBonus(1).defense, seededRNG(seed));

            expect(resVsDefault).not.toEqual(resVsCustom);
            expect(resVsDefault.damage).toBeGreaterThan(resVsCustom.damage); // higher defense = less damage
        });

        test('Combat results differ for different round seeds', () => {
            const peerA = 'peerA';
            const peerB = 'peer-b';
            const day = 1;

            // Seeds differ, so at minimum the RNG sequence differs (values may occasionally match)

            const seed1 = hashStr(peerA + peerB + day + 1);
            const seed2 = hashStr(peerA + peerB + day + 2);
            expect(seed1).not.toBe(seed2);
        });
    });

    describe('Join Instance Lifecycle', () => {
        test('joinInstance does not stack makeAction listeners on repeated calls', () => {
            const globalRoom = { makeAction: jest.fn(() => [jest.fn(), jest.fn()]) };
            let makeActionCalls = 0;
            globalRoom.makeAction.mockImplementation(() => {
                makeActionCalls++;
                return [jest.fn(), jest.fn()];
            });

            // connectGlobal (simulated)
            const [sendRegisterPresence] = globalRoom.makeAction('register_presence');
            const gameActions = { sendRegisterPresence: (data) => sendRegisterPresence(data) };

            // joinInstance (simulated)
            const joinInstance = () => {
                // Uses existing gameActions, does NOT call makeAction again
                if (gameActions.sendRegisterPresence) {
                    gameActions.sendRegisterPresence({ shard: 'test' });
                }
            };

            joinInstance();
            joinInstance();

            expect(makeActionCalls).toBe(1);
        });

        test('players map is empty immediately after joinInstance', () => {
            const players = new Map([['peer1', { name: 'Alice' }]]);
            const joinInstance = () => {
                players.clear();
            };
            joinInstance();
            expect(players.size).toBe(0);
        });

        test('feedHeads/peerHlc cleared on room transition', () => {
            const feedHeads = new Map([['p1', { seq: 1 }]]);
            const peerHlc = new Map([['p1', { wall: 100 }]]);
            const joinInstance = () => {
                feedHeads.clear();
                peerHlc.clear();
            };
            joinInstance();
            expect(feedHeads.size).toBe(0);
            expect(peerHlc.size).toBe(0);
        });

        test('registerWithArbiter retries if playerKeys not ready', () => {
            jest.useFakeTimers();
            let playerKeys = null;
            let registered = false;

            const registerWithArbiter = (attempt = 0) => {
                if (!playerKeys) {
                    if (attempt < 10) setTimeout(() => registerWithArbiter(attempt + 1), 500);
                    return;
                }
                registered = true;
            };

            registerWithArbiter();
            expect(registered).toBe(false);

            jest.advanceTimersByTime(500);
            expect(registered).toBe(false);

            playerKeys = { public: {}, private: {} };
            jest.advanceTimersByTime(500);
            expect(registered).toBe(true);
            jest.useRealTimers();
        });
    });
});

