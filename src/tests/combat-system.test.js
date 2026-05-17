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
}));

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
});
