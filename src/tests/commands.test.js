import { jest } from '@jest/globals';
import { handleCommand, getBestGear } from '../commands/index.js';
import { localPlayer, worldState, shardEnemies } from '../state/store.js';
import { bus } from '../state/eventbus.js';
import { appRuntime } from '../app/runtime.js';
import { gameActions } from '../network/index.js';
import { QUESTS } from '../content/data.js';

// Mocking dependencies
jest.mock('../state/persistence.js', () => ({
    saveLocalState: jest.fn()
}));

jest.mock('../ui/index.js', () => ({
    log: jest.fn(),
    printStatus: jest.fn(),
    triggerShake: jest.fn(),
    getHealthBar: jest.fn(() => '[HHH]')
}));

jest.mock('../network/index.js', () => ({
    gameActions: {
        sendMove: jest.fn(),
        sendPresenceSingle: jest.fn(),
        sendMonsterDmg: jest.fn(),
        sendActionLog: jest.fn()
    },
    joinInstance: jest.fn().mockResolvedValue(null),
    preJoinShard: jest.fn(),
    currentInstance: 1,
    currentRtcConfig: {}
}));

jest.mock('../rules/index.js', () => {
    const original = jest.requireActual('../rules/index.js');
    return {
        ...original,
        getNPCLocation: jest.fn((id) => {
            if (id === 'guard') return 'hallway';
            if (id === 'barkeep') return 'tavern';
            if (id === 'bard') return 'tavern';
            if (id === 'sage') return 'ruins';
            if (id === 'merchant') return 'market';
            return null;
        }),
        getTimeOfDay: jest.fn(() => 'day'),
    };
});

