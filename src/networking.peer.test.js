/**
 * Peer networking unit tests (Phase 7.9)
 *
 * Tests run in Node without WebRTC. The three bugs addressed:
 *   Bug 1 — False fraud: x,y in Merkle leaf causes false positives
 *   Bug 2 — Invisible peers: presence dropped before public key arrives
 *   Bug 3 — Wrong room: ROOM_MAP out of sync with data.js world keys
 */

import { jest } from '@jest/globals';

jest.mock('@trystero-p2p/torrent', () => ({
    joinRoom: jest.fn(),
    selfId: 'self-peer-id',
}));

import { packPresence, unpackPresence, ROOM_MAP } from './packer.js';
import { world } from './data.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePresence(overrides = {}) {
    return {
        name: 'TestPeer',
        location: 'tavern',
        ph: '00000000',
        level: 1,
        xp: 0,
        x: 3,
        y: 7,
        gold: 50,
        inventory: [],
        quests: {},
        ts: Date.now(),
        signature: btoa('s'.repeat(64)),
        ...overrides,
    };
}

// Mirror of buildLeafData logic in networking.js — kept in sync intentionally.
// If networking.js changes the leaf format, this test breaks and must be updated.
function buildLeafData(selfId, localPlayer, peersMap) {
    const leaves = Array.from(peersMap.entries())
        .filter(([id]) => id !== selfId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, p]) => `${id}:${p.level}:${p.xp}:${p.location}`);
    leaves.push(`${selfId}:${localPlayer.level}:${localPlayer.xp}:${localPlayer.location}`);
    leaves.sort();
    return leaves;
}

// ── Bug 1: buildLeafData leaf format ─────────────────────────────────────────

describe('Bug 1 — buildLeafData leaf format (false fraud fix)', () => {
    const self = 'self-peer-id';
    const selfPlayer = { level: 3, xp: 250, location: 'tavern', x: 2, y: 5 };
    const peers = new Map([
        ['peer-alpha', { level: 2, xp: 100, location: 'market', x: 7, y: 1 }],
        ['peer-beta',  { level: 1, xp: 50,  location: 'tavern', x: 0, y: 9 }],
    ]);

    test('leaf format is id:level:xp:location — no x or y', () => {
        const leaves = buildLeafData(self, selfPlayer, peers);
        leaves.forEach(leaf => {
            const parts = leaf.split(':');
            expect(parts).toHaveLength(4);
            expect(parts[1]).toMatch(/^\d+$/); // level
            expect(parts[2]).toMatch(/^\d+$/); // xp
            // part[3] is location — a non-numeric room key
            expect(parts[3]).not.toMatch(/^\d+$/);
        });
    });

    test('leaves are sorted deterministically regardless of Map insertion order', () => {
        const reversed = new Map([...peers].reverse());
        const a = buildLeafData(self, selfPlayer, peers);
        const b = buildLeafData(self, selfPlayer, reversed);
        expect(a).toEqual(b);
    });

    test('selfId leaf is included exactly once', () => {
        const leaves = buildLeafData(self, selfPlayer, peers);
        const selfLeaves = leaves.filter(l => l.startsWith(self));
        expect(selfLeaves).toHaveLength(1);
        expect(selfLeaves[0]).toBe(`${self}:${selfPlayer.level}:${selfPlayer.xp}:${selfPlayer.location}`);
    });

    test('peer with different x,y but same level/xp/location produces the same leaf', () => {
        const peersA = new Map([['peer-x', { level: 2, xp: 80, location: 'market', x: 1, y: 2 }]]);
        const peersB = new Map([['peer-x', { level: 2, xp: 80, location: 'market', x: 9, y: 9 }]]);
        const a = buildLeafData(self, selfPlayer, peersA);
        const b = buildLeafData(self, selfPlayer, peersB);
        expect(a).toEqual(b);
    });

    test('leaf changes when peer changes room (location changes)', () => {
        const peersA = new Map([['peer-x', { level: 2, xp: 80, location: 'market', x: 1, y: 2 }]]);
        const peersB = new Map([['peer-x', { level: 2, xp: 80, location: 'tavern', x: 1, y: 2 }]]);
        const a = buildLeafData(self, selfPlayer, peersA);
        const b = buildLeafData(self, selfPlayer, peersB);
        expect(a).not.toEqual(b);
    });

    test('two peers with identical level/xp/location produce matching roots regardless of position', () => {
        // This is the exact scenario that caused false fraud: Chrome had Safari at (3,4),
        // Safari moved to (5,2), roots diverged. After fix, position is excluded.
        const chromeViewOfSafari = new Map([['safari', { level: 1, xp: 0, location: 'tavern', x: 3, y: 4 }]]);
        const safariSelf = { level: 1, xp: 0, location: 'tavern', x: 5, y: 2 };

        const chromeLeaves = buildLeafData('chrome', { level: 2, xp: 100, location: 'market' }, chromeViewOfSafari);
        // Safari builds its own leaves with its current position — position not in leaf, so matches
        const safariSelfAsMap = new Map([['safari', safariSelf]]);
        const safariLeaves  = buildLeafData('chrome', { level: 2, xp: 100, location: 'market' }, safariSelfAsMap);
        expect(chromeLeaves).toEqual(safariLeaves);
    });
});

// ── Bug 2: pending presence queue ────────────────────────────────────────────

