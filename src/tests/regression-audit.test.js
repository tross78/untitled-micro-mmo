/**
 * Regression tests for bugs found in the May 2026 deep audit.
 * Each describe block is named after the finding it covers.
 */
import { jest } from '@jest/globals';
import { bus } from '../state/eventbus.js';
import { localPlayer } from '../state/store.js';

// ─── Top-level mocks (hoisted by Jest) ───────────────────────────────────────

jest.mock('../state/persistence.js', () => ({
    saveLocalState: jest.fn(),
    loadState: jest.fn(async () => null),
}));

jest.mock('../ui/index.js', () => ({
    log: jest.fn(),
    showItemFanfare: jest.fn(),
    printStatus: jest.fn(),
    showRoomBanner: jest.fn(),
    showDialogue: jest.fn(),
    isDialogueOpen: jest.fn(() => false),
    closeMenu: jest.fn(),
    openMenu: jest.fn(),
}));

jest.mock('../security/crypto.js', () => ({
    signMessage: jest.fn(async () => 'sig'),
    verifyMessage: jest.fn(async () => true),
}));

jest.mock('../security/identity.js', () => ({
    playerKeys: { privateKey: 'priv' },
    myEntry: jest.fn(async () => null),
}));

jest.mock('../rules/index.js', () => ({
    hashStr: jest.fn(() => 42),
    seededRNG: jest.fn(() => () => 0.5),
    levelBonus: jest.fn(() => ({ attack: 0, defense: 0, maxHp: 0 })),
    resolveAttack: jest.fn(() => ({ damage: 999, isCrit: false, isDodge: false })),
    rollLoot: jest.fn(() => ['herbs']),
    xpToLevel: jest.fn(() => 1),
    getTimeOfDay: jest.fn(() => 'day'),
    deriveWorldState: jest.fn(() => ({ mood: 'calm', season: 'spring', seasonNumber: 1, threatLevel: 0, scarcity: [], event: null, weather: 'clear' })),
    getNPCLocation: jest.fn(() => null),
    getNPCDialogue: jest.fn(() => 'hello'),
    getScatteredContent: jest.fn(() => []),
    rollLootForRoom: jest.fn(() => []),
}));

jest.mock('../graphics/renderer.js', () => ({
    showToast: jest.fn(),
    showRoomBanner: jest.fn(),
    showItemFanfare: jest.fn(),
    showLevelUp: jest.fn(),
    showDialogue: jest.fn(),
    isDialogueOpen: jest.fn(() => false),
    setVisualRefreshCallback: jest.fn(),
    setLogicalRefreshCallback: jest.fn(),
    renderWorld: jest.fn(),
}));

// ─── BUG 1: Combat loot must go through grantItem to advance fetch quests ───

describe('Bug 1 — combat loot advances fetch quest progress via grantItem', () => {
    beforeEach(() => {
        Object.assign(localPlayer, {
            hp: 50, maxHp: 50, attack: 10, defense: 3, xp: 0, level: 1,
            gold: 0, inventory: [], currentEnemy: null, combatRound: 0,
            actionIndex: 0, statusEffects: [], buffs: {}, forestFights: 15,
            quests: { herb_gathering: { progress: 0, completed: false } },
            equipped: { weapon: null, armor: null }, location: 'forest_edge',
        });
    });

    test('killing an enemy that drops herbs advances herb_gathering fetch quest', async () => {
        const { WorldStore } = await import('../domain/ecs.js');
        const { Component } = await import('../domain/components.js');
        const { CombatSystem } = await import('../systems/combat-system.js');
        const { shardEnemies, worldState } = await import('../state/store.js');

        const world = new WorldStore();
        const entityId = world.createEntity();
        world.setComponent(entityId, Component.Transform, { mapId: 'forest_edge', x: 5, y: 5, facing: 's' });
        world.setComponent(entityId, Component.Health, { current: 50, max: 50 });

        const system = new CombatSystem(
            world,
            { localPlayer, worldState, shardEnemies },
            { cellar: { id: 'cellar', width: 10, height: 10 } },
            { sendMonsterDmg: jest.fn(), sendActionLog: jest.fn(), sendPresenceSingle: jest.fn() }
        );

        await system.handleVictory('forest_edge', 'forest_wolf', { xp: 10, name: 'Forest Wolf' }, () => 0.5);

        expect(localPlayer.inventory).toContain('herbs');
        expect(localPlayer.quests.herb_gathering.progress).toBeGreaterThan(0);
    });
});

// ─── BUG 2: applyNewDay must save localPlayer ────────────────────────────────

