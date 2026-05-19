import { jest } from '@jest/globals';

jest.mock('../state/store.js', () => ({
    localPlayer: {
        name: 'Tester', hp: 50, maxHp: 50, gold: 100, xp: 0, level: 1,
        inventory: [], location: 'cellar', statusEffects: [],
        equipped: { weapon: null, armor: null },
    },
    players: new Map(),
    pendingDuel: null,
    setPendingDuel: jest.fn(),
    activeChannels: new Map(),
    STORAGE_KEY: 'fenhollow_player',
    WORLD_STATE_KEY: 'fenhollow_world',
}));
jest.mock('../ui/index.js', () => ({ log: jest.fn() }));
jest.mock('../state/eventbus.js', () => ({ bus: { emit: jest.fn(), on: jest.fn() } }));
jest.mock('../state/persistence.js', () => ({ saveLocalState: jest.fn() }));
jest.mock('../network/index.js', () => ({
    gameActions: {
        sendDuelChallenge: jest.fn(),
        sendDuelAccept: jest.fn(),
        sendDuelCommit: jest.fn(),
    },
}));
jest.mock('../commands/helpers.js', () => ({
    getPlayerName: jest.fn(id => `Player-${id}`),
    getPlayerEntry: jest.fn(() => null),
    grantItem: jest.fn(),
    nameColor: jest.fn(n => n),
}));
jest.mock('../security/identity.js', () => ({
    playerKeys: { privateKey: null },
}));
jest.mock('../security/crypto.js', () => ({
    signMessage: jest.fn().mockResolvedValue('mock-sig'),
}));
jest.mock('../infra/runtime.js', () => ({
    scopedStorageKey: jest.fn(k => k),
}));

describe('Admin Commands', () => {
    let localPlayer, log, saveLocalState, grantItem;

    beforeEach(async () => {
        jest.clearAllMocks();
        const store = await import('../state/store.js');
        localPlayer = store.localPlayer;
        Object.assign(localPlayer, { xp: 0, level: 1, gold: 100 });
        const uiMod = await import('../ui/index.js');
        log = uiMod.log;
        const persMod = await import('../state/persistence.js');
        saveLocalState = persMod.saveLocalState;
        const helpers = await import('../commands/helpers.js');
        grantItem = helpers.grantItem;
    });

    test('addxp increases xp and updates level', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        await handleAdminCommands('addxp', ['addxp', '50']);
        expect(localPlayer.xp).toBe(50);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('50 XP'));
        expect(saveLocalState).toHaveBeenCalled();
    });

    test('addxp defaults to 100 when no arg', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        await handleAdminCommands('addxp', ['addxp']);
        expect(localPlayer.xp).toBe(100);
    });

    test('addgold increases gold', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        await handleAdminCommands('addgold', ['addgold', '500']);
        expect(localPlayer.gold).toBe(600);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('500 Gold'));
    });

    test('addgold defaults to 1000 when no arg', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        await handleAdminCommands('addgold', ['addgold']);
        expect(localPlayer.gold).toBe(1100);
    });

    test('spawn with known item grants item', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        const result = await handleAdminCommands('spawn', ['spawn', 'potion']);
        expect(result).toBe(true);
        expect(grantItem).toHaveBeenCalledWith('potion');
    });

    test('spawn with unknown item logs error', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        await handleAdminCommands('spawn', ['spawn', '__unknown__item__']);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Unknown item'));
        expect(grantItem).not.toHaveBeenCalled();
    });

    test('unknown command returns false', async () => {
        const { handleAdminCommands } = await import('../commands/admin.js');
        const result = await handleAdminCommands('unknowncmd', []);
        expect(result).toBe(false);
    });
});

