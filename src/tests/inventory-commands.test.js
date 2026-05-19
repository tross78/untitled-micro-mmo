import { jest } from '@jest/globals';
import { handleCommand } from '../commands/index.js';
import { localPlayer, worldState } from '../state/store.js';
import { bus } from '../state/eventbus.js';
import { appRuntime } from '../app/runtime.js';
import { gameActions } from '../network/index.js';

jest.mock('../state/persistence.js', () => ({ saveLocalState: jest.fn() }));
jest.mock('../ui/index.js', () => ({
    log: jest.fn(), printStatus: jest.fn(), triggerShake: jest.fn(), getHealthBar: jest.fn(() => '[HHH]')
}));
jest.mock('../network/index.js', () => ({
    gameActions: { sendMove: jest.fn(), sendPresenceSingle: jest.fn(), sendMonsterDmg: jest.fn(), sendActionLog: jest.fn(), sendTradeOffer: jest.fn() },
    joinInstance: jest.fn().mockResolvedValue(null),
    preJoinShard: jest.fn(),
    currentInstance: 1,
    currentRtcConfig: {}
}));
jest.mock('../rules/index.js', () => {
    const original = jest.requireActual('../rules/index.js');
    return { ...original, getNPCLocation: jest.fn(() => null), getTimeOfDay: jest.fn(() => 'day') };
});
jest.mock('../security/identity.js', () => ({
    playerKeys: { privateKey: null, publicKey: null },
    myEntry: jest.fn().mockResolvedValue(null),
    exportKey: jest.fn().mockResolvedValue('test-key'),
}));
jest.mock('../security/crypto.js', () => ({
    signMessage: jest.fn().mockResolvedValue('test-sig'),
    verifyMessage: jest.fn().mockResolvedValue(true),
}));

const resetPlayer = () => {
    Object.assign(localPlayer, {
        hp: 50, maxHp: 50, gold: 100, inventory: [], quests: {},
        location: 'cellar', x: 5, y: 5, level: 1, xp: 0,
        statusEffects: [], equipped: { weapon: null, armor: null },
        currentEnemy: null, forestFights: 15, combatRound: 0, bankedGold: 0,
    });
    worldState.seed = 'test-seed';
    worldState.day = 1;
    appRuntime.hydratePlayer(localPlayer);
    appRuntime.initSystems(localPlayer, gameActions);
};

