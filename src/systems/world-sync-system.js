// @ts-check

import { Component } from '../domain/components.js';
import { findSafeArrival } from '../rules/index.js';
import { sceneryBlocksCell } from '../infra/graphics-constants.js';

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

    isWalkable(roomData) {
        const blocked = new Set();
        for (const tile of roomData.tileOverrides || []) {
            if (tile.type === 'wall') blocked.add(`${tile.x},${tile.y}`);
        }
        const scenery = roomData.scenery || [];
        return (x, y) => {
            if (x < 0 || y < 0 || x >= roomData.width || y >= roomData.height) return false;
            if (blocked.has(`${x},${y}`)) return false;
            return !scenery.some((s) => sceneryBlocksCell(s, x, y));
        };
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
                    // Only set spawn position on first creation — patrolling NPCs own their Transform after that
                    if (!this.world.getComponent(eid, Component.Transform)) {
                        this.world.setComponent(eid, Component.Transform, { mapId: currentLoc, x: staticEntry.x, y: staticEntry.y });
                    }
                    if (staticEntry.patrol && npcDef?.role !== 'static') {
                        if (!this.world.getComponent(eid, Component.Patrol)) {
                            this.world.setComponent(eid, Component.Patrol, { path: staticEntry.patrol, index: 0, dir: 1, waitTicks: 0, stepPauseTicks: staticEntry.patrolPause ?? 18 });
                        }
                    }
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
            if (p.location !== currentLoc) return;
            activeIds.add(id);

            const px = p.x ?? 0;
            const py = p.y ?? 0;
            let eid = this.entityMap.get(id);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(id, eid);
            }
            // Re-write the sprite each frame so the stale flag flips on/off as
            // presence drops or recovers; refreshing the seed-based sprite is cheap.
            this.world.setComponent(eid, Component.Sprite, {
                type: 'peer',
                palette: 'peer',
                seed: this.hash(id),
                stale: !!p.stale || !!p.ghost,
                ghost: !!p.ghost,
            });
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
            const existingTransform = this.world.getComponent(eid, Component.Transform);
            if (!existingTransform || existingTransform.mapId !== currentLoc) {
                const startX = roomData.enemyX ?? Math.floor(roomData.width / 2);
                const startY = roomData.enemyY ?? Math.floor(roomData.height / 2);
                const safe = findSafeArrival(
                    startX,
                    startY,
                    roomData.width,
                    roomData.height,
                    this.isWalkable(roomData)
                ) || { x: startX, y: startY };
                this.world.setComponent(eid, Component.Transform, {
                    mapId: currentLoc,
                    x: safe.x,
                    y: safe.y
                });
            }
            const { ENEMIES } = require('../content/data.js');
            const enemyDef = ENEMIES[enemyType];
            const scale = 1 + (worldState.threatLevel * 0.1);
            const maxHp = Math.floor((enemyDef?.hp || 10) * scale);
            this.world.setComponent(eid, Component.Health, { 
                current: enemy ? enemy.hp : maxHp, 
                max: maxHp 
            });
            this.world.setComponent(eid, 'Identity', { name: enemyDef?.name || 'Enemy', id: enemyId });

            // 8.76 P4: Auto-patrol for enemies
            if (!this.world.getComponent(eid, Component.Patrol)) {
                const transform = this.world.getComponent(eid, Component.Transform);
                if (transform) {
                    const h = this.hash(enemyId);
                    const path = this.generatePatrol(transform.x, transform.y, h, roomData);
                    this.world.setComponent(eid, Component.Patrol, { path, index: 0, dir: 1, waitTicks: 0, mode: 'loop', pauseTicks: 36, stepPauseTicks: 10 });
                }
            }
        }

        // 4. Sync Scattered Resources (Phase 8.7x)
        const { getScatteredContent } = require('../rules/index.js');
        const scatterNodes = getScatteredContent(currentLoc, worldState.day, roomData);
        const gatheredNodes = localPlayer.gatheredNodes;
        const gatheredSameDay = gatheredNodes?.day === worldState.day;

        scatterNodes.forEach(sc => {
            const nodeKey = `${currentLoc}:${sc.x},${sc.y}`;
            if (gatheredSameDay && gatheredNodes?.nodes?.has(nodeKey)) return;

            const resId = `resource:${nodeKey}`;
            activeIds.add(resId);

            let eid = this.entityMap.get(resId);
            if (!eid) {
                eid = this.world.createEntity();
                this.entityMap.set(resId, eid);
            }

            this.world.setComponent(eid, Component.Transform, { mapId: currentLoc, x: sc.x, y: sc.y });
            this.world.setComponent(eid, Component.Sprite, {
                type: sc.label,
                palette: `resource:${sc.label}`,
                seed: this.hash(nodeKey),
            });
            this.world.setComponent(eid, Component.Gatherable, { kind: sc.type, label: sc.label, locId: currentLoc });
            this.world.setComponent(eid, Component.RoomScoped, { locId: currentLoc });
            this.world.setComponent(eid, 'Identity', { name: sc.label, id: resId });
        });

        // 5. Cleanup
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

    generatePatrol(sx, sy, seed, room) {
        const isWalkable = (x, y) => {
            if (x < 0 || x >= room.width || y < 0 || y >= room.height) return false;
            const isWall = (room.tileOverrides || []).some(t => t.x === x && t.y === y && t.type === 'wall');
            const isScenery = (room.scenery || []).some(s => sceneryBlocksCell(s, x, y));
            return !isWall && !isScenery;
        };

        const radiusX = 1 + (seed % 2);
        const radiusY = 1 + ((seed >> 1) % 2);
        const loopCandidates = [
            { x: sx, y: sy - radiusY },
            { x: sx + radiusX, y: sy - Math.max(1, radiusY - 1) },
            { x: sx + radiusX, y: sy + radiusY },
            { x: sx, y: sy + radiusY },
            { x: sx - radiusX, y: sy + Math.max(1, radiusY - 1) },
            { x: sx - radiusX, y: sy - radiusY },
        ];

        const path = [{ x: sx, y: sy }];
        for (const point of loopCandidates) {
            if (!isWalkable(point.x, point.y)) continue;
            const prev = path[path.length - 1];
            if (prev.x === point.x && prev.y === point.y) continue;
            path.push(point);
        }

        if (path.length >= 4) return path;

        const fallback = [{ x: sx, y: sy }];
        const dirs = [
            [0, -1], [1, 0], [0, 1], [-1, 0],
            [1, -1], [1, 1], [-1, 1], [-1, -1]
        ];
        for (const [dx, dy] of dirs) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (isWalkable(nx, ny)) fallback.push({ x: nx, y: ny });
            if (fallback.length >= 4) break;
        }
        return fallback;
    }
}
