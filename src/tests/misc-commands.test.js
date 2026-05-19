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
    gameActions: { sendMove: jest.fn(), sendPresenceSingle: jest.fn(), sendMonsterDmg: jest.fn(), sendActionLog: jest.fn() },
    joinInstance: jest.fn().mockResolvedValue(null),
    preJoinShard: jest.fn(),
    currentInstance: 1,
    currentRtcConfig: {},
    globalRooms: { torrent: { getPeers: () => ({}) } },
    rooms: { torrent: { getPeers: () => ({}) } },
}));
jest.mock('../network/shard.js', () => ({ getCurrentInstance: jest.fn(() => 1) }));
jest.mock('../adapters/dom/shell.js', () => ({
    getShellElement: jest.fn(() => null),
    clearElement: jest.fn(),
    getOutputEl: jest.fn(() => null),
}));
jest.mock('../rules/index.js', () => {
    const original = jest.requireActual('../rules/index.js');
    return { ...original, getNPCLocation: jest.fn(() => null), getTimeOfDay: jest.fn(() => 'day') };
});

const resetPlayer = () => {
    Object.assign(localPlayer, {
        hp: 40, maxHp: 50, gold: 100, inventory: [], quests: {},
        location: 'cellar', x: 5, y: 5, level: 2, xp: 50,
        statusEffects: [], equipped: { weapon: null, armor: null },
        currentEnemy: null, forestFights: 10, combatRound: 0,
        bankedGold: 200, attack: 5, defense: 3, ph: 'ab12cd34',
        visitedRooms: ['cellar', 'hallway'],
    });
    Object.assign(worldState, {
        seed: 'test-seed', day: 5, threatLevel: 2, season: 'autumn', seasonNumber: 1,
        mood: 'grim', weather: 'clear', scarcity: [], event: null, bountyEnemy: null, lastTick: null,
    });
    appRuntime.hydratePlayer(localPlayer);
    appRuntime.initSystems(localPlayer, gameActions);
};

describe('Misc Commands', () => {
    let emitSpy;
    beforeEach(() => { emitSpy = jest.spyOn(bus, 'emit'); resetPlayer(); });
    afterEach(() => { emitSpy.mockRestore(); jest.clearAllMocks(); });

    describe('status command', () => {
        test('status calls printStatus', async () => {
            const { printStatus } = await import('../ui/index.js');
            await handleCommand('status');
            expect(printStatus).toHaveBeenCalled();
        });
    });

    describe('help command', () => {
        test('help logs movement and combat info', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('help');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Movement'), expect.any(String));
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Combat'), expect.any(String));
        });
    });

    describe('map command', () => {
        test('map shows visited rooms', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('map');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('WORLD MAP'), expect.any(String));
        });

        test('map marks current location with arrow', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('map');
            // Current location (cellar) should be marked
            const calls = log.mock.calls;
            const cellarCall = calls.find(c => c[0].includes('▶'));
            expect(cellarCall).toBeDefined();
        });
    });

    describe('stats command', () => {
        test('stats logs player level and xp', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('stats');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Level: 2'), expect.any(String));
        });

        test('stats logs hp and maxhp', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('stats');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('HP:'), expect.any(String));
        });

        test('stats shows equipped weapon', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.inventory = ['iron_sword'];
            localPlayer.equipped.weapon = 'iron_sword';
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('stats');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Iron Sword'), expect.any(String));
        });

        test('stats shows status effects when present', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.statusEffects = [{ id: 'poisoned', duration: 3 }];
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('stats');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Status'), expect.any(String));
        });
    });

    describe('net command', () => {
        test('net logs network status', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('net');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('NETWORK STATUS'), expect.any(String));
        });

        test('net shows peer counts', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('net');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('Global Room'));
        });
    });

    describe('clear command', () => {
        test('clear calls clearElement on the output el', async () => {
            const { clearElement } = await import('../adapters/dom/shell.js');
            await handleCommand('clear');
            expect(clearElement).toHaveBeenCalled();
        });
    });

    describe('score command', () => {
        test('score shows top adventurers header', async () => {
            const { log } = await import('../ui/index.js');
            await handleCommand('score');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('TOP ADVENTURERS'), expect.any(String));
        });

        test('score includes current player', async () => {
            const { log } = await import('../ui/index.js');
            localPlayer.name = 'TestHero';
            appRuntime.hydratePlayer(localPlayer);
            await handleCommand('score');
            const calls = log.mock.calls;
            const heroCall = calls.find(c => c[0].includes('TestHero'));
            expect(heroCall).toBeDefined();
        });
    });
});

describe('printStatus', () => {
    beforeEach(() => {
        Object.assign(worldState, {
            seed: 'abc123', day: 3, threatLevel: 1, season: 'winter', seasonNumber: 2,
            mood: 'quiet', weather: 'fog', scarcity: [], event: null, bountyEnemy: null, lastTick: null,
        });
        Object.assign(localPlayer, { dailyBountyClaimed: 0 });
    });
    afterEach(() => jest.clearAllMocks());

    test('printStatus logs season, day, threat', async () => {
        const { printStatus } = await import('../ui/status.js');
        const { log } = await import('../ui/index.js');
        printStatus();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('WINTER'), expect.any(String));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Day: 3'), expect.any(String));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Threat: 1'), expect.any(String));
    });

    test('printStatus shows scarcity when present', async () => {
        worldState.scarcity = ['iron', 'wood'];
        const { printStatus } = await import('../ui/status.js');
        const { log } = await import('../ui/index.js');
        printStatus();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Scarcity'), expect.any(String));
    });

    test('printStatus shows bounty enemy', async () => {
        worldState.bountyEnemy = 'forest_wolf';
        const { printStatus } = await import('../ui/status.js');
        const { log } = await import('../ui/index.js');
        printStatus();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Forest Wolf'), expect.any(String));
    });

    test('printStatus shows wandering_boss event', async () => {
        worldState.event = { type: 'wandering_boss', target: 'cave_troll' };
        const { printStatus } = await import('../ui/status.js');
        const { log } = await import('../ui/index.js');
        printStatus();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Wandering Boss'), expect.any(String));
    });

    test('printStatus shows market_surplus event', async () => {
        worldState.event = { type: 'market_surplus' };
        const { printStatus } = await import('../ui/status.js');
        const { log } = await import('../ui/index.js');
        printStatus();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Market Surplus'), expect.any(String));
    });
});
