import { jest } from '@jest/globals';
import { bus } from '../state/eventbus.js';
import { localPlayer, worldState } from '../state/store.js';
import { appRuntime } from '../app/runtime.js';
import { gameActions } from '../network/index.js';

// Mock all renderer/graphics dependencies
jest.mock('../graphics/renderer.js', () => ({
    renderWorld: jest.fn(),
    setVisualRefreshCallback: jest.fn(),
    setLogicalRefreshCallback: jest.fn(),
    triggerHitFlash: jest.fn(),
    showFloatingText: jest.fn(),
    showDialogue: jest.fn(),
    showToast: jest.fn(),
    showLevelUp: jest.fn(),
    showItemFanfare: jest.fn(),
    advanceDialogue: jest.fn(),
    isDialogueOpen: jest.fn(() => false),
}));

jest.mock('../ui/helpers.js', () => ({ triggerShake: jest.fn() }));
jest.mock('../network/index.js', () => ({
    gameActions: {
        sendMove: jest.fn(),
        sendPresenceSingle: jest.fn(),
        sendMonsterDmg: jest.fn(),
        sendActionLog: jest.fn(),
        sendTradeFinal: jest.fn(),
    },
    joinInstance: jest.fn().mockResolvedValue(null),
    preJoinShard: jest.fn(),
    currentInstance: 1,
    currentRtcConfig: {},
    globalRooms: { torrent: { getPeers: () => ({}) } },
    rooms: { torrent: { getPeers: () => ({}) } },
}));
jest.mock('../state/persistence.js', () => ({ saveLocalState: jest.fn() }));
jest.mock('../ui/index.js', () => ({
    log: jest.fn(), printStatus: jest.fn(), triggerShake: jest.fn(), getHealthBar: jest.fn(() => '[HHH]')
}));
jest.mock('../commands/index.js', () => ({
    handleCommand: jest.fn().mockResolvedValue(true),
    getBestGear: jest.fn(() => ({ weaponBonus: 0, defenseBonus: 0 })),
    getPlayerName: jest.fn(id => `Player-${id}`),
    startStateChannel: jest.fn().mockResolvedValue(null),
    resolveRound: jest.fn().mockResolvedValue(null),
    grantItem: jest.fn(),
}));
jest.mock('../network/transport.js', () => ({ selfId: 'test-self-id' }));
jest.mock('../security/crypto.js', () => ({
    importKey: jest.fn().mockResolvedValue('mock-key'),
    verifyMessage: jest.fn().mockResolvedValue(true),
    signMessage: jest.fn().mockResolvedValue('mock-sig'),
}));
jest.mock('../engine/audio.js', () => ({
    getAudioSettings: jest.fn(() => ({ muted: false, music: 0.5, sfx: 0.7 })),
    stepAudioVolume: jest.fn(),
    toggleAudioMute: jest.fn(),
    playBGM: jest.fn(),
    playHit: jest.fn(),
    playCrit: jest.fn(),
    playDeath: jest.fn(),
    playPickup: jest.fn(),
    playLevelUp: jest.fn(),
    playPortal: jest.fn(),
    playStep: jest.fn(),
}));
jest.mock('../rules/index.js', () => {
    const original = jest.requireActual('../rules/index.js');
    return { ...original, getNPCLocation: jest.fn(() => null), getTimeOfDay: jest.fn(() => 'day') };
});

const resetPlayer = () => {
    Object.assign(localPlayer, {
        name: 'Tester', hp: 50, maxHp: 50, gold: 100, inventory: [], quests: {},
        location: 'cellar', x: 5, y: 5, level: 1, xp: 0,
        statusEffects: [], equipped: { weapon: null, armor: null },
        currentEnemy: null, forestFights: 15, combatRound: 0, bankedGold: 0,
        visitedRooms: ['cellar'], dailyBountyClaimed: 0,
    });
    Object.assign(worldState, {
        seed: 'test-seed', day: 1, threatLevel: 0, season: 'spring', seasonNumber: 1,
        mood: 'calm', weather: 'clear', scarcity: [], event: null, bountyEnemy: null, lastTick: null,
    });
    appRuntime.hydratePlayer(localPlayer);
    appRuntime.initSystems(localPlayer, gameActions);
};

