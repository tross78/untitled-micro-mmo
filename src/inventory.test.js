import { handleCommand, getBestGear } from './commands.js';
import { localPlayer, worldState } from './store.js';
import { QUESTS, ITEMS } from './data.js';
import { bus } from './eventbus.js';
import { log } from './ui.js';

// Mocking dependencies
jest.mock('./persistence.js', () => ({
    saveLocalState: jest.fn()
}));

jest.mock('./ui.js', () => ({
    log: jest.fn(),
    printStatus: jest.fn(),
    triggerShake: jest.fn(),
    getHealthBar: jest.fn(() => '[HHH]')
}));

jest.mock('./networking.js', () => ({
    gameActions: {
        sendMove: jest.fn(),
        sendEmote: jest.fn(),
        sendPresenceSingle: jest.fn(),
        sendMonsterDmg: jest.fn(),
        sendActionLog: jest.fn()
    },
    joinInstance: jest.fn().mockResolvedValue(null),
    currentInstance: 1,
    currentRtcConfig: {}
}));

jest.mock('./rules.js', () => {
    const original = jest.requireActual('./rules.js');
    return {
        ...original,
        getNPCLocation: jest.fn((id) => {
            if (id === 'guard') return 'hallway';
            if (id === 'merchant') return 'market';
            if (id === 'herbalist') return 'herbalist_hut';
            if (id === 'sage') return 'ruins';
            return null;
        }),
        getTimeOfDay: jest.fn(() => 'day'),
    };
});

describe('Inventory System (Phase 7.85)', () => {
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, 'emit');
        // Reset player state
        Object.assign(localPlayer, {
            hp: 50, maxHp: 50, gold: 100, inventory: [], quests: {},
            location: 'cellar', x: 5, y: 5, level: 1, xp: 0,
            statusEffects: [], equipped: { weapon: null, armor: null },
            currentEnemy: null, forestFights: 15, combatRound: 0,
            buffs: { rested: false, activeElixir: null }
        });
        worldState.seed = 'test-seed';
        worldState.day = 1;
        worldState.threatLevel = 1;
    });

    afterEach(() => {
        emitSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe('pickup', () => {
        test('picking up an item in a room with loot adds it to inventory', async () => {
            localPlayer.location = 'cellar';
            const { shardEnemies } = await import('./store.js');
            shardEnemies.set('cellar', { hp: 0, loot: ['potion'] });

            await handleCommand('pickup');
            expect(localPlayer.inventory).toContain('potion');
            // item:pickup event sends the item definition, which doesn't necessarily have the id property in data.js
            // but our command.js might have added it or the test matches on name.
            expect(emitSpy).toHaveBeenCalledWith('item:pickup', expect.objectContaining({ 
                item: expect.objectContaining({ name: 'Health Potion' }) 
            }));
        });

        test('picking up gold adds directly to gold balance', async () => {
            localPlayer.location = 'cellar';
            localPlayer.gold = 10;
            const { shardEnemies } = await import('./store.js');
            shardEnemies.set('cellar', { hp: 0, loot: ['gold'] }); 

            await handleCommand('pickup');
            expect(localPlayer.gold).toBe(15); // gold item is 5 gold
            expect(localPlayer.inventory).not.toContain('gold');
        });

        test('picking up in a room with no loot emits a not-found message', async () => {
            localPlayer.location = 'cellar';
            const { shardEnemies } = await import('./store.js');
            shardEnemies.delete('cellar');
            await handleCommand('pickup');
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringMatching(/nothing/i) }));
        });
    });

    describe('drop', () => {
        test('drop removes item from inventory', async () => {
            localPlayer.inventory = ['potion', 'iron_sword'];
            await handleCommand('drop health potion');
            expect(localPlayer.inventory).not.toContain('potion');
            expect(localPlayer.inventory).toContain('iron_sword');
        });

        test('dropping an equipped item unequips it', async () => {
            localPlayer.inventory = ['iron_sword'];
            localPlayer.equipped.weapon = 'iron_sword';
            await handleCommand('drop iron sword');
            expect(localPlayer.inventory).not.toContain('iron_sword');
            expect(localPlayer.equipped.weapon).toBeNull();
        });
    });

    describe('use', () => {
        test('use potion increases HP (capped at maxHp)', async () => {
            localPlayer.inventory = ['potion'];
            localPlayer.hp = 20;
            await handleCommand('use health potion');
            expect(localPlayer.hp).toBe(40); // 20 + 20
            expect(localPlayer.inventory).not.toContain('potion');
        });

        test('use strength_elixir adds buff', async () => {
            localPlayer.inventory = ['strength_elixir'];
            await handleCommand('use strength elixir');
            expect(localPlayer.buffs.activeElixir).toBe('strength_elixir');
            expect(localPlayer.inventory).not.toContain('strength_elixir');
        });
    });

    describe('equip / getBestGear', () => {
        test('getBestGear selects highest-attack weapon in inventory', () => {
            localPlayer.inventory = ['iron_sword', 'steel_sword'];
            const bonus = getBestGear();
            expect(bonus.weaponBonus).toBe(6); // steel_sword
        });

        test('manual equipment overrides auto-equip if it exists', async () => {
            localPlayer.inventory = ['iron_sword', 'steel_sword'];
            await handleCommand('equip iron sword');
            expect(localPlayer.equipped.weapon).toBe('iron_sword');
        });
    });

    describe('sell', () => {
        test('sell removes item and adds gold at merchant', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wolf_pelt'];
            localPlayer.gold = 0;
            await handleCommand('sell wolf pelt');
            expect(localPlayer.inventory).not.toContain('wolf_pelt');
            expect(localPlayer.gold).toBe(2); // 40% of 5
        });
    });

    describe('inventory command', () => {
        test('inventory grouping works for multiples', async () => {
            localPlayer.inventory = ['potion', 'potion', 'iron_sword'];
            await handleCommand('inventory');
            const groupedLog = log.mock.calls.some(call => 
                call[0].includes('Health Potion') && call[0].includes('x2')
            );
            expect(groupedLog).toBe(true);
        });
    });

    describe('crafting', () => {
        test('crafting consumes ingredients and adds result', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood', 'iron', 'iron'];
            await handleCommand('craft iron sword');
            expect(localPlayer.inventory).toContain('iron_sword');
            expect(localPlayer.inventory.filter(id => id === 'iron').length).toBe(0);
            expect(localPlayer.inventory.filter(id => id === 'wood').length).toBe(0);
        });

        test('cannot craft if missing ingredients', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood'];
            await handleCommand('craft iron sword');
            expect(localPlayer.inventory).not.toContain('iron_sword');
            expect(localPlayer.inventory).toContain('wood');
        });

        test('cannot craft if at wrong location', async () => {
            localPlayer.location = 'cellar';
            localPlayer.inventory = ['wood', 'iron', 'iron'];
            await handleCommand('craft iron sword');
            expect(localPlayer.inventory).not.toContain('iron_sword');
        });
    });

    describe('fetch quests', () => {
        test('fetch quest progress updates when item is granted', async () => {
            localPlayer.quests['tome_collection'] = { progress: 0, completed: false };
            const { grantItem } = await import('./commands.js');
            grantItem('old_tome');
            expect(localPlayer.quests['tome_collection'].progress).toBe(1);
        });
    });
});