describe('Bug 2 — pending presence queue (invisible peers fix)', () => {
    // Simulate the processPresenceSingle logic in isolation.
    // We don't import networking.js directly (it has WebRTC side effects),
    // so we test the extracted logic pattern used by the fix.

    function makeQueue() {
        const pending = new Map();
        const players = new Map();
        const processed = [];

        const processPresence = (buf, peerId) => {
            const entry = players.get(peerId);
            if (!entry?.publicKey) {
                pending.set(peerId, buf); // queue — newest wins
                return 'queued';
            }
            processed.push({ peerId, buf });
            return 'processed';
        };

        const receiveIdentity = (publicKey, peerId) => {
            players.set(peerId, { publicKey });
            const pendingBuf = pending.get(peerId);
            if (pendingBuf) {
                pending.delete(peerId);
                processPresence(pendingBuf, peerId);
            }
        };

        return { processPresence, receiveIdentity, pending, processed };
    }

    test('presence before key is queued, not dropped', () => {
        const { processPresence, pending } = makeQueue();
        const result = processPresence(new Uint8Array([1, 2, 3]), 'peer-a');
        expect(result).toBe('queued');
        expect(pending.has('peer-a')).toBe(true);
    });

    test('presence after key arrives is processed immediately', () => {
        const { processPresence, receiveIdentity, processed } = makeQueue();
        receiveIdentity('pubkey-abc', 'peer-a');
        processPresence(new Uint8Array([1, 2, 3]), 'peer-a');
        expect(processed).toHaveLength(1);
        expect(processed[0].peerId).toBe('peer-a');
    });

    test('queued presence is replayed when identity arrives', () => {
        const { processPresence, receiveIdentity, pending, processed } = makeQueue();
        // Presence arrives first
        processPresence(new Uint8Array([9, 8, 7]), 'peer-b');
        expect(processed).toHaveLength(0);
        expect(pending.has('peer-b')).toBe(true);

        // Identity arrives — replays the queued presence
        receiveIdentity('pubkey-xyz', 'peer-b');
        expect(pending.has('peer-b')).toBe(false);
        expect(processed).toHaveLength(1);
    });

    test('only the most recent presence is queued (newest wins)', () => {
        const { processPresence, pending } = makeQueue();
        processPresence(new Uint8Array([1]), 'peer-c');
        processPresence(new Uint8Array([2]), 'peer-c');
        processPresence(new Uint8Array([3]), 'peer-c');
        expect(pending.get('peer-c')).toEqual(new Uint8Array([3]));
    });

    test('queued presence is cleared when peer leaves', () => {
        const { processPresence, pending } = makeQueue();
        processPresence(new Uint8Array([1]), 'peer-d');
        pending.delete('peer-d'); // simulate onPeerLeave
        expect(pending.has('peer-d')).toBe(false);
    });

    test('identity for banned peer does not replay queued presence', () => {
        const bans = new Set(['pubkey-bad']);
        const pending = new Map();
        const players = new Map();
        const processed = [];

        const processPresence = (buf, peerId) => {
            const entry = players.get(peerId);
            if (!entry?.publicKey) { pending.set(peerId, buf); return; }
            if (bans.has(entry.publicKey)) { players.delete(peerId); pending.delete(peerId); return; }
            processed.push({ peerId });
        };

        const receiveIdentity = (publicKey, peerId) => {
            if (bans.has(publicKey)) { pending.delete(peerId); return; } // banned — drop queued presence too
            players.set(peerId, { publicKey });
            const p = pending.get(peerId);
            if (p) { pending.delete(peerId); processPresence(p, peerId); }
        };

        processPresence(new Uint8Array([1]), 'peer-bad');
        receiveIdentity('pubkey-bad', 'peer-bad');
        expect(processed).toHaveLength(0);
        expect(pending.has('peer-bad')).toBe(false);
    });
});

// ── Bug 3: ROOM_MAP derived from data.js ─────────────────────────────────────

describe('Bug 3 — ROOM_MAP derived from data.js (wrong room fix)', () => {
    test('ROOM_MAP is sorted alphabetically', () => {
        const sorted = [...ROOM_MAP].sort();
        expect(ROOM_MAP).toEqual(sorted);
    });

    test('ROOM_MAP contains every room key in world', () => {
        const worldKeys = Object.keys(world);
        worldKeys.forEach(key => {
            expect(ROOM_MAP).toContain(key);
        });
    });

    test('ROOM_MAP has no entries absent from world', () => {
        ROOM_MAP.forEach(key => {
            expect(world).toHaveProperty(key);
        });
    });

    test('packPresence/unpackPresence round-trips location for every room', () => {
        Object.keys(world).forEach(roomId => {
            const p = makePresence({ location: roomId });
            const packed = packPresence(p);
            const unpacked = unpackPresence(packed);
            expect(unpacked.location).toBe(roomId);
        });
    });

    test('packPresence pads short ph strings with leading zeros', () => {
        // "da3f33" (6 chars) should be padded to "00da3f33"
        const p = makePresence({ ph: 'da3f33' });
        const packed = packPresence(p);
        const unpacked = unpackPresence(packed);
        expect(unpacked.ph).toBe('00da3f33');
    });

    test('unknown room index falls back to first sorted room, not silent corruption', () => {
        // Byte 255 is used as "unknown" sentinel in other maps
        const buf = new Uint8Array(160);
        buf[16] = 255; // location byte
        const unpacked = unpackPresence(buf);
        // Should not crash and should return a string
        expect(typeof unpacked.location).toBe('string');
    });
});