describe('Bug 2 — applyNewDay persists daily reset', () => {
    test('forestFights resets to 15 and saveLocalState is called on offline day tick', async () => {
        const { saveLocalState } = await import('../state/persistence.js');
        saveLocalState.mockClear();

        const { worldState } = await import('../state/store.js');
        Object.assign(localPlayer, { forestFights: 0, currentEnemy: null, combatRound: 0, statusEffects: [], buffs: {} });
        worldState.seed = 1;
        worldState.day = 1;

        const OFFLINE_DAY_KEY = 'hearthwick_offline_day_ts';
        const past = Date.now() - 25 * 60 * 60 * 1000;
        localStorage.setItem(OFFLINE_DAY_KEY, String(past));

        const sim = await import('../network/simulation.js');
        sim.initOfflineDayTick();

        expect(localPlayer.forestFights).toBe(15);
        expect(saveLocalState).toHaveBeenCalled();

        localStorage.removeItem(OFFLINE_DAY_KEY);
    });

    test('arbiter-configured fallback resets forestFights without advancing shared world day', async () => {
        const { saveLocalState } = await import('../state/persistence.js');
        saveLocalState.mockClear();

        const runtime = await import('../infra/runtime.js');
        const arbiterSpy = jest.spyOn(runtime, 'getArbiterUrl').mockReturnValue('https://arbiter.example');
        const { worldState } = await import('../state/store.js');

        Object.assign(localPlayer, { forestFights: 0, currentEnemy: null, combatRound: 0, statusEffects: [], buffs: {} });
        worldState.seed = 'seed-a';
        worldState.day = 7;
        localStorage.setItem('hearthwick_last_fight_reset_utc', '2000-01-01');

        const sim = await import('../network/simulation.js');
        sim.initOfflineDayTick();

        expect(localPlayer.forestFights).toBe(15);
        expect(worldState.day).toBe(7);
        expect(saveLocalState).toHaveBeenCalled();

        arbiterSpy.mockRestore();
    });
});

// ─── BUG 3: visitedRooms must save on room transition ────────────────────────

describe('Bug 3 — visitedRooms saved on player:move', () => {
    test('saveLocalState called and room added when player moves to new room', async () => {
        const { saveLocalState } = await import('../state/persistence.js');
        saveLocalState.mockClear();

        // Bootstrap the event listeners
        const { setupGlobalEvents } = await import('../main/events.js');
        setupGlobalEvents();

        Object.assign(localPlayer, { visitedRooms: ['cellar'], location: 'cellar' });

        bus.emit('player:move', { to: 'tavern', from: 'cellar' });
        await new Promise(r => setTimeout(r, 0));

        expect(localPlayer.visitedRooms).toContain('tavern');
        expect(saveLocalState).toHaveBeenCalled();
    });

    test('crafting hint fires on first visit to a crafting room', async () => {
        const seenLogs = [];
        const handler = (payload) => seenLogs.push(payload);
        bus.on('log', handler);

        const { setupGlobalEvents } = await import('../main/events.js');
        setupGlobalEvents();

        Object.assign(localPlayer, { visitedRooms: ['hallway'], inventory: [], location: 'hallway' });

        bus.emit('player:move', { to: 'mill', from: 'hallway' });
        await new Promise(r => setTimeout(r, 0));

        expect(seenLogs.some(({ msg }) => String(msg).includes('crafting station'))).toBe(true);
        bus.off('log', handler);
    });

    test('saveLocalState not called when to === from', async () => {
        const { saveLocalState } = await import('../state/persistence.js');
        saveLocalState.mockClear();

        bus.emit('player:move', { to: 'cellar', from: 'cellar' });
        await new Promise(r => setTimeout(r, 0));

        expect(saveLocalState).not.toHaveBeenCalled();
    });
});

describe('Phase 8.6/8.95 event wiring', () => {
    test('world:event has a real UI consumer via setupGlobalEvents', async () => {
        const { setupGlobalEvents } = await import('../main/events.js');
        const { showToast } = await import('../graphics/renderer.js');

        setupGlobalEvents();
        bus.emit('world:event', { event: { type: 'wandering_trader' }, scarcity: [], surplus: [], weather: 'clear' });
        await new Promise(r => setTimeout(r, 0));

        expect(showToast).toHaveBeenCalledWith('Wandering Trader');
    });
});

// ─── Phase 8.6: real player-facing event paths ──────────────────────────────