describe('Inventory Commands', () => {
    let emitSpy;
    beforeEach(() => { emitSpy = jest.spyOn(bus, 'emit'); resetPlayer(); });
    afterEach(() => { emitSpy.mockRestore(); jest.clearAllMocks(); });

    describe('equip', () => {
        test('equips a weapon by item name', async () => {
            localPlayer.inventory = ['iron_sword'];
            await handleCommand('equip iron sword');
            expect(localPlayer.equipped.weapon).toBe('iron_sword');
        });

        test('equips armor by item name', async () => {
            localPlayer.inventory = ['leather_armor'];
            await handleCommand('equip leather armor');
            expect(localPlayer.equipped.armor).toBe('leather_armor');
        });

        test('equips armor by item id', async () => {
            localPlayer.inventory = ['iron_armor'];
            await handleCommand('equip iron_armor');
            expect(localPlayer.equipped.armor).toBe('iron_armor');
        });

        test('rejects equip when item not in inventory', async () => {
            await handleCommand('equip iron sword');
            expect(localPlayer.equipped.weapon).toBeNull();
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining("don't have") }));
        });

        test('rejects equipping non-equipable item', async () => {
            localPlayer.inventory = ['potion'];
            await handleCommand('equip health potion');
            expect(localPlayer.equipped.weapon).toBeNull();
            expect(localPlayer.equipped.armor).toBeNull();
        });

        test('equip with no arg shows usage message', async () => {
            await handleCommand('equip');
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Usage') }));
        });
    });

    describe('inventory', () => {
        test('shows empty pack message when inventory is empty', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('empty'));
        });

        test('lists items in inventory', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['potion', 'iron_sword'];
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Health Potion'), expect.any(String));
        });

        test('shows weapon bonus label for weapons', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['iron_sword'];
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('+3 ATK'), expect.any(String));
        });

        test('shows armor bonus label for armor', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['leather_armor'];
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('+2 DEF'), expect.any(String));
        });

        test('shows [EQUIPPED] label for equipped items', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['iron_sword'];
            localPlayer.equipped.weapon = 'iron_sword';
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('[EQUIPPED]'), expect.any(String));
        });

        test('shows stacked count for duplicate items', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['potion', 'potion', 'potion'];
            await handleCommand('inventory');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('x3'), expect.any(String));
        });
    });

    describe('use', () => {
        test('potion heals hp', async () => {
            localPlayer.hp = 30;
            localPlayer.inventory = ['potion'];
            await handleCommand('use health potion');
            expect(localPlayer.hp).toBe(50); // 30 + 20 = 50 (cap)
            expect(localPlayer.inventory).not.toContain('potion');
        });

        test('potion does not exceed max hp', async () => {
            localPlayer.hp = 45;
            localPlayer.inventory = ['potion'];
            await handleCommand('use health potion');
            expect(localPlayer.hp).toBe(50);
        });

        test('healing elixir heals 45hp', async () => {
            localPlayer.hp = 1;
            localPlayer.inventory = ['healing_elixir'];
            await handleCommand('use healing elixir');
            expect(localPlayer.hp).toBe(46);
            expect(localPlayer.inventory).not.toContain('healing_elixir');
        });

        test('antidote clears poisoned status', async () => {
            localPlayer.statusEffects = [{ id: 'poisoned', duration: 3 }];
            localPlayer.inventory = ['antidote'];
            await handleCommand('use antidote');
            expect(localPlayer.statusEffects.find(s => s.id === 'poisoned')).toBeUndefined();
        });

        test('energizing meal adds meal_boost status effect', async () => {
            localPlayer.inventory = ['energizing_meal'];
            await handleCommand('use energizing meal');
            const effect = localPlayer.statusEffects.find(s => s.id === 'meal_boost');
            expect(effect).toBeDefined();
            expect(effect.atkBonus).toBe(5);
        });

        test('strength elixir (buff type) adds strength_elixir status effect', async () => {
            localPlayer.inventory = ['strength_elixir'];
            await handleCommand('use strength elixir');
            // defineItem sets item.id = 'strength_elixir', so effectId = 'strength_elixir'
            const effect = localPlayer.statusEffects.find(s => s.id === 'strength_elixir');
            expect(effect).toBeDefined();
            expect(effect.atkBonus).toBe(5);
        });

        test('coal torch adds coal_torch buff', async () => {
            localPlayer.inventory = ['coal_torch'];
            await handleCommand('use coal torch');
            const effect = localPlayer.statusEffects.find(s => s.id === 'coal_torch');
            expect(effect).toBeDefined();
            expect(effect.duration).toBe(50);
        });

        test('rejects using item not in inventory', async () => {
            await handleCommand('use health potion');
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining("don't have") }));
        });

        test('rejects using non-consumable item', async () => {
            localPlayer.inventory = ['wood'];
            await handleCommand('use wood bundle');
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining("can't use") }));
        });
    });

    describe('drop', () => {
        test('drops item from inventory', async () => {
            localPlayer.inventory = ['potion'];
            await handleCommand('drop health potion');
            expect(localPlayer.inventory).not.toContain('potion');
        });

        test('drop with no arg shows usage', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('drop');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
        });

        test('drop unknown item shows error', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('drop nonexistent');
            expect(log).toHaveBeenCalledWith(expect.stringContaining("don't have"));
        });

        test('dropping equipped weapon unequips it', async () => {
            localPlayer.inventory = ['iron_sword'];
            localPlayer.equipped.weapon = 'iron_sword';
            await handleCommand('drop iron sword');
            expect(localPlayer.equipped.weapon).toBeNull();
        });

        test('dropping equipped armor unequips it', async () => {
            localPlayer.inventory = ['leather_armor'];
            localPlayer.equipped.armor = 'leather_armor';
            await handleCommand('drop leather armor');
            expect(localPlayer.equipped.armor).toBeNull();
        });
    });

    describe('craft', () => {
        test('shows recipes when called with no args', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('craft');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('CRAFTING'), expect.any(String));
        });

        test('crafting iron sword at market succeeds', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['iron', 'iron', 'iron', 'wood', 'wood'];
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('craft iron sword');
            expect(localPlayer.inventory).toContain('iron_sword');
        });

        test('crafting fails without required materials', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.location = 'market';
            localPlayer.inventory = ['iron']; // not enough
            await handleCommand('craft iron sword');
            expect(log).toHaveBeenCalledWith(expect.stringContaining("don't have"));
            expect(localPlayer.inventory).not.toContain('iron_sword');
        });

        test('crafting fails outside required location', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.location = 'cellar';
            localPlayer.inventory = ['iron', 'iron', 'iron', 'wood', 'wood'];
            await handleCommand('craft iron sword');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('must be at'));
            expect(localPlayer.inventory).not.toContain('iron_sword');
        });

        test('crafting advances craft quest progress', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['iron', 'iron', 'iron', 'wood', 'wood'];
            localPlayer.quests.craft_sword = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('craft iron sword');
            expect(localPlayer.quests.craft_sword.progress).toBe(1);
        });

        test('craft unknown item shows error', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('craft nonexistent');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Unknown recipe'));
        });
    });
});