describe('Game Commands (Phase 7.5 Audit)', () => {
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, 'emit');
        // Reset player state
        Object.assign(localPlayer, {
            hp: 50, maxHp: 50, gold: 100, inventory: [], quests: {},
            location: 'cellar', x: 5, y: 5, level: 1, xp: 0,
            statusEffects: [], equipped: { weapon: null, armor: null },
            currentEnemy: null, forestFights: 15, combatRound: 0,
        });
        worldState.seed = 'test-seed';
        worldState.day = 1;
        shardEnemies.clear();
        
        appRuntime.hydratePlayer(localPlayer);
        appRuntime.initSystems(localPlayer, gameActions);
    });

    const step = () => {
        appRuntime.update(0.016);
    };

    afterEach(() => {
        emitSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe('Equipment System', () => {
        test('getBestGear calculates bonuses from inventory', () => {
            localPlayer.inventory = ['iron_sword', 'leather_armor'];
            const bonus = getBestGear();
            expect(bonus.weaponBonus).toBe(3); // iron_sword
            expect(bonus.defenseBonus).toBe(2); // leather_armor
        });

        test('equip command sets explicit equipment slots', async () => {
            localPlayer.inventory = ['iron_sword'];
            await handleCommand('equip iron sword');
            expect(localPlayer.equipped.weapon).toBe('iron_sword');
        });
    });

    describe('Death & Respawn', () => {
        test('dying drops 10% gold and teleports to cellar with 5 HP', async () => {
            localPlayer.gold = 100;
            localPlayer.location = 'forest_edge';
            localPlayer.hp = 0;
            
            // Sync store to ECS
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('die');
            step(); // Process die intent (handled by CombatSystem.handlePlayerDeath)
            
            expect(localPlayer.gold).toBe(90);
            expect(localPlayer.location).toBe('cellar');
            expect(localPlayer.hp).toBe(5);
            expect(emitSpy).toHaveBeenCalledWith('combat:death', { entity: 'You' });
        });
    });

    describe('Interactions', () => {
        test('talk works for static room NPCs even when patrol location differs', async () => {
            const rules = await import('../rules/index.js');
            rules.getNPCLocation.mockImplementation((id) => {
                if (id === 'sage') return 'forest_edge';
                if (id === 'guard') return 'hallway';
                if (id === 'barkeep') return 'tavern';
                if (id === 'bard') return 'tavern';
                if (id === 'merchant') return 'market';
                return null;
            });

            localPlayer.location = 'ruins';
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('talk sage');

            expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({ npcName: 'Sage' }));
        });

        test('interact command talks to NPC if present', async () => {
            localPlayer.location = 'hallway'; // Guard is here
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('interact');
            step();
            expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({ npcName: 'Guard' }));
            expect(emitSpy).toHaveBeenCalledWith('ui:queue-menu', expect.objectContaining({ type: 'npc', context: expect.objectContaining({ npcId: 'guard' }) }));
        });

        test('talking to a merchant speaks first and queues the npc menu', async () => {
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('talk merchant');

            expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({ npcName: 'Merchant' }));
            expect(emitSpy).toHaveBeenCalledWith('ui:queue-menu', expect.objectContaining({ type: 'npc', context: expect.objectContaining({ npcId: 'merchant' }) }));
        });

        test('interact command uses portal if no NPC present', async () => {
            localPlayer.location = 'cellar';
            localPlayer.x = 5; localPlayer.y = 0; // Portal to hallway
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('interact');
            step();
            expect(localPlayer.location).toBe('hallway');
        });

        test('walking into an NPC does not overlap and opens interaction', async () => {
            localPlayer.location = 'hallway';
            localPlayer.x = 1;
            localPlayer.y = 2;
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('move east');
            step();
            step();

            expect(localPlayer.x).toBe(1);
            expect(localPlayer.y).toBe(2);
            expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({ npcName: 'Guard' }));
            expect(emitSpy).toHaveBeenCalledWith('ui:queue-menu', expect.objectContaining({ type: 'npc', context: expect.objectContaining({ npcId: 'guard' }) }));
        });
    });

    describe('Kill Quest Tracking (combat regression)', () => {
        test('attack command in enemy location damages the room enemy', async () => {
            localPlayer.location = 'forest_edge';
            localPlayer.forestFights = 5;
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('attack');
            step();
            
            const enemy = shardEnemies.get('forest_edge');
            expect(enemy).toBeTruthy();
            expect(enemy.type).toBe('forest_wolf');
            expect(enemy.hp).toBeLessThan(enemy.maxHp);
            expect(emitSpy).toHaveBeenCalledWith('combat:hit', expect.objectContaining({
                attacker: 'You',
                target: 'Forest Wolf'
            }));
        });
    });

    describe('Quest Progression', () => {
        test('quest accept enforces prerequisites', async () => {
            localPlayer.location = 'hallway';
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('quest accept bandit_sweep');

            expect(localPlayer.quests.bandit_sweep).toBeUndefined();
        });

        test('explore quests progress on room transition', async () => {
            localPlayer.location = 'hallway';
            localPlayer.x = 5;
            localPlayer.y = 1;
            localPlayer.quests.find_tavern = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('move north');
            step();
            step();

            expect(localPlayer.location).toBe('tavern');
            expect(localPlayer.quests.find_tavern.progress).toBe(1);
            expect(emitSpy).toHaveBeenCalledWith('quest:progress', {
                questId: 'find_tavern',
                name: 'Find the Tavern',
                current: 1,
                total: 1
            });
        });

        test('rest quests only progress once per day', async () => {
            localPlayer.location = 'tavern';
            localPlayer.quests.tavern_regular = { progress: 0, completed: false };
            worldState.day = 7;
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('rest');
            step();
            expect(localPlayer.quests.tavern_regular.progress).toBe(1);

            await handleCommand('rest');
            step();
            expect(localPlayer.quests.tavern_regular.progress).toBe(1);
        });

        test('crafting bread advances the merchant recovery quest', async () => {
            localPlayer.location = 'mill';
            localPlayer.inventory = ['wheat', 'wheat'];
            localPlayer.quests.market_recovery = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('craft bread');

            expect(localPlayer.inventory).toContain('bread');
            expect(localPlayer.quests.market_recovery.progress).toBe(1);
        });

        test('crafting fails cleanly without required materials', async () => {
            localPlayer.location = 'mill';
            localPlayer.inventory = ['wheat'];
            localPlayer.quests.market_recovery = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('craft bread');

            expect(localPlayer.inventory).toEqual(['wheat']);
            expect(localPlayer.quests.market_recovery.progress).toBe(0);
            expect(emitSpy).not.toHaveBeenCalledWith('item:pickup', expect.anything());
        });

        test('crafting respects recipe location locks', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wheat', 'wheat'];
            localPlayer.quests.market_recovery = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('craft bread');

            expect(localPlayer.inventory).toEqual(['wheat', 'wheat']);
            expect(localPlayer.quests.market_recovery.progress).toBe(0);
        });

        test('deliver quests progress generically when talking to the receiver with the item', async () => {
            localPlayer.location = 'ruins';
            localPlayer.inventory = ['ale'];
            localPlayer.quests.courier_run = { progress: 0, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('talk sage');

            expect(localPlayer.inventory).not.toContain('ale');
            expect(localPlayer.quests.courier_run.progress).toBe(1);
            expect(emitSpy).toHaveBeenCalledWith('quest:progress', {
                questId: 'courier_run',
                name: 'Courier Run',
                current: 1,
                total: 1
            });
        });

        test('deliver quests progress generically when selling the target item to the receiver shop npc', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood'];
            localPlayer.quests.merchant_delivery = {
                progress: 0,
                completed: false
            };
            const originalQuest = QUESTS.merchant_delivery;
            QUESTS.merchant_delivery = {
                id: 'merchant_delivery',
                name: 'Merchant Delivery',
                giver: 'merchant',
                receiver: 'merchant',
                type: 'deliver',
                objective: { type: 'deliver', target: 'wood', count: 1 },
                reward: { xp: 1, gold: 1 }
            };
            try {
                appRuntime.hydratePlayer(localPlayer);

                await handleCommand('sell wood');

                expect(localPlayer.quests.merchant_delivery.progress).toBe(1);
                expect(emitSpy).toHaveBeenCalledWith('quest:progress', {
                    name: 'Merchant Delivery',
                    current: 1,
                    total: 1
                });
            } finally {
                if (originalQuest) QUESTS.merchant_delivery = originalQuest;
                else delete QUESTS.merchant_delivery;
            }
        });

        test('scarcity and surplus both affect shop prices', async () => {
            localPlayer.location = 'market';
            localPlayer.gold = 10;
            worldState.scarcity = ['wheat'];
            worldState.event = { type: 'market_surplus' };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('buy wheat');

            expect(localPlayer.gold).toBe(6);
            expect(localPlayer.inventory).toContain('wheat');
        });

        test('fetch quest can be completed when inventory has enough items (gather_wood)', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood', 'wood', 'wood', 'wood', 'wood'];
            localPlayer.quests.gather_wood = { progress: 0, completed: false };
            localPlayer.xp = 0; localPlayer.gold = 0;
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('quest complete gather_wood');

            expect(localPlayer.quests.gather_wood.completed).toBe(true);
            expect(localPlayer.xp).toBeGreaterThan(0);
        });

        test('fetch quest blocked when not enough items in inventory', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood', 'wood'];
            localPlayer.quests.gather_wood = { progress: 0, completed: false };
            localPlayer.xp = 0;
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('quest complete gather_wood');

            expect(localPlayer.quests.gather_wood.completed).toBe(false);
            expect(localPlayer.xp).toBe(0);
        });

        test('iron_supply unlocks after gather_wood is completed', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood', 'wood', 'wood', 'wood', 'wood'];
            localPlayer.quests.gather_wood = { progress: 0, completed: false };
            localPlayer.xp = 0; localPlayer.gold = 0;
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('quest complete gather_wood');
            expect(localPlayer.quests.gather_wood.completed).toBe(true);

            // iron_supply prereq is now satisfied — accept should work
            localPlayer.inventory = ['iron', 'iron', 'iron'];
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('quest accept iron_supply');
            expect(localPlayer.quests.iron_supply).toBeDefined();
        });

        test('quest completion is blocked if the receiver is absent', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['ale'];
            localPlayer.quests.courier_run = { progress: 1, completed: false };
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('quest complete courier_run');

            expect(localPlayer.quests.courier_run.completed).toBe(false);
            expect(localPlayer.inventory).toContain('ale');
            expect(localPlayer.xp).toBe(0);
        });
    });

    describe('Buy & Sell Commands', () => {
        beforeEach(async () => {
            // Ensure merchant, guard are considered present at their rooms
            const rules = await import('../rules/index.js');
            rules.getNPCLocation.mockImplementation((id) => {
                if (id === 'merchant') return 'market';
                if (id === 'guard') return 'hallway';
                if (id === 'barkeep') return 'tavern';
                if (id === 'sage') return 'ruins';
                return null;
            });
        });

        test('buy purchases item from merchant shop (wood bundle)', async () => {
            localPlayer.location = 'market';
            localPlayer.gold = 100;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('buy wood bundle');
            expect(localPlayer.inventory).toContain('wood');
            expect(localPlayer.gold).toBeLessThan(100);
        });

        test('buy purchases potion from barkeep at tavern', async () => {
            localPlayer.location = 'tavern';
            localPlayer.gold = 100;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('buy health potion');
            expect(localPlayer.inventory).toContain('potion');
            expect(localPlayer.gold).toBeLessThan(100);
        });

        test('buy fails when not enough gold', async () => {
            localPlayer.location = 'market';
            localPlayer.gold = 1;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('buy iron sword');
            expect(localPlayer.inventory).not.toContain('iron_sword');
        });

        test('buy fails when item not sold by shop', async () => {
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);
            const { log } = await import('../ui/index.js');
            await handleCommand('buy nonexistent_item');
            expect(log).toHaveBeenCalledWith(expect.stringContaining("don't sell"));
        });

        test('buy with no args lists shop inventory', async () => {
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);
            const { log } = await import('../ui/index.js');
            await handleCommand('buy');
            expect(log).toHaveBeenCalledWith(expect.stringContaining("Shop"), expect.any(String));
        });

        test('buy fails when no shop at location', async () => {
            localPlayer.location = 'cellar';
            appRuntime.hydratePlayer(localPlayer);
            const { log } = await import('../ui/index.js');
            await handleCommand('buy potion');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('no shop'));
        });

        test('sell sells iron ore to merchant for gold', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['iron'];
            localPlayer.gold = 0;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('sell iron ore');
            expect(localPlayer.inventory).not.toContain('iron');
            expect(localPlayer.gold).toBeGreaterThan(0);
        });

        test('sell fails when item not in inventory', async () => {
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);
            const { log } = await import('../ui/index.js');
            await handleCommand('sell iron sword');
            expect(log).toHaveBeenCalledWith(expect.stringContaining("don't have"));
        });

        test('sell fails with no args', async () => {
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);
            const { log } = await import('../ui/index.js');
            await handleCommand('sell');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
        });

        test('sell at guard post pays bounty price for bandit_mask', async () => {
            localPlayer.location = 'hallway';
            localPlayer.inventory = ['bandit_mask'];
            localPlayer.gold = 0;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('sell bandit mask');
            expect(localPlayer.inventory).not.toContain('bandit_mask');
            expect(localPlayer.gold).toBeGreaterThan(0);
        });

        test('sell wood bundle at market works', async () => {
            localPlayer.location = 'market';
            localPlayer.inventory = ['wood'];
            localPlayer.gold = 0;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('sell wood bundle');
            expect(localPlayer.inventory).not.toContain('wood');
            expect(localPlayer.gold).toBeGreaterThan(0);
        });
    });

    describe('Quest Log Display', () => {
        test('quest list shows all chains', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.quests.wolf_hunt = { progress: 2, completed: false };
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('quest list');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('QUEST LOG'), expect.any(String));
            expect(log).toHaveBeenCalledWith(expect.stringContaining('MILITIA'), expect.any(String));
        });

        test('quest list marks completed quests', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.quests.wolf_hunt = { progress: 3, completed: true };
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('quest list');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('✅'), expect.any(String));
        });

        test('quest list shows locked quests as ???', async () => {
            const { log } = await import('../ui/index.js');
            // wolf_hunt requires find_tavern completed, and player hasn't done find_tavern
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('quest list');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('???'), expect.any(String));
        });
    });

    describe('Bank Commands', () => {
        beforeEach(() => {
            localPlayer.location = 'cellar';
            localPlayer.gold = 100;
            localPlayer.bankedGold = 200;
            appRuntime.hydratePlayer(localPlayer);
        });

        test('bank deposit transfers gold to bank', async () => {
            await handleCommand('bank deposit 50');
            expect(localPlayer.gold).toBe(50);
            expect(localPlayer.bankedGold).toBe(250);
        });

        test('bank deposit clamps to available gold', async () => {
            await handleCommand('bank deposit 200');
            expect(localPlayer.gold).toBe(100); // no change
        });

        test('bank withdraw transfers gold from bank', async () => {
            await handleCommand('bank withdraw 100');
            expect(localPlayer.bankedGold).toBe(100);
            expect(localPlayer.gold).toBe(200);
        });

        test('bank withdraw rejects when insufficient banked gold', async () => {
            await handleCommand('bank withdraw 500');
            expect(localPlayer.bankedGold).toBe(200);
        });

        test('bank shows balance when no subcommand', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('bank');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Wallet'));
        });

        test('bank outside bank room shows error', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.location = 'market';
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('bank deposit 10');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('bank'));
            expect(localPlayer.gold).toBe(100);
        });
    });

    describe('Move command does room-level transition', () => {
        test('move north from cellar transitions to hallway', async () => {
            localPlayer.x = 5; localPlayer.y = 5;
            localPlayer.location = 'cellar';
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('move north'); // input:action emitted
            step(); // input -> intent
            step(); // intent -> move (one tile)
            step(); // move -> transition (since 5,0 is exit)
            // Wait, one 'move north' from 5,5 only moves to 5,4. 
            // The test expects 5,5 -> hallway. In cellar, 5,0 is the exit.
            
            localPlayer.y = 1;
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('move north');
            step(); step();
            
            expect(localPlayer.location).toBe('hallway');
        });
    });
});
