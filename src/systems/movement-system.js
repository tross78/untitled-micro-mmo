// @ts-check

import { Component } from '../domain/components.js';

/**
 * MovementSystem handles spatial logic, collision detection, and room transitions.
 */
export class MovementSystem {
  /**
   * @param {import('../domain/ecs.js').WorldStore} world
   * @param {Record<string, any>} worldData - Authored world data (rooms, exits)
   */
  constructor(world, worldData) {
    this.world = world;
    this.worldData = worldData;
  }

  update() {
    const entities = this.world.query([Component.Transform, Component.Intent]);

    for (const entityId of entities) {
      const intent = this.world.getComponent(entityId, Component.Intent);
      const transform = this.world.getComponent(entityId, Component.Transform);

      if (intent.action === 'move') {
        this.handleMove(entityId, transform, intent.dir);
      }

      // Clear intent after processing
      this.world.components.get(Component.Intent).delete(entityId);
    }
  }

  /**
   * @param {number} entityId
   * @param {any} transform
   * @param {string} dir
   */
  handleMove(entityId, transform, dir) {
    const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
    const dy = dir === 's' ? 1 : dir === 'n' ? -1 : 0;

    const loc = this.worldData[transform.mapId];
    if (!loc) return;

    const nx = transform.x + dx;
    const ny = transform.y + dy;

    // 1. Check Bounds
    if (nx < 0 || nx >= loc.width || ny < 0 || ny >= loc.height) {
      this.handleTransition(entityId, transform, dir);
      return;
    }

    // 2. Check Static Collisions (Walls, Scenery)
    const isWall = (loc.tileOverrides || []).some(t => t.x === nx && t.y === ny && t.type === 'wall');
    const isScenery = (loc.scenery || []).some(s => s.x === nx && s.y === ny);
    
    if (isWall || isScenery) return;

    // 3. Update Transform
    transform.x = nx;
    transform.y = ny;

    // 4. Add Tweenable for Phase 8 visual interpolation
    this.world.setComponent(entityId, Component.Tweenable, {
      startX: transform.x - dx,
      startY: transform.y - dy,
      targetX: nx,
      targetY: ny,
      progress: 0
    });
  }

  /**
   * @param {number} entityId
   * @param {any} transform
   * @param {string} dir
   */
  handleTransition(entityId, transform, dir) {
    const loc = this.worldData[transform.mapId];
    const destId = loc.exits?.[this.dirToKey(dir)];
    
    if (destId) {
      const destRoom = this.worldData[destId];
      const exitTile = (loc.exitTiles || []).find(t => t.dest === destId);
      
      transform.mapId = destId;
      if (exitTile) {
        transform.x = exitTile.destX;
        transform.y = exitTile.destY;
      } else {
        // Fallback: spawn on opposite edge
        if (dir === 'n') transform.y = destRoom.height - 1;
        if (dir === 's') transform.y = 0;
        if (dir === 'e') transform.x = 0;
        if (dir === 'w') transform.x = destRoom.width - 1;
      }
    }
  }

  dirToKey(dir) {
    return { 'n': 'north', 's': 'south', 'e': 'east', 'w': 'west' }[dir] || dir;
  }
}
