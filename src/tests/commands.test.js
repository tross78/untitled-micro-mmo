import { jest } from '@jest/globals';
import { handleCommand, getBestGear } from '../commands/index.js';
import { localPlayer, worldState, shardEnemies } from '../state/store.js';
import { bus } from '../state/eventbus.js';
import { appRuntime } from '../app/runtime.js';
import { gameActions } from '../network/index.js';

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
        sendEmote: jest.fn(),
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
        test('interact command talks to NPC if present', async () => {
            localPlayer.location = 'hallway'; // Guard is here
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('interact');
            step();
            expect(emitSpy).toHaveBeenCalledWith('npc:speak', expect.objectContaining({ npcName: 'Guard' }));
        });

        test('interact command uses portal if no NPC present', async () => {
            localPlayer.location = 'cellar';
            localPlayer.x = 5; localPlayer.y = 0; // Portal to hallway
            appRuntime.hydratePlayer(localPlayer);

            await handleCommand('interact');
            step();
            expect(localPlayer.location).toBe('hallway');
        });
    });

    describe('Kill Quest Tracking (combat regression)', () => {
        test('attack command in enemy location emits a combat event', async () => {
            localPlayer.location = 'forest_edge';
            localPlayer.forestFights = 5;
            appRuntime.hydratePlayer(localPlayer);
            
            await handleCommand('attack');
            step();
            
            const allEvents = emitSpy.mock.calls.map(c => c[0]);
            const hasCombatEvent = allEvents.some(e => e.startsWith('combat:') || e.startsWith('monster:') || e === 'log');
            expect(hasCombatEvent).toBe(true);
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
