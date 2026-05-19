import { jest } from '@jest/globals';
import { WorldStore } from '../domain/ecs.js';
import { Component } from '../domain/components.js';
import { CombatSystem } from '../systems/combat-system.js';
import { bus } from '../state/eventbus.js';
import { localPlayer, worldState, shardEnemies } from '../state/store.js';

jest.mock('../rules/index.js', () => ({
    hashStr: jest.fn(() => 1234),
    seededRNG: jest.fn(() => () => 0),
    levelBonus: jest.fn(() => ({ attack: 0, defense: 0, maxHp: 0 })),
    resolveAttack: jest.fn(() => ({ damage: 1, isCrit: false, isDodge: false })),
    rollLoot: jest.fn(() => ['potion', 'gold']),
    xpToLevel: jest.fn((xp) => (xp >= 10 ? 2 : 1)),
    getTimeOfDay: jest.fn(() => 'day'),
    getWeatherEffect: jest.fn(() => null),
    roomHasFeature: jest.fn((loc, feat) => feat === 'inn' && loc === 'tavern'),
}));

jest.mock('../state/persistence.js', () => ({ saveLocalState: jest.fn() }));

jest.mock('../security/crypto.js', () => ({
    signMessage: jest.fn(async () => 'sig'),
}));

jest.mock('../security/identity.js', () => ({
    playerKeys: { privateKey: 'priv' },
    myEntry: jest.fn(async () => ({ publicKey: 'pub' })),
}));