describe('Phase 8.6 — player-facing event behavior', () => {
    beforeEach(() => {
        Object.assign(localPlayer, {
            gold: 0,
            inventory: [],
            location: 'market',
            quests: {},
            equipped: { weapon: null, armor: null },
            statusEffects: [],
            buffs: {},
        });
    });

    test('bounty_hunt doubles contraband payout through /sell', async () => {
        const { handleNPCCommands } = await import('../commands/npc.js');
        const { worldState } = await import('../state/store.js');

        worldState.event = { type: 'bounty_hunt' };
        localPlayer.location = 'hallway';
        localPlayer.inventory = ['bandit_mask'];

        await handleNPCCommands('sell', ['sell', 'bandit mask']);

        expect(localPlayer.gold).toBe(80);
        expect(localPlayer.inventory).not.toContain('bandit_mask');
    });

    test('wandering_trader exposes rare wares in the actual merchant menu', async () => {
        const { worldState } = await import('../state/store.js');
        const { buildCanvasMenu } = await import('../ui/canvas-menu.js');

        worldState.event = { type: 'wandering_trader' };
        const menu = buildCanvasMenu('shop', { npcId: 'merchant' }, {
            localPlayer,
            world: (await import('../content/data.js')).world,
            worldState,
            getTimeOfDay: () => 'day',
            getNPCsAt: () => ['merchant'],
        });

        expect(menu.entries.some((entry) => entry.label.startsWith('Steel Sword'))).toBe(true);
        expect(menu.entries.some((entry) => entry.label.startsWith('Old Tome'))).toBe(true);
    });

    test('wandering_trader rare wares can actually be bought', async () => {
        const { handleNPCCommands } = await import('../commands/npc.js');
        const { worldState } = await import('../state/store.js');

        worldState.event = { type: 'wandering_trader' };
        localPlayer.gold = 500;
        localPlayer.location = 'market';

        await handleNPCCommands('buy', ['buy', 'steel sword']);

        expect(localPlayer.inventory).toContain('steel_sword');
        expect(localPlayer.gold).toBe(350);
    });
});

// ─── BUG 5: fetch quest complete checks live inventory ───────────────────────

describe('Bug 5 — fetch quest completion validates live inventory count', () => {
    beforeEach(() => {
        Object.assign(localPlayer, {
            location: 'herbalist_hut',
            gold: 0, xp: 0, level: 1,
            inventory: ['herbs', 'herbs', 'herbs'],
            quests: { herb_gathering: { progress: 3, completed: false } },
            equipped: { weapon: null, armor: null },
            statusEffects: [], buffs: {},
        });
    });

    test('quest completes when player holds required item count', async () => {
        const { handleNPCCommands } = await import('../commands/npc.js');
        await handleNPCCommands('quest', ['quest', 'complete', 'herb_gathering']);
        expect(localPlayer.quests.herb_gathering.completed).toBe(true);
    });

    test('quest blocked and explains shortfall when items were sold after progress was set', async () => {
        localPlayer.inventory = [];
        const { log } = await import('../ui/index.js');
        log.mockClear();
        const { handleNPCCommands } = await import('../commands/npc.js');
        await handleNPCCommands('quest', ['quest', 'complete', 'herb_gathering']);
        expect(localPlayer.quests.herb_gathering.completed).toBe(false);
        const allLogs = log.mock.calls.map(c => c[0]);
        expect(allLogs.some(m => m.includes('more'))).toBe(true);
    });
});

// ─── BUG 6: saveLocalState called after kill ─────────────────────────────────

describe('Bug 6 — saveLocalState called after kill victory', () => {
    test('saveLocalState is called at end of handleVictory', async () => {
        const { saveLocalState } = await import('../state/persistence.js');
        saveLocalState.mockClear();

        const { WorldStore } = await import('../domain/ecs.js');
        const { Component } = await import('../domain/components.js');
        const { CombatSystem } = await import('../systems/combat-system.js');
        const { shardEnemies, worldState } = await import('../state/store.js');

        const rules = await import('../rules/index.js');
        rules.rollLoot.mockReturnValue([]);

        Object.assign(localPlayer, {
            xp: 0, level: 1, gold: 0, inventory: [], quests: {},
            currentEnemy: null, combatRound: 0, actionIndex: 0,
            statusEffects: [], buffs: {}, forestFights: 15,
            equipped: { weapon: null, armor: null },
        });

        const world = new WorldStore();
        const entityId = world.createEntity();
        world.setComponent(entityId, Component.Transform, { mapId: 'cellar', x: 5, y: 5, facing: 's' });

        const system = new CombatSystem(
            world,
            { localPlayer, worldState, shardEnemies },
            { cellar: { id: 'cellar', width: 10, height: 10 } },
            { sendActionLog: jest.fn(), sendPresenceSingle: jest.fn() }
        );

        await system.handleVictory('cellar', 'cellar_rat', { xp: 5, name: 'Rat' }, () => 0);

        expect(saveLocalState).toHaveBeenCalled();
    });
});