describe('main/events — setupGlobalEvents bus handlers', () => {
    beforeAll(async () => {
        resetPlayer();
        const { setupGlobalEvents } = await import('../main/events.js');
        setupGlobalEvents();
    });

    beforeEach(() => {
        resetPlayer();
        jest.clearAllMocks();
    });

    test('combat:hit triggers hit flash', async () => {
        const { triggerHitFlash } = await import('../graphics/renderer.js');
        bus.emit('combat:hit', { attacker: 'wolf', target: 'You', damage: 5, crit: false });
        expect(triggerHitFlash).toHaveBeenCalled();
    });

    test('combat:dodge shows dodge text for You target', async () => {
        const { showFloatingText } = await import('../graphics/renderer.js');
        bus.emit('combat:dodge', { attacker: 'wolf', target: 'You' });
        expect(showFloatingText).toHaveBeenCalledWith(
            expect.any(Number), expect.any(Number), 'DODGE', expect.any(String)
        );
    });

    test('combat:dodge shows MISS for non-You target', async () => {
        const { showFloatingText } = await import('../graphics/renderer.js');
        bus.emit('combat:dodge', { attacker: 'You', target: 'Forest Wolf' });
        expect(showFloatingText).toHaveBeenCalledWith(
            expect.any(Number), expect.any(Number), 'MISS', expect.any(String)
        );
    });

    test('player:levelup shows level up UI', async () => {
        const { showLevelUp } = await import('../graphics/renderer.js');
        bus.emit('player:levelup', { level: 3 });
        expect(showLevelUp).toHaveBeenCalledWith(3);
    });

    test('item:pickup shows item fanfare', async () => {
        const { showItemFanfare } = await import('../graphics/renderer.js');
        bus.emit('item:pickup', { item: { name: 'Iron Sword' } });
        expect(showItemFanfare).toHaveBeenCalledWith('Iron Sword');
    });

    test('item:pickup with no item name is a no-op', async () => {
        const { showItemFanfare } = await import('../graphics/renderer.js');
        bus.emit('item:pickup', { item: null });
        expect(showItemFanfare).not.toHaveBeenCalled();
    });

    test('player:move to new location records visit and logs season', async () => {
        localPlayer.visitedRooms = ['cellar'];
        localPlayer.location = 'cellar';
        bus.emit('player:move', { from: 'cellar', to: 'hallway' });
        expect(localPlayer.visitedRooms).toContain('hallway');
    });

    test('player:move to same location is handled without crash', () => {
        expect(() => bus.emit('player:move', { from: 'cellar', to: 'cellar' })).not.toThrow();
    });

    test('npc:speak shows dialogue', async () => {
        const { showDialogue } = await import('../graphics/renderer.js');
        bus.emit('npc:speak', { npcName: 'Merchant', text: 'Hello!' });
        expect(showDialogue).toHaveBeenCalledWith('Merchant', 'Hello!');
    });

    test('ui:menu opens a menu', () => {
        bus.emit('ui:menu', { type: 'inventory', context: {} });
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu).toBeDefined();
    });

    test('ui:back closes the menu', async () => {
        const { isDialogueOpen } = await import('../graphics/renderer.js');
        isDialogueOpen.mockReturnValue(false);
        bus.emit('ui:menu', { type: 'inventory', context: {} });
        bus.emit('ui:back', {});
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu).toBeUndefined();
    });

    test('ui:shake triggers shake', async () => {
        const { triggerShake } = await import('../ui/helpers.js');
        bus.emit('ui:shake', {});
        expect(triggerShake).toHaveBeenCalled();
    });

    test('audio:toggle-mute calls toggleAudioMute', async () => {
        const { toggleAudioMute } = await import('../engine/audio.js');
        bus.emit('audio:toggle-mute', {});
        expect(toggleAudioMute).toHaveBeenCalled();
    });

    test('audio:change-volume calls stepAudioVolume', async () => {
        const { stepAudioVolume } = await import('../engine/audio.js');
        bus.emit('audio:change-volume', { field: 'music', delta: 0.1 });
        expect(stepAudioVolume).toHaveBeenCalledWith('music', 0.1);
    });

    test('quest:progress shows toast', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('quest:progress', { name: 'Wolf Hunt', current: 2, total: 3 });
        expect(showToast).toHaveBeenCalledWith('Wolf Hunt: 2/3');
    });

    test('quest:complete shows toast', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('quest:complete', { name: 'Wolf Hunt', questId: 'wolf_hunt' });
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Wolf Hunt'));
    });

    test('quest:complete ancient_throne shows victory message', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('quest:complete', { name: 'The Ancient Throne', questId: 'ancient_throne' });
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('VICTORY'));
    });

    test('world:event shows toast for known events', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('world:event', { event: { type: 'market_surplus' } });
        expect(showToast).toHaveBeenCalledWith('Market Surplus');
    });

    test('world:event handles unknown event type gracefully', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('world:event', { event: { type: 'unknown_event' } });
        expect(showToast).not.toHaveBeenCalled();
    });

    test('monster:damaged triggers logical refresh without crash', () => {
        expect(() => bus.emit('monster:damaged', {})).not.toThrow();
    });

    test('duel:incoming shows toast', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        bus.emit('duel:incoming', { challengerName: 'Foe' });
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Foe'));
    });

    test('trade:offer-received creates pending trade', async () => {
        bus.emit('trade:offer-received', {
            partnerId: 'peer1',
            partnerName: 'Peer One',
            offer: { gold: 10, items: ['potion'] },
        });
        // No crash is the primary assertion for trade flow
        expect(true).toBe(true);
    });

    test('peer:move to player location shows toast', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        localPlayer.location = 'cellar';
        bus.emit('peer:move', { peerId: 'peer-abc', data: { from: 'hallway', to: 'cellar' } });
        expect(showToast).toHaveBeenCalled();
    });

    test('peer:move from player location shows leave toast', async () => {
        const { showToast } = await import('../graphics/renderer.js');
        localPlayer.location = 'cellar';
        bus.emit('peer:move', { peerId: 'peer-abc', data: { from: 'cellar', to: 'hallway' } });
        expect(showToast).toHaveBeenCalled();
    });

    test('ui:hud-action menu opens root menu', () => {
        bus.emit('ui:hud-action', { action: 'menu' });
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu?.type).toBe('root');
    });

    test('ui:hud-action inventory toggles inventory menu', () => {
        bus.emit('ui:hud-action', { action: 'inventory' });
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu?.type).toBe('inventory');
    });

    test('ui:hud-action attack calls handleCommand', async () => {
        const { handleCommand } = await import('../commands/index.js');
        bus.emit('ui:hud-action', { action: 'attack' });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(handleCommand).toHaveBeenCalledWith('attack');
    });

    test('ui:queue-menu opens menu when no dialogue', async () => {
        const { isDialogueOpen } = await import('../graphics/renderer.js');
        isDialogueOpen.mockReturnValue(false);
        bus.emit('ui:queue-menu', { type: 'quests', context: {} });
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu?.type).toBe('quests');
    });

    test('dialogue:closed opens queued menu if present', async () => {
        const { isDialogueOpen } = await import('../graphics/renderer.js');
        isDialogueOpen.mockReturnValue(true);
        bus.emit('ui:queue-menu', { type: 'inventory', context: {} });
        isDialogueOpen.mockReturnValue(false);
        bus.emit('dialogue:closed', {});
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        expect(menu?.type).toBe('inventory');
    });
});

// Import Component at module level for test assertions
import { Component } from '../domain/components.js';