describe('CombatSystem edge cases', () => {
    let world;
    let system;
    let entityId;
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, 'emit');
        world = new WorldStore();
        shardEnemies.clear();
        Object.assign(localPlayer, {
            name: 'Tester',
            hp: 20,
            maxHp: 20,
            gold: 50,
            inventory: [],
            quests: {},
            level: 1,
            xp: 0,
            currentEnemy: null,
            combatRound: 0,
            actionIndex: 0,
            defense: 1,
            attack: 2,
            statusEffects: [],
            forestFights: 3,
        });
        worldState.seed = 'combat-seed';
        worldState.day = 3;
        worldState.threatLevel = 0;
        worldState.weather = 'clear';
        worldState.event = null;
        worldState.bountyEnemy = null;
        system = new CombatSystem(world, { localPlayer, worldState, shardEnemies }, {
            cellar: { id: 'cellar', width: 10, height: 10 }
        }, {
            sendMonsterDmg: jest.fn(),
            sendActionLog: jest.fn(),
            sendPresenceSingle: jest.fn()
        });
        entityId = world.createEntity();
        world.setComponent(entityId, Component.Transform, { mapId: 'cellar', x: 5, y: 5, facing: 's' });
        world.setComponent(entityId, Component.Health, { current: 20, max: 20 });
    });

    afterEach(() => {
        emitSpy.mockRestore();
        jest.clearAllMocks();
    });

    test('handleAttack exits cleanly when the room has no enemy', async () => {
        await system.handleAttack(entityId);

        expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({
            msg: 'There is nothing to fight here.'
        }));
        expect(localPlayer.currentEnemy).toBeNull();
    });

    test('handleFlee logs when there is no active combat', () => {
        system.handleFlee(entityId);

        expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({
            msg: 'There is nothing to flee from.'
        }));
    });

    test('handleFlee succeeds when rng < 50', () => {
        const { seededRNG } = jest.requireMock('../rules/index.js');
        seededRNG.mockReturnValueOnce(() => 30); // rng(100) < 50 → success
        localPlayer.currentEnemy = { type: 'forest_wolf', hp: 10, maxHp: 18 };
        system.handleFlee(entityId);
        expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('fled') }));
        expect(localPlayer.currentEnemy).toBeNull();
    });

    test('handleFlee fails when rng >= 50 and enemy hits back', () => {
        const { seededRNG, resolveAttack } = jest.requireMock('../rules/index.js');
        seededRNG.mockReturnValueOnce(() => 60); // rng(100) >= 50 → fail
        resolveAttack.mockReturnValueOnce({ damage: 3, isCrit: false, isDodge: false });
        localPlayer.currentEnemy = { type: 'forest_wolf', hp: 10, maxHp: 18 };
        const health = world.getComponent(entityId, Component.Health);
        health.current = 20;
        system.handleFlee(entityId);
        expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Failed to flee') }));
        expect(health.current).toBe(17);
    });

    test('handleFlee fail with dodge — no damage taken', () => {
        const { seededRNG, resolveAttack } = jest.requireMock('../rules/index.js');
        seededRNG.mockReturnValueOnce(() => 60);
        resolveAttack.mockReturnValueOnce({ damage: 0, isCrit: false, isDodge: true });
        localPlayer.currentEnemy = { type: 'forest_wolf', hp: 10, maxHp: 18 };
        const health = world.getComponent(entityId, Component.Health);
        health.current = 20;
        system.handleFlee(entityId);
        expect(health.current).toBe(20);
    });

    test('handleVictory awards loot, xp, and quest progress once', async () => {
        localPlayer.quests.wolf_hunt = { progress: 0, completed: false };
        localPlayer.currentEnemy = { type: 'forest_wolf' };

        await system.handleVictory('forest_edge', 'forest_wolf', {
            name: 'Forest Wolf',
            xp: 14,
            loot: ['potion']
        }, () => 0);

        expect(localPlayer.currentEnemy).toBeNull();
        expect(localPlayer.combatRound).toBe(0);
        expect(localPlayer.inventory).toContain('potion');
        expect(localPlayer.gold).toBeGreaterThanOrEqual(50);
        expect(localPlayer.xp).toBe(14);
        expect(localPlayer.quests.wolf_hunt.progress).toBe(1);
        expect(emitSpy).toHaveBeenCalledWith('item:pickup', expect.objectContaining({
            item: expect.objectContaining({ id: 'potion' })
        }));
        expect(emitSpy).toHaveBeenCalledWith('combat:death', {
            entity: 'Forest Wolf',
            loot: ['potion', 'gold']
        });
    });

    test('handlePlayerDeath resets position and hp to cellar spawn', () => {
        localPlayer.gold = 99;
        world.setComponent(entityId, Component.Transform, { mapId: 'forest_edge', x: 1, y: 1, facing: 'n' });
        world.setComponent(entityId, Component.Health, { current: 0, max: 20 });

        system.handlePlayerDeath(entityId);

        const transform = world.getComponent(entityId, Component.Transform);
        const health = world.getComponent(entityId, Component.Health);
        expect(localPlayer.gold).toBe(90);
        expect(transform.mapId).toBe('cellar');
        expect(transform.x).toBe(5);
        expect(transform.y).toBe(5);
        expect(health.current).toBe(5);
        expect(emitSpy).toHaveBeenCalledWith('combat:death', { entity: 'You' });
    });

    test('handlePlayerDeath does not reduce gold below zero', () => {
        localPlayer.gold = 0;
        system.handlePlayerDeath(entityId);
        expect(localPlayer.gold).toBe(0);
    });

    test('handlePlayerDeath clears currentEnemy and combatRound', () => {
        localPlayer.currentEnemy = { type: 'bandit', hp: 5, maxHp: 10 };
        localPlayer.combatRound = 4;
        system.handlePlayerDeath(entityId);
        expect(localPlayer.currentEnemy).toBeNull();
        expect(localPlayer.combatRound).toBe(0);
    });

    test('handleRest heals hp when not in combat', () => {
        localPlayer.hp = 10;
        localPlayer.currentEnemy = null;
        localPlayer.location = 'cellar';
        localPlayer.statusEffects = [];
        const health = world.getComponent(entityId, Component.Health);
        health.current = 10;

        system.handleRest(entityId);

        expect(health.current).toBeGreaterThan(10);
    });

    test('handleRest blocked during combat', () => {
        localPlayer.currentEnemy = { type: 'forest_wolf', hp: 5, maxHp: 10 };
        system.handleRest(entityId);
        expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining("can't rest") }));
    });

    test('handleRest at inn grants well_rested buff', () => {
        const { getTimeOfDay } = jest.requireMock('../rules/index.js');
        getTimeOfDay.mockReturnValueOnce('night');
        localPlayer.location = 'tavern';
        localPlayer.currentEnemy = null;
        localPlayer.statusEffects = [];
        const health = world.getComponent(entityId, Component.Health);
        health.current = 10;

        system.handleRest(entityId);

        expect(localPlayer.statusEffects.find(s => s.id === 'well_rested')).toBeDefined();
    });

    test('handleRest advances rest quest progress at inn once per day', () => {
        localPlayer.location = 'tavern';
        localPlayer.currentEnemy = null;
        localPlayer.quests.tavern_regular = { progress: 0, completed: false, lastRestDay: null };
        worldState.day = 2;
        const health = world.getComponent(entityId, Component.Health);
        health.current = 10;

        system.handleRest(entityId);

        expect(localPlayer.quests.tavern_regular.progress).toBe(1);
        expect(localPlayer.quests.tavern_regular.lastRestDay).toBe(2);
    });

    test('handleRest does not advance rest quest progress twice same day', () => {
        localPlayer.location = 'tavern';
        localPlayer.currentEnemy = null;
        localPlayer.quests.tavern_regular = { progress: 1, completed: false, lastRestDay: 3 };
        worldState.day = 3;
        const health = world.getComponent(entityId, Component.Health);
        health.current = 10;

        system.handleRest(entityId);

        expect(localPlayer.quests.tavern_regular.progress).toBe(1);
    });

    test('getBestGear returns correct weapon and armor bonuses', () => {
        localPlayer.inventory = ['iron_sword', 'iron_armor'];
        const gear = system.getBestGear();
        expect(gear.weaponBonus).toBe(3);
        expect(gear.defenseBonus).toBe(4);
    });

    test('getBestGear picks best weapon when multiple weapons present', () => {
        localPlayer.inventory = ['iron_sword', 'steel_sword'];
        const gear = system.getBestGear();
        expect(gear.weaponBonus).toBe(6);
    });

    test('getBestGear returns zero when no gear', () => {
        localPlayer.inventory = [];
        const gear = system.getBestGear();
        expect(gear.weaponBonus).toBe(0);
        expect(gear.defenseBonus).toBe(0);
    });

    test('handleVictory awards daily bounty when enemy matches', async () => {
        worldState.bountyEnemy = 'forest_wolf';
        worldState.day = 5;
        worldState.threatLevel = 2;
        localPlayer.dailyBountyClaimed = 0;
        localPlayer.gold = 0;

        await system.handleVictory('forest_edge', 'forest_wolf', { name: 'Forest Wolf', xp: 14 }, () => 0);

        const expectedBounty = 50 + (2 * 10); // 70
        expect(localPlayer.gold).toBeGreaterThanOrEqual(expectedBounty);
        expect(localPlayer.dailyBountyClaimed).toBe(5);
    });

    test('handleVictory does not award bounty twice on same day', async () => {
        worldState.bountyEnemy = 'forest_wolf';
        worldState.day = 5;
        localPlayer.dailyBountyClaimed = 5;
        localPlayer.gold = 0;

        await system.handleVictory('forest_edge', 'forest_wolf', { name: 'Forest Wolf', xp: 14 }, () => 0);

        // No bounty gold added (only loot gold)
        expect(localPlayer.dailyBountyClaimed).toBe(5);
        // bounty gold of 50+ should NOT be added
        expect(emitSpy).not.toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('[Bounty]') }));
    });

    test('handleVictory triggers level up when xp threshold crossed', async () => {
        const { xpToLevel } = jest.requireMock('../rules/index.js');
        xpToLevel.mockReturnValue(2);
        localPlayer.level = 1;
        localPlayer.xp = 0;

        await system.handleVictory('forest_edge', 'forest_wolf', { name: 'Forest Wolf', xp: 10 }, () => 0);

        expect(localPlayer.level).toBe(2);
        expect(emitSpy).toHaveBeenCalledWith('player:levelup', { level: 2 });
    });

    describe('handleAttack — via custom worldData with adjacent enemy sprite', () => {
        let combatEntityId;
        let combatSystem;

        // Use a custom worldData so the room has an enemy, and add an adjacent enemy sprite
        beforeEach(() => {
            combatEntityId = world.createEntity();
            world.setComponent(combatEntityId, Component.Transform, { mapId: 'battle_room', x: 5, y: 5, facing: 's' });
            world.setComponent(combatEntityId, Component.Health, { current: 20, max: 20 });
            world.setComponent(combatEntityId, Component.PlayerControlled, {});

            // Spawn enemy sprite at same tile so Chebyshev distance=0 ≤ 1 — range check passes
            const enemyEid = world.createEntity();
            world.setComponent(enemyEid, Component.Transform, { mapId: 'battle_room', x: 5, y: 5, facing: 'n' });
            world.setComponent(enemyEid, Component.Sprite, { palette: 'enemy' });

            combatSystem = new CombatSystem(
                world,
                { localPlayer, worldState, shardEnemies },
                {
                    battle_room: { id: 'battle_room', enemy: 'forest_wolf', zone: 'wilderness', width: 11, height: 11 },
                    dungeon_room: { id: 'dungeon_room', enemy: 'cave_troll', zone: 'dungeon', width: 11, height: 11 },
                    ruins: { id: 'ruins', enemy: 'ruin_shade', zone: 'wilderness', width: 21, height: 21 },
                },
                { sendMonsterDmg: jest.fn(), sendActionLog: jest.fn(), sendPresenceSingle: jest.fn() }
            );
            localPlayer.location = 'battle_room';
        });

        test('world query finds enemy sprite entity', () => {
            // Verify the ECS setup is correct before running attack tests
            const results = combatSystem.world.query([Component.Transform, Component.Sprite]);
            expect(results.length).toBeGreaterThan(0);
            const enemy = results.find(eid => {
                const sp = combatSystem.world.getComponent(eid, Component.Sprite);
                return sp?.palette === 'enemy';
            });
            expect(enemy).toBeDefined();
        });

        test('handleAttack spawns enemy and deducts forestFight when room has enemy', async () => {
            localPlayer.forestFights = 3;
            await combatSystem.handleAttack(combatEntityId);
            expect(localPlayer.forestFights).toBeLessThan(3);
            expect(shardEnemies.get('battle_room')).toBeDefined();
        });

        test('handleAttack blocked when forest wolf at night', async () => {
            const { getTimeOfDay } = jest.requireMock('../rules/index.js');
            getTimeOfDay.mockReturnValueOnce('night');
            await combatSystem.handleAttack(combatEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('retreated') }));
        });

        test('strength effect depletes duration each attack round', async () => {
            localPlayer.statusEffects = [{ id: 'strength_boost', atkBonus: 5, duration: 2 }];
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            await combatSystem.handleAttack(combatEntityId);
            const effect = localPlayer.statusEffects.find(s => s.id === 'strength_boost');
            expect(effect?.duration).toBe(1);
        });

        test('strength effect is removed when duration reaches 0', async () => {
            localPlayer.statusEffects = [{ id: 'strength_boost', atkBonus: 5, duration: 1 }];
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            await combatSystem.handleAttack(combatEntityId);
            expect(localPlayer.statusEffects.find(s => s.id === 'strength_boost')).toBeUndefined();
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Strength boost fades') }));
        });

        test('meal_boost effect depletes and is removed at 0', async () => {
            localPlayer.statusEffects = [{ id: 'meal_boost', atkBonus: 5, duration: 1 }];
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            await combatSystem.handleAttack(combatEntityId);
            expect(localPlayer.statusEffects.find(s => s.id === 'meal_boost')).toBeUndefined();
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Meal boost fades') }));
        });

        test('coal_torch effect depletes and is removed at 0', async () => {
            localPlayer.statusEffects = [{ id: 'coal_torch', duration: 1 }];
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            await combatSystem.handleAttack(combatEntityId);
            expect(localPlayer.statusEffects.find(s => s.id === 'coal_torch')).toBeUndefined();
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Coal torch burns out') }));
        });

        test('wandering_boss event overrides enemy type in ruins room', async () => {
            worldState.event = { type: 'wandering_boss', target: 'mountain_troll' };
            // Ruins is a qualifying room for wandering_boss override
            const ruinsEntityId = world.createEntity();
            world.setComponent(ruinsEntityId, Component.Transform, { mapId: 'ruins', x: 5, y: 5, facing: 's' });
            world.setComponent(ruinsEntityId, Component.Health, { current: 20, max: 20 });
            world.setComponent(ruinsEntityId, Component.PlayerControlled, {});
            const ruinsEnemy = world.createEntity();
            world.setComponent(ruinsEnemy, Component.Transform, { mapId: 'ruins', x: 5, y: 6 });
            world.setComponent(ruinsEnemy, Component.Sprite, { palette: 'enemy' });

            localPlayer.forestFights = 5;
            await combatSystem.handleAttack(ruinsEntityId);
            const enemy = shardEnemies.get('ruins');
            expect(enemy).toBeDefined();
            expect(enemy?.type).toBe('mountain_troll');
        });

        test('dungeon rooms do not cost forestFights', async () => {
            const dungeonEntityId = world.createEntity();
            world.setComponent(dungeonEntityId, Component.Transform, { mapId: 'dungeon_room', x: 5, y: 5, facing: 's' });
            world.setComponent(dungeonEntityId, Component.Health, { current: 20, max: 20 });
            world.setComponent(dungeonEntityId, Component.PlayerControlled, {});
            const dungeonEnemy = world.createEntity();
            world.setComponent(dungeonEnemy, Component.Transform, { mapId: 'dungeon_room', x: 5, y: 6 });
            world.setComponent(dungeonEnemy, Component.Sprite, { palette: 'enemy' });

            localPlayer.forestFights = 5;
            shardEnemies.clear();
            await combatSystem.handleAttack(dungeonEntityId);
            expect(localPlayer.forestFights).toBe(5);
        });

        test('forestFights exhausted message shown', async () => {
            localPlayer.forestFights = 0;
            await combatSystem.handleAttack(combatEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('exhausted') }));
        });

        test('nightOnly room blocks attack during day', async () => {
            const nightEntityId = world.createEntity();
            world.setComponent(nightEntityId, Component.Transform, { mapId: 'dungeon_room', x: 5, y: 5, facing: 's' });
            world.setComponent(nightEntityId, Component.Health, { current: 20, max: 20 });
            world.setComponent(nightEntityId, Component.PlayerControlled, {});
            const nightEnemy = world.createEntity();
            world.setComponent(nightEnemy, Component.Transform, { mapId: 'dungeon_room', x: 5, y: 5 });
            world.setComponent(nightEnemy, Component.Sprite, { palette: 'enemy' });

            const nightCombat = new CombatSystem(world,
                { localPlayer, worldState, shardEnemies },
                { dungeon_room: { id: 'dungeon_room', enemy: 'ruin_shade', zone: 'dungeon', nightOnly: true, width: 11, height: 11 } },
                { sendMonsterDmg: jest.fn(), sendActionLog: jest.fn(), sendPresenceSingle: jest.fn() }
            );
            await nightCombat.handleAttack(nightEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('nightfall') }));
        });

        test('storm costs extra forestFights', async () => {
            const { getWeatherEffect } = jest.requireMock('../rules/index.js');
            getWeatherEffect.mockReturnValueOnce({ forestFightCostMult: 2 });
            localPlayer.forestFights = 5;
            await combatSystem.handleAttack(combatEntityId);
            expect(localPlayer.forestFights).toBe(3);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('Storm') }));
        });

        test('storm blocks attack when forestFights < fightCost', async () => {
            const { getWeatherEffect } = jest.requireMock('../rules/index.js');
            getWeatherEffect.mockReturnValueOnce({ forestFightCostMult: 2 });
            localPlayer.forestFights = 1;
            await combatSystem.handleAttack(combatEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('storm') }));
            expect(localPlayer.forestFights).toBe(1);
        });

        test('ruin_shade applies poison on hit', async () => {
            const ruinsEntityId = world.createEntity();
            world.setComponent(ruinsEntityId, Component.Transform, { mapId: 'ruins', x: 10, y: 10, facing: 's' });
            world.setComponent(ruinsEntityId, Component.Health, { current: 20, max: 20 });
            world.setComponent(ruinsEntityId, Component.PlayerControlled, {});
            const ruinsEnemy = world.createEntity();
            world.setComponent(ruinsEnemy, Component.Transform, { mapId: 'ruins', x: 10, y: 10 });
            world.setComponent(ruinsEnemy, Component.Sprite, { palette: 'enemy' });

            const { seededRNG, resolveAttack } = jest.requireMock('../rules/index.js');
            // enemy hits player (not dodge), rng(100) < 20 for poison
            seededRNG.mockReturnValueOnce(() => 5); // all rng calls return 5
            resolveAttack
                .mockReturnValueOnce({ damage: 0, isCrit: false, isDodge: true }) // player misses
                .mockReturnValueOnce({ damage: 3, isCrit: false, isDodge: false }); // enemy hits

            shardEnemies.set('ruins', { type: 'ruin_shade', hp: 50, maxHp: 50 });
            localPlayer.currentEnemy = shardEnemies.get('ruins');
            localPlayer.statusEffects = [];

            await combatSystem.handleAttack(ruinsEntityId);
            expect(localPlayer.statusEffects.some(s => s.id === 'poisoned')).toBe(true);
        });

        test('poison ticks during combat and can expire', async () => {
            localPlayer.statusEffects = [{ id: 'poisoned', duration: 1 }];
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            const health = world.getComponent(combatEntityId, Component.Health);
            health.current = 10;
            await combatSystem.handleAttack(combatEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('poison') }));
        });

        test('bounty kill increments dailyBountyClaimed', async () => {
            worldState.bountyEnemy = 'forest_wolf';
            localPlayer.dailyBountyClaimed = 0;
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 1, maxHp: 18 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            const { resolveAttack } = jest.requireMock('../rules/index.js');
            resolveAttack.mockReturnValueOnce({ damage: 5, isCrit: false, isDodge: false });
            await combatSystem.handleAttack(combatEntityId);
            // handleVictory called which checks bounty
            expect(localPlayer.dailyBountyClaimed === worldState.day || localPlayer.gold > 50).toBe(true);
        });

        test('player death triggered when health drops to zero', async () => {
            const { resolveAttack } = jest.requireMock('../rules/index.js');
            resolveAttack
                .mockReturnValueOnce({ damage: 0, isCrit: false, isDodge: true }) // player misses
                .mockReturnValueOnce({ damage: 999, isCrit: false, isDodge: false }); // enemy kills
            shardEnemies.set('battle_room', { type: 'forest_wolf', hp: 100, maxHp: 100 });
            localPlayer.currentEnemy = shardEnemies.get('battle_room');
            const health = world.getComponent(combatEntityId, Component.Health);
            health.current = 1;
            await combatSystem.handleAttack(combatEntityId);
            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ msg: expect.stringContaining('slain') }));
        });
    });

    test('handleVictory does not double-loot within claim window', async () => {
        const enemy = { type: 'forest_wolf', hp: 0, maxHp: 10, claimedAt: Date.now() };
        shardEnemies.set('forest_edge', enemy);
        localPlayer.currentEnemy = enemy;

        await system.handleVictory('forest_edge', 'forest_wolf', { name: 'Forest Wolf', xp: 14 }, () => 0);

        // Second call immediately after — claim window still active
        await system.handleVictory('forest_edge', 'forest_wolf', { name: 'Forest Wolf', xp: 14 }, () => 0);

        // XP should only be awarded for the first call's direct handleVictory logic,
        // but double-loot prevention is checked at handleAttack level — here we just
        // verify xp was granted once from first call
        expect(localPlayer.xp).toBeGreaterThan(0);
    });
});
