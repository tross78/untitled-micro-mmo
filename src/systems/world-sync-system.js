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
        this.entityMap = new Map(); // peerId/npcId -> entityId
    }

    update() {
        const { players, shardEnemies, NPCS, localPlayer } = this.stores;

        // 1. Sync NPCs (if they are in the current room)
        Object.keys(NPCS).forEach(id => {
            // Simple: if NPC exists, ensure ECS entity exists
            let eid = this.entityMap.get(id);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(id, eid);
                this.world.setComponent(eid, Component.Sprite, { type: 'npc', palette: 'npc', seed: this.hash(id) });
            }
            // Update transform from authored/store data
            const loc = localPlayer.location;
            const roomData = this.worldData[loc];
            const staticEntry = (roomData?.staticEntities || []).find(se => se.id === id);
            
            if (staticEntry) {
                this.world.setComponent(eid, Component.Transform, { mapId: loc, x: staticEntry.x, y: staticEntry.y });
            }
        });

        // 2. Sync Other Players
        players.forEach((p, id) => {
            let eid = this.entityMap.get(id);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(id, eid);
                this.world.setComponent(eid, Component.Sprite, { type: 'peer', palette: 'peer', seed: this.hash(id) });
            }
            this.world.setComponent(eid, Component.Transform, { mapId: p.location, x: p.x || 0, y: p.y || 0 });
            this.world.setComponent(eid, Component.Health, { current: p.hp || 10, max: p.maxHp || 10 });
        });

        // 3. Sync Shared Enemies
        const locId = localPlayer.location;
        const enemy = shardEnemies.get(locId);
        if (enemy && enemy.hp > 0) {
            const id = `enemy_${locId}`;
            let eid = this.entityMap.get(id);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(id, eid);
                this.world.setComponent(eid, Component.Sprite, { type: 'enemy', palette: 'enemy', seed: this.hash(enemy.type) });
            }
            const roomData = this.worldData[locId];
            this.world.setComponent(eid, Component.Transform, { 
                mapId: locId, 
                x: roomData?.enemyX ?? 5, 
                y: roomData?.enemyY ?? 5 
            });
            this.world.setComponent(eid, Component.Health, { current: enemy.hp, max: enemy.maxHp });
        }
    }

    hash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9) >>> 0; }
        return h;
    }
}
