import { jest } from '@jest/globals';
import { handleCommand } from '../commands/index.js';
import { localPlayer, shardEnemies } from '../state/store.js';
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
            statusEffects: [], equipped: { weapon: null, armor: null }
        });
        shardEnemies.clear();
        appRuntime.hydratePlayer(localPlayer);
        appRuntime.initSystems(localPlayer, gameActions);
    });

    afterEach(() => {
        emitSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe('pickup', () => {
        test('picking up gold adds directly to gold balance', async () => {
            localPlayer.location = 'cellar';
            localPlayer.gold = 10;

            // Setup shared enemy loot in ecs projection context
            shardEnemies.set('cellar', { hp: 0, loot: ['gold'], maxHp: 10 });

            await handleCommand('pickup');
            appRuntime.update(0.016); // intent -> interact
            appRuntime.update(0.016); // interact -> pickup logic

            expect(localPlayer.gold).toBeGreaterThan(10);
            expect(emitSpy).toHaveBeenCalledWith('item:pickup', expect.anything());
        });
    });
});
