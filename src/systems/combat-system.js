// @ts-check

import { Component } from '../domain/components.js';
import { 
    hashStr, seededRNG, levelBonus, resolveAttack, rollLoot, xpToLevel, getTimeOfDay 
} from '../rules/index.js';
import { ENEMIES, ITEMS, QUESTS } from '../content/data.js';
import { bus } from '../state/eventbus.js';
import { selfId } from '../network/transport.js';
import { signMessage } from '../security/crypto.js';
import { playerKeys, myEntry } from '../security/identity.js';

/**
 * CombatSystem handles attack resolution and damage calculation.
 * Migrated from legacy command system in Phase 7.9.9.4.
 */
export class CombatSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {any} stores - { localPlayer, worldState, shardEnemies }
   * @param {any} gameActions - Network actions
   */
  constructor(world, stores, gameActions) {
    this.world = world;
    this.localPlayer = stores.localPlayer;
    this.worldState = stores.worldState;
    this.shardEnemies = stores.shardEnemies;
    this.gameActions = gameActions;
  }

  update() {
    const entities = this.world.query([Component.Intent, Component.Health, Component.Transform]);

    for (const entityId of entities) {
      const intent = this.world.getComponent(entityId, Component.Intent);
      if (intent.action === 'attack') {
        this.handleAttack(entityId);
        this.world.components.get(Component.Intent).delete(entityId);
      } else if (intent.action === 'die') {
        this.handlePlayerDeath(entityId);
        this.world.components.get(Component.Intent).delete(entityId);
      } else if (intent.action === 'flee') {
        this.handleFlee(entityId);
        this.world.components.get(Component.Intent).delete(entityId);
      } else if (intent.action === 'rest') {
        this.handleRest(entityId);
        this.world.components.get(Component.Intent).delete(entityId);
      }
    }
  }

  /**
   * @param {number} entityId
   */
  handleFlee(entityId) {
    if (!this.localPlayer.currentEnemy) { bus.emit('log', { msg: `There is nothing to flee from.` }); return; }
    const combatSeed = hashStr(this.worldState.seed + this.worldState.day + selfId + this.localPlayer.combatRound + 99);
    const rng = seededRNG(combatSeed);
    if (rng(100) < 50) {
        bus.emit('log', { msg: `You successfully fled from combat!`, color: '#0af' });
        this.localPlayer.currentEnemy = null;
        this.localPlayer.combatRound = 0;
        // The main loop will process any subsequent move intents
    } else {
        bus.emit('log', { msg: `Failed to flee! The enemy gets a free hit.`, color: '#f55' });
        const enemyDef = ENEMIES[this.localPlayer.currentEnemy.type];
        const scale = 1 + (this.worldState.threatLevel * 0.1);
        const scaledAtk = Math.floor(enemyDef.attack * scale);
        const bonus = levelBonus(this.localPlayer.level);
        const gear = this.getBestGear();
        const enemyRes = resolveAttack(scaledAtk, this.localPlayer.defense + bonus.defense + gear.defenseBonus, rng);
        if (!enemyRes.isDodge) {
            const health = this.world.getComponent(entityId, Component.Health);
            if (health) health.current -= enemyRes.damage;
            bus.emit('ui:shake');
            bus.emit('log', { msg: `${enemyDef.name} hits you for ${enemyRes.damage}!`, color: '#f55' });
            if (this.localPlayer.hp <= 0) this.handlePlayerDeath(entityId);
        }
    }
  }

  /**
   * @param {number} entityId
   */
  handleRest(entityId) {
    if (this.localPlayer.currentEnemy) { bus.emit('log', { msg: `You can't rest mid-combat!` }); return; }
    const bonus = levelBonus(this.localPlayer.level);
    const hasRestedBuff = this.localPlayer.statusEffects?.find(s => s.id === 'well_rested');
    const cap = this.localPlayer.maxHp + bonus.maxHp + (hasRestedBuff ? 5 : 0);
    const healed = Math.max(0, Math.min(10, cap - this.localPlayer.hp));
    
    const health = this.world.getComponent(entityId, Component.Health);
    if (health) health.current += healed;
    
    const isNight = getTimeOfDay() === 'night';
    const restMsg = (this.localPlayer.location === 'tavern' && isNight) 
        ? `You sleep until dawn and recover ${healed} HP.` 
        : `You rest and recover ${healed} HP.`;
    bus.emit('log', { msg: `${restMsg} (HP: ${this.localPlayer.hp}/${cap})`, color: '#0f0' });

    if (this.localPlayer.location === 'tavern' && !hasRestedBuff) {
        if (!this.localPlayer.statusEffects) this.localPlayer.statusEffects = [];
        this.localPlayer.statusEffects.push({ id: 'well_rested', duration: 100 });
        bus.emit('log', { msg: `The Tavern comfort makes you Well Rested! (+5 Max HP)`, color: '#0af' });
    }
  }

  /**
   * @param {number} entityId
   */
  async handleAttack(entityId) {
    const transform = this.world.getComponent(entityId, Component.Transform);
    const health = this.world.getComponent(entityId, Component.Health);
    if (!transform || !health) return;

    const locId = transform.mapId;
    const roomDef = this.worldState.rooms?.[locId] || {}; 
    const enemyType = roomDef.enemy;

    if (!enemyType) {
      bus.emit('log', { msg: `There is nothing to fight here.`, color: '#f55' });
      return;
    }

    if (enemyType === 'forest_wolf' && getTimeOfDay() === 'night') {
      bus.emit('log', { msg: `The wolves have retreated to their dens for the night.`, color: '#aaa' });
      return;
    }

    let sharedEnemy = this.shardEnemies.get(locId);
    const enemyDef = ENEMIES[enemyType];
    const scale = 1 + (this.worldState.threatLevel * 0.1);
    const scaledHP = Math.floor(enemyDef.hp * scale);
    const scaledAtk = Math.floor(enemyDef.attack * scale);
    const scaledDef = Math.floor(enemyDef.defense * scale);

    // 1. Initialize enemy if not present
    if (!sharedEnemy || sharedEnemy.hp <= 0) {
      if (this.localPlayer.forestFights <= 0) {
        bus.emit('log', { msg: `You are too exhausted to fight today.`, color: '#aaa' });
        return;
      }
      this.localPlayer.forestFights--;
      sharedEnemy = { type: enemyType, hp: scaledHP, maxHp: scaledHP };
      this.shardEnemies.set(locId, sharedEnemy);
      this.localPlayer.currentEnemy = sharedEnemy;
      bus.emit('log', { msg: `\nA ${enemyDef.name} snarls and lunges!`, color: '#f55' });
    } else {
      this.localPlayer.currentEnemy = sharedEnemy;
    }

    // 2. Resolve Round
    const combatSeed = hashStr(this.worldState.seed + this.worldState.day + selfId + this.localPlayer.combatRound);
    this.localPlayer.combatRound++;
    const rng = seededRNG(combatSeed);
    const bonus = levelBonus(this.localPlayer.level);
    
    const gear = this.getBestGear(); 
    const elixirBonus = (this.localPlayer.buffs?.activeElixir === 'strength_elixir') ? 5 : 0;

    const playerRes = resolveAttack(this.localPlayer.attack + bonus.attack + gear.weaponBonus + elixirBonus, scaledDef, rng);
    const isNight = getTimeOfDay() === 'night';
    const enemyRes = resolveAttack(scaledAtk, this.localPlayer.defense + bonus.defense + gear.defenseBonus, rng, isNight);

    // 3. Apply Player Attack
    if (playerRes.isDodge) {
      bus.emit('combat:dodge', { attacker: 'You', target: enemyDef.name });
    } else {
      sharedEnemy.hp -= playerRes.damage;
      bus.emit('combat:hit', { 
        attacker: 'You', 
        target: enemyDef.name, 
        damage: playerRes.damage, 
        crit: playerRes.isCrit,
        targetHP: Math.max(0, sharedEnemy.hp),
        targetMaxHP: sharedEnemy.maxHp
      });
      if (this.gameActions.sendMonsterDmg) {
        this.gameActions.sendMonsterDmg({ roomId: locId, damage: playerRes.damage });
      }
    }

    // 4. Apply Enemy Counter-Attack
    if (sharedEnemy.hp > 0) {
      if (enemyRes.isDodge) {
        bus.emit('combat:dodge', { attacker: enemyDef.name, target: 'You' });
      } else {
        health.current -= enemyRes.damage;
        const maxHp = this.localPlayer.maxHp + bonus.maxHp + (this.localPlayer.buffs?.rested ? 5 : 0);
        bus.emit('combat:hit', { 
          attacker: enemyDef.name, 
          target: 'You', 
          damage: enemyRes.damage, 
          crit: enemyRes.isCrit,
          targetHP: Math.max(0, health.current),
          targetMaxHP: maxHp
        });
        if (enemyRes.damage > 0) {
          bus.emit('ui:shake');
          if (enemyType === 'ruin_shade' && rng(100) < 20) {
            if (!this.localPlayer.statusEffects) this.localPlayer.statusEffects = [];
            if (!this.localPlayer.statusEffects.find(s => s.id === 'poisoned')) {
              this.localPlayer.statusEffects.push({ id: 'poisoned', duration: 5 });
              bus.emit('log', { msg: `You have been poisoned!`, color: '#f55' });
            }
          }
        }
      }
    }

    // 5. Handle Poison
    const poisonEffect = this.localPlayer.statusEffects?.find(s => s.id === 'poisoned');
    if (poisonEffect && sharedEnemy.hp > 0) {
      const poisonDmg = 1 + (rng(2));
      health.current -= poisonDmg;
      bus.emit('log', { msg: `Poison courses through you for ${poisonDmg} damage.`, color: '#a0f' });
      poisonEffect.duration--;
      if (poisonEffect.duration <= 0) {
        this.localPlayer.statusEffects = this.localPlayer.statusEffects.filter(s => s.id !== 'poisoned');
        bus.emit('log', { msg: `The poison has worn off.`, color: '#a0f' });
      }
    }

    // 6. Handle Death/Loot
    if (sharedEnemy.hp <= 0) {
      this.handleVictory(locId, enemyType, enemyDef, rng);
    }

    if (health.current <= 0) {
      this.handlePlayerDeath(entityId);
    }
  }

  getBestGear() {
    let weaponBonus = 0;
    let defenseBonus = 0;
    (this.localPlayer.inventory || []).forEach(itemId => {
      const item = ITEMS[itemId];
      if (item?.type === 'weapon') weaponBonus = Math.max(weaponBonus, item.bonus || 0);
      if (item?.type === 'armor') defenseBonus = Math.max(defenseBonus, item.bonus || 0);
    });
    return { weaponBonus, defenseBonus };
  }

  /**
   * @param {string} locId
   * @param {string} enemyType
   * @param {any} enemyDef
   * @param {any} rng
   */
  async handleVictory(locId, enemyType, enemyDef, rng) {
    this.localPlayer.statusEffects = (this.localPlayer.statusEffects || []).filter(s => s.id !== 'poisoned');
    this.localPlayer.currentEnemy = null;
    const loot = rollLoot(enemyType, rng);
    this.localPlayer.xp += enemyDef.xp;
    this.localPlayer.combatRound = 0;
    const newLevel = xpToLevel(this.localPlayer.xp);

    this.localPlayer.actionIndex++;
    const actionData = {
      type: 'kill',
      index: this.localPlayer.actionIndex,
      target: enemyType,
      data: 0
    };

    if (playerKeys.privateKey) {
      const sig = await signMessage(JSON.stringify(actionData), playerKeys.privateKey);
      if (this.gameActions.sendActionLog) this.gameActions.sendActionLog({ ...actionData, signature: sig });
    }

    loot.forEach(itemId => {
      if (ITEMS[itemId]?.type === 'gold') this.localPlayer.gold += ITEMS[itemId].amount;
      else {
        this.localPlayer.inventory.push(itemId);
      }
    });

    bus.emit('combat:death', { entity: enemyDef.name, loot });
    
    // Quest Progress
    Object.keys(this.localPlayer.quests || {}).forEach(qid => {
      const q = QUESTS[qid];
      const pq = this.localPlayer.quests[qid];
      if (q && pq && !pq.completed && q.type === 'kill' && q.objective.target === enemyType) {
        pq.progress = Math.min(q.objective.count, pq.progress + 1);
        bus.emit('quest:progress', { name: q.name, current: pq.progress, total: q.objective.count });
      }
    });

    if (newLevel > this.localPlayer.level) {
      this.localPlayer.level = newLevel;
      bus.emit('player:levelup', { level: this.localPlayer.level });
      const entry = await myEntry();
      if (entry && this.gameActions.sendPresenceSingle) this.gameActions.sendPresenceSingle(entry);
    }
  }

  /**
   * @param {number} entityId
   */
  handlePlayerDeath(entityId) {
    bus.emit('log', { msg: `You have been slain! 💀`, color: '#f00' });
    bus.emit('ui:shake');
    const goldLoss = Math.floor(this.localPlayer.gold * 0.1);
    if (goldLoss > 0) {
      this.localPlayer.gold -= goldLoss;
      bus.emit('log', { msg: `You dropped ${goldLoss} gold.`, color: '#f55' });
    }
    
    // Reset player state
    const health = this.world.getComponent(entityId, Component.Health);
    if (health) health.current = 5;
    
    const transform = this.world.getComponent(entityId, Component.Transform);
    if (transform) {
        transform.mapId = 'cellar';
        transform.x = 5;
        transform.y = 5;
    }

    this.localPlayer.currentEnemy = null;
    this.localPlayer.combatRound = 0;
    
    bus.emit('combat:death', { entity: 'You' });
    bus.emit('log', { msg: `You awaken in the cellar...`, color: '#aaa' });
  }
}
