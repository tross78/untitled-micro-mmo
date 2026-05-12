/**
 * Phase 8.6d — Shared-World Arbiter Events: balancing and validation tests.
 */
import { deriveWorldState, getWeatherEffect, getScarcityMultiplier } from '../rules/index.js';
import { getNPCDialogue } from '../rules/social.js';

// ─── Determinism ─────────────────────────────────────────────────────────────

describe('deriveWorldState — determinism', () => {
    test('same seed+day always produces same result', () => {
        const a = deriveWorldState('abc123', 10);
        const b = deriveWorldState('abc123', 10);
        expect(a).toEqual(b);
    });

    test('different days produce different results', () => {
        const a = deriveWorldState('abc123', 1);
        const b = deriveWorldState('abc123', 2);
        expect(a.day).not.toEqual(b.day);
    });

    test('surplus and scarcity never overlap', () => {
        for (let day = 1; day <= 50; day++) {
            const ws = deriveWorldState('testseed', day);
            const overlap = (ws.surplus || []).filter(id => (ws.scarcity || []).includes(id));
            expect(overlap).toHaveLength(0);
        }
    });
});

// ─── Event frequency ─────────────────────────────────────────────────────────

describe('deriveWorldState — event frequency', () => {
    test('no event on more than ~40% of days (base weight 30/100)', () => {
        let noEventCount = 0;
        const DAYS = 200;
        for (let day = 1; day <= DAYS; day++) {
            const ws = deriveWorldState('freqtest', day);
            if (!ws.event) noEventCount++;
        }
        expect(noEventCount / DAYS).toBeGreaterThan(0.15);
        expect(noEventCount / DAYS).toBeLessThan(0.65);
    });

    test('wandering_boss only appears at threatLevel >= 5 (day >= 35)', () => {
        for (let day = 1; day < 35; day++) {
            const ws = deriveWorldState('bosstest', day);
            expect(ws.event?.type).not.toBe('wandering_boss');
        }
    });

    test('late-game days still keep non-boss event variety', () => {
        const seen = new Set();
        for (let day = 35; day <= 220; day++) {
            const ws = deriveWorldState('bosstest', day);
            if (ws.event) seen.add(ws.event.type);
        }
        expect(seen).toContain('wandering_boss');
        expect([...seen].some(type => type && type !== 'wandering_boss')).toBe(true);
    });

    test('all known event types appear in the event table', () => {
        const seen = new Set();
        for (let day = 1; day <= 500; day++) {
            const ws = deriveWorldState('eventtypes', day);
            if (ws.event) seen.add(ws.event.type);
        }
        ['market_surplus', 'scarcity_spike', 'bounty_hunt', 'wandering_trader', 'wolf_pack', 'ancient_tremor', 'wandering_boss'].forEach(t => {
            expect(seen).toContain(t);
        });
    });
});

// ─── Scarcity / surplus price effects ────────────────────────────────────────

describe('getScarcityMultiplier', () => {
    test('scarce item returns 1.5 multiplier', () => {
        const ws = { scarcity: ['herbs'], surplus: [] };
        expect(getScarcityMultiplier('herbs', ws)).toBe(1.5);
    });

    test('surplus item returns 0.7 multiplier', () => {
        const ws = { scarcity: [], surplus: ['bread'] };
        expect(getScarcityMultiplier('bread', ws)).toBe(0.7);
    });

    test('normal item returns 1.0', () => {
        const ws = { scarcity: [], surplus: [] };
        expect(getScarcityMultiplier('iron', ws)).toBe(1);
    });
});

// ─── Weather effects ─────────────────────────────────────────────────────────

describe('getWeatherEffect', () => {
    test('storm doubles forest fight cost', () => {
        expect(getWeatherEffect('storm').forestFightCostMult).toBe(2);
    });

    test('fog gives 20% enemy miss chance', () => {
        expect(getWeatherEffect('fog').enemyMissChance).toBe(20);
    });

    test('clear weather returns null', () => {
        expect(getWeatherEffect('clear')).toBeNull();
    });
});

// ─── NPC contextual dialogue ─────────────────────────────────────────────────

describe('getNPCDialogue — contextual lines', () => {
    test('barkeep mentions surplus during market_surplus event', () => {
        const ws = { event: { type: 'market_surplus' }, weather: 'clear', scarcity: [], surplus: [], season: 'spring' };
        const line = getNPCDialogue('barkeep', 'seed', 1, 'weary', 'tavern', ws);
        expect(line.toLowerCase()).toMatch(/market|surplus|price|stock/);
    });

    test('guard mentions bounty during bounty_hunt event', () => {
        const ws = { event: { type: 'bounty_hunt' }, weather: 'clear', scarcity: [], surplus: [], season: 'spring' };
        const line = getNPCDialogue('guard', 'seed', 1, 'weary', 'cellar', ws);
        expect(line.toLowerCase()).toMatch(/bounty|bandit|contraband|pay/);
    });

    test('merchant mentions storm during storm weather', () => {
        const ws = { event: null, weather: 'storm', scarcity: [], surplus: [], season: 'summer' };
        const line = getNPCDialogue('merchant', 'seed', 1, 'weary', 'market_square', ws);
        expect(line.toLowerCase()).toMatch(/storm|weather|customer|slow/);
    });

    test('falls back to Markov corpus when no contextual match', () => {
        const ws = { event: null, weather: 'clear', scarcity: [], surplus: [], season: 'autumn' };
        const line = getNPCDialogue('bard', 'seed', 1, 'joyful', 'tavern', ws);
        expect(typeof line).toBe('string');
        expect(line.length).toBeGreaterThan(0);
    });

    test('location dialogue still takes priority over event lines', () => {
        const ws = { event: { type: 'market_surplus' }, weather: 'storm', scarcity: [], surplus: [], season: 'winter' };
        const line = getNPCDialogue('guard', 'seed', 1, 'fearful', 'forest_edge', ws);
        expect(line).toContain(`I wouldn't head in there without a decent weapon and something to eat.`);
    });
});

// ─── Dynamic Room Descriptions ───────────────────────────────────────────────

import { getDynamicRoomDescription } from '../rules/index.js';

describe('getDynamicRoomDescription', () => {
    const mockRoom = { id: 'ruins', zone: 'dungeon', description: 'Old stones.' };

    test('adds tremor flavor to dungeons during ancient_tremor', () => {
        const ws = { event: { type: 'ancient_tremor' } };
        const desc = getDynamicRoomDescription(mockRoom, ws);
        expect(desc).toMatch(/tremor|earth groans/i);
        expect(desc).toMatch(/Old stones/);
    });

    test('adds danger flavor to ruins during wandering_boss', () => {
        const ws = { event: { type: 'wandering_boss' } };
        const desc = getDynamicRoomDescription(mockRoom, ws);
        expect(desc).toMatch(/danger|footprints/i);
    });

    test('adds storm flavor to wilderness rooms', () => {
        const wildRoom = { id: 'forest_edge', zone: 'wilderness', description: 'Trees.' };
        const ws = { weather: 'storm' };
        const desc = getDynamicRoomDescription(wildRoom, ws);
        expect(desc).toMatch(/storm|rain lashes/i);
    });
});