describe('Social Commands', () => {
    let bus, log, players, setPendingDuel;

    beforeEach(async () => {
        jest.clearAllMocks();
        const store = await import('../state/store.js');
        players = store.players;
        players.clear();
        setPendingDuel = store.setPendingDuel;
        const busMod = await import('../state/eventbus.js');
        bus = busMod.bus;
        const uiMod = await import('../ui/index.js');
        log = uiMod.log;
    });

    test('who says alone when no players', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('who', ['who']);
        expect(bus.emit).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('alone') }));
    });

    test('who lists nearby players', async () => {
        players.set('peer1', { ghost: false });
        players.set('peer2', { ghost: false });
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('who', ['who']);
        expect(bus.emit).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Nearby') }));
    });

    test('who excludes ghost players', async () => {
        players.set('ghost1', { ghost: true });
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('who', ['who']);
        expect(bus.emit).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('alone') }));
    });

    test('rename with valid name updates player name', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        const store = await import('../state/store.js');
        await handleSocialCommands('rename', ['rename', 'NewName']);
        expect(store.localPlayer.name).toBe('NewName');
    });

    test('rename with no name shows usage', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('rename', ['rename']);
        expect(bus.emit).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Usage') }));
    });

    test('rename with too-long name shows error', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('rename', ['rename', 'AVeryLongNameThatExceedsLimit']);
        expect(bus.emit).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('too long') }));
    });

    test('duel with no arg returns true without sending', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        const network = await import('../network/index.js');
        const result = await handleSocialCommands('duel', ['duel']);
        expect(result).toBe(true);
        expect(network.gameActions.sendDuelChallenge).not.toHaveBeenCalled();
    });

    test('duel with unknown player logs not found', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('duel', ['duel', 'unknown_peer']);
        expect(log).toHaveBeenCalledWith('Player not found.');
    });

    test('duel with known player sends challenge', async () => {
        players.set('peer1', { ghost: false });
        const helpers = await import('../commands/helpers.js');
        helpers.getPlayerEntry.mockReturnValueOnce({ name: 'Foe', level: 1 });
        const { handleSocialCommands } = await import('../commands/social.js');
        const network = await import('../network/index.js');
        await handleSocialCommands('duel', ['duel', 'foe']);
        expect(network.gameActions.sendDuelChallenge).toHaveBeenCalled();
    });

    test('accept with no pending duel logs no challenge', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        // pendingDuel is null from the mock
        await handleSocialCommands('accept', ['accept']);
        expect(log).toHaveBeenCalledWith('No pending challenge.');
    });

    test('decline clears pending duel', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        await handleSocialCommands('decline', ['decline']);
        expect(setPendingDuel).toHaveBeenCalledWith(null);
    });

    test('unknown command returns false', async () => {
        const { handleSocialCommands } = await import('../commands/social.js');
        expect(await handleSocialCommands('unknown', [])).toBe(false);
    });
});

describe('Duel State Channel', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        const store = await import('../state/store.js');
        store.activeChannels.clear();
    });

    test('startStateChannel registers channel for targetId', async () => {
        const { startStateChannel } = await import('../commands/duel.js');
        const store = await import('../state/store.js');
        await startStateChannel('peer1', 'Foe', 1);
        expect(store.activeChannels.has('peer1')).toBe(true);
        store.activeChannels.get('peer1')?.timeoutId && clearTimeout(store.activeChannels.get('peer1').timeoutId);
    });

    test('startStateChannel is idempotent for same target', async () => {
        const { startStateChannel } = await import('../commands/duel.js');
        const store = await import('../state/store.js');
        await startStateChannel('peer2', 'Foe', 1);
        const before = store.activeChannels.get('peer2');
        await startStateChannel('peer2', 'Foe', 1);
        expect(store.activeChannels.get('peer2')).toBe(before); // same reference
        before?.timeoutId && clearTimeout(before.timeoutId);
    });

    test('resolveRound does nothing when no channel', async () => {
        const { resolveRound } = await import('../commands/duel.js');
        const network = await import('../network/index.js');
        await resolveRound('nonexistent');
        expect(network.gameActions.sendDuelCommit).not.toHaveBeenCalled();
    });
});
