// @ts-check

import { Component } from '../domain/components.js';

/**
 * WorldSyncSystem ensures entities in the canonical stores (players, shardEnemies)
 * are projected into the ECS for rendering and logic.
 */
export class WorldSyncSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} stores - { players, shardEnemies, NPCS, localPlayer }
     * @param {any} worldData
     */
    constructor(world, stores, worldData) {
        this.world = world;
        this.stores = stores;
        this.worldData = worldData;
        this.entityMap = new Map(); // originalId -> entityId
        this.prevPos = new Map();   // peerId -> { x, y, location }
    }

    update() {
        const { players, shardEnemies, NPCS, localPlayer } = this.stores;
        const currentLoc = localPlayer.location;
        const roomData = this.worldData[currentLoc];
        if (!roomData) return;

        // Track what's currently in the room to cleanup later
        const activeIds = new Set();

        // 1. Sync NPCs in current room
        const { getNPCLocation } = require('../rules/index.js');
        const { worldState } = require('../state/store.js');
        const { getTimeOfDay } = require('../rules/index.js');

        Object.keys(NPCS).forEach(id => {
            const staticEntry = (roomData.staticEntities || []).find(se => se.id === id);
            const dynamicLoc = getNPCLocation(id, worldState.seed, worldState.day);
            
            if (staticEntry || dynamicLoc === currentLoc) {
                activeIds.add(id);
                let eid = this.entityMap.get(id);
                if (!eid) {
                    eid = this.world.createEntity();
                    this.entityMap.set(id, eid);
                }
                
                const npcDef = NPCS[id];
                this.world.setComponent(eid, Component.Sprite, {
                    type: npcDef?.sprite || 'guard',
                    palette: npcDef?.palette || 'npc',
                    seed: this.hash(id),
                });
                if (staticEntry) {
                    this.world.setComponent(eid, Component.Transform, { mapId: currentLoc, x: staticEntry.x, y: staticEntry.y });
                } else {
                    const hash = this.hash(id + currentLoc);
                    const nx = (hash % Math.max(1, roomData.width - 2)) + 1;
                    const ny = ((hash >> 4) % Math.max(1, roomData.height - 2)) + 1;
                    this.world.setComponent(eid, Component.Transform, { mapId: currentLoc, x: nx, y: ny });
                }
                this.world.setComponent(eid, 'Identity', { name: npcDef.name, id });
            }
        });

        // 2. Sync Other Players
        players.forEach((p, id) => {
            if (p.location !== currentLoc || p.ghost) return;
            activeIds.add(id);

            const px = p.x || 0;
            const py = p.y || 0;
            let eid = this.entityMap.get(id);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(id, eid);
                this.world.setComponent(eid, Component.Sprite, { type: 'peer', palette: 'peer', seed: this.hash(id) });
            }
            const prev = this.prevPos.get(id);
            this.world.setComponent(eid, Component.Transform, { mapId: p.location, x: px, y: py, facing: p.direction || 's' });
            // Interpolate movement within the same room (same as local player)
            if (prev && prev.location === p.location && (prev.x !== px || prev.y !== py)) {
                this.world.setComponent(eid, Component.Tweenable, {
                    startX: prev.x, startY: prev.y,
                    targetX: px, targetY: py,
                    progress: 0
                });
            }
            this.prevPos.set(id, { x: px, y: py, location: p.location });
            this.world.setComponent(eid, Component.Health, { current: p.hp || 10, max: p.maxHp || 10 });
            this.world.setComponent(eid, 'Identity', { name: p.name || id, id });
        });

        // 3. Sync Shared Enemy
        const enemy = shardEnemies.get(currentLoc);
        const enemyType = roomData.enemy;
        const enemyId = `enemy_${currentLoc}`;
        
        // Show if room has enemy and (no shared state yet OR shared hp > 0)
        const enemyAllowed = !roomData.nightOnly || getTimeOfDay() === 'night';
        if (enemyType && enemyAllowed && (!enemy || enemy.hp > 0)) {
            activeIds.add(enemyId);
            let eid = this.entityMap.get(enemyId);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(enemyId, eid);
            }
            this.world.setComponent(eid, Component.Sprite, { type: enemyType, palette: 'enemy', seed: this.hash(enemyType) });
            this.world.setComponent(eid, Component.Transform, { 
                mapId: currentLoc, 
                x: roomData.enemyX ?? 5, 
                y: roomData.enemyY ?? 5 
            });
            const { ENEMIES } = require('../content/data.js');
            const enemyDef = ENEMIES[enemyType];
            const scale = 1 + (worldState.threatLevel * 0.1);
            const maxHp = Math.floor((enemyDef?.hp || 10) * scale);
            this.world.setComponent(eid, Component.Health, { 
                current: enemy ? enemy.hp : maxHp, 
                max: maxHp 
            });
            this.world.setComponent(eid, 'Identity', { name: enemyDef?.name || 'Enemy', id: enemyId });
        }

        // 4. Cleanup
        for (const [id, eid] of this.entityMap.entries()) {
            if (!activeIds.has(id)) {
                this.world.deleteEntity(eid);
                this.entityMap.delete(id);
                this.prevPos.delete(id);
            }
        }
    }

    hash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9) >>> 0; }
        return h;
    }
}