// ─── BUG 7: null-receiver quest double-reward prevention ─────────────────────

describe('Bug 7 — auto-completed explore quests cannot be double-rewarded', () => {
    beforeEach(() => {
        Object.assign(localPlayer, {
            location: 'throne_room',
            xp: 500, gold: 100, level: 5,
            inventory: ['magic_staff'],
            quests: {
                ancient_throne: { progress: 1, completed: true },
                wraith_banish: { progress: 1, completed: true },
                cave_troll_bounty: { progress: 1, completed: true },
            },
            equipped: { weapon: null, armor: null },
            statusEffects: [], buffs: {},
        });
    });

    test('already-completed quest yields no XP or gold on /quest complete', async () => {
        const { handleNPCCommands } = await import('../commands/npc.js');
        const xpBefore = localPlayer.xp;
        const goldBefore = localPlayer.gold;

        await handleNPCCommands('quest', ['quest', 'complete', 'ancient_throne']);

        expect(localPlayer.xp).toBe(xpBefore);
        expect(localPlayer.gold).toBe(goldBefore);
    });
});

// ─── 8.78h: forage/gather path must advance fetch quest progress ──────────────

describe('8.78h — forage path advances fetch quest progress', () => {
    beforeEach(() => {
        Object.assign(localPlayer, {
            hp: 20, maxHp: 20, attack: 1, defense: 0, xp: 0, level: 1,
            gold: 0, inventory: [], currentEnemy: null, combatRound: 0,
            actionIndex: 0, statusEffects: [], buffs: {}, forestFights: 15,
            location: 'forest_edge',
            quests: { gather_wood: { progress: 0, completed: false } },
            equipped: { weapon: null, armor: null },
            gatheredNodes: { day: 0, nodes: new Set() },
        });
    });

    test('standing on a log node and interacting grants wood and advances gather_wood quest', async () => {
        const { WorldStore } = await import('../domain/ecs.js');
        const { Component } = await import('../domain/components.js');
        const { MovementSystem } = await import('../systems/movement-system.js');
        const { worldState } = await import('../state/store.js');
        const { getScatteredContent } = await import('../rules/index.js');

        worldState.day = 1;

        // Inject a log resource node at (3,3) so handleInteract finds it
        getScatteredContent.mockReturnValue([
            { x: 3, y: 3, type: 'resource', label: 'log', w: 1, h: 1 },
        ]);

        const world = new WorldStore();
        const entityId = world.createEntity();
        world.setComponent(entityId, Component.Transform, { mapId: 'forest_edge', x: 3, y: 3, facing: 's' });
        world.setComponent(entityId, Component.PlayerControlled, {});

        const roomData = { forest_edge: { width: 21, height: 21, scenery: [], exitTiles: [], tileOverrides: [] } };
        const system = new MovementSystem(world, roomData, {});

        await system.handleInteract(entityId, world.getComponent(entityId, Component.Transform));

        expect(localPlayer.inventory).toContain('wood');
        expect(localPlayer.quests.gather_wood.progress).toBe(1);
    });

    test('gathering same node twice same day is blocked', async () => {
        const { WorldStore } = await import('../domain/ecs.js');
        const { Component } = await import('../domain/components.js');
        const { MovementSystem } = await import('../systems/movement-system.js');
        const { worldState } = await import('../state/store.js');
        const { getScatteredContent } = await import('../rules/index.js');

        worldState.day = 2;
        localPlayer.gatheredNodes = { day: 2, nodes: new Set(['forest_edge:3,3']) };

        getScatteredContent.mockReturnValue([
            { x: 3, y: 3, type: 'resource', label: 'log', w: 1, h: 1 },
        ]);

        const world = new WorldStore();
        const entityId = world.createEntity();
        world.setComponent(entityId, Component.Transform, { mapId: 'forest_edge', x: 3, y: 3, facing: 's' });

        const roomData = { forest_edge: { width: 21, height: 21, scenery: [], exitTiles: [], tileOverrides: [] } };
        const system = new MovementSystem(world, roomData, {});

        const seenLogs = [];
        bus.on('log', (p) => seenLogs.push(p));
        await system.handleInteract(entityId, world.getComponent(entityId, Component.Transform));
        bus.off('log', (p) => seenLogs.push(p));

        expect(localPlayer.inventory).not.toContain('wood');
        expect(seenLogs.some(p => p.msg?.includes('already gathered'))).toBe(true);
    });
});
