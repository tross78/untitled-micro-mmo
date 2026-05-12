/**
 * Phase 8.6 Spirit Audit — Complex interactions and edge cases.
 */
import { deriveWorldState, getScarcityMultiplier, getDynamicRoomDescription } from '../rules/index.js';
import { getBuyPrice, getSellPrice } from '../commands/helpers.js';
import { worldState } from '../state/store.js';
import { ITEMS } from '../content/data.js';

describe('Phase 8.6 Spirit Audit — Economic Stacking', () => {
    beforeEach(() => {
        worldState.scarcity = [];
        worldState.surplus = [];
        worldState.event = null;
    });

    test('scarcity and market_surplus stack correctly on buy price', () => {
        // base price 10
        // scarcity: 10 * 1.5 = 15
        // market_surplus: 15 * 0.8 = 12
        ITEMS.wheat.price = 10;
        worldState.scarcity = ['wheat'];
        worldState.event = { type: 'market_surplus' };
        
        expect(getBuyPrice('wheat')).toBe(12);
    });

    test('surplus and market_surplus stack correctly on buy price', () => {
        // base price 10
        // surplus: 10 * 0.7 = 7
        // market_surplus: 7 * 0.8 = 5.6 -> ceil 6
        ITEMS.wheat.price = 10;
        worldState.surplus = ['wheat'];
        worldState.event = { type: 'market_surplus' };
        
        expect(getBuyPrice('wheat')).toBe(6);
    });

    test('bounty_hunt doubles the bountyPrice override', () => {
        // bandit_mask bountyPrice: 15
        // bounty_hunt: 15 * 2 = 30
        ITEMS.bandit_mask.bountyPrice = 15;
        worldState.event = { type: 'bounty_hunt' };
        
        expect(getSellPrice('bandit_mask')).toBe(30);
    });
});

describe('Phase 8.6 Spirit Audit — Event Influence', () => {
    test('scarcity_spike increases scarcity count', () => {
        for (let day = 1; day <= 100; day++) {
            const ws = deriveWorldState('audit', day);
            if (ws.event?.type === 'scarcity_spike') {
                expect(ws.scarcity.length).toBeGreaterThanOrEqual(2);
            }
            if (ws.event?.type === 'market_surplus') {
                expect(ws.surplus.length).toBeGreaterThanOrEqual(1);
            }
        }
    });
});

describe('Phase 8.6 Spirit Audit — Immersion', () => {
    test('dynamic descriptions change based on event zone', () => {
        const room = { id: 'catacombs', zone: 'dungeon', description: 'Dusty.' };
        const ws = { event: { type: 'ancient_tremor' } };
        expect(getDynamicRoomDescription(room, ws)).toContain('[Tremor]');
        
        const ws2 = { event: { type: 'wolf_pack' } };
        expect(getDynamicRoomDescription(room, ws2)).not.toContain('[Hunt]'); // wolf_pack doesn't affect catacombs
    });
});
