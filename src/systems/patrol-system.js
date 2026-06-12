// @ts-check

import { Component } from '../domain/components.js';

/**
 * PatrolSystem manages NPC and enemy movement along authored or generated paths.
 */
export class PatrolSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     */
    constructor(world) {
        this.world = world;
    }

    update() {
        const entities = this.world.query([Component.Patrol, Component.Transform]);
        
        for (const id of entities) {
            // Players don't patrol
            if (this.world.getComponent(id, Component.PlayerControlled)) continue;

            const patrol = this.world.getComponent(id, Component.Patrol);
            const transform = this.world.getComponent(id, Component.Transform);
            if (!patrol || !transform) continue;

            // Wait if needed
            if (patrol.waitTicks > 0) {
                patrol.waitTicks--;
                continue;
            }

            // Already moving (tweening)?
            if (this.world.getComponent(id, Component.Tweenable)) continue;

            const target = patrol.path[patrol.index];
            if (transform.x === target.x && transform.y === target.y) {
                // Reached point
                patrol.stuck = 0;
                this.advanceWaypoint(patrol);
                continue;
            }

            // Stuck detection: we only get here with no active tween, so if the
            // entity is still where it was when we last issued a step, that move
            // was rejected (player standing in the way, blocked corner, …).
            // After a few failed attempts, skip to the next waypoint instead of
            // shoving against the obstacle forever.
            if (patrol.lastX === transform.x && patrol.lastY === transform.y) {
                patrol.stuck = (patrol.stuck ?? 0) + 1;
            } else {
                patrol.stuck = 0;
            }
            patrol.lastX = transform.x;
            patrol.lastY = transform.y;
            if (patrol.stuck >= (patrol.maxStuckAttempts ?? 3)) {
                patrol.stuck = 0;
                this.advanceWaypoint(patrol);
                continue;
            }

            // Move one step toward target
            const dx = target.x - transform.x;
            const dy = target.y - transform.y;
            let dir = null;
            if (dx !== 0) dir = dx > 0 ? 'e' : 'w';
            else if (dy !== 0) dir = dy > 0 ? 's' : 'n';

            if (dir) {
                this.world.setComponent(id, Component.Intent, { action: 'move', dir });
                patrol.waitTicks = patrol.stepPauseTicks ?? 0;
            }
        }
    }

    /** Advance to the next waypoint (loop or ping-pong) and apply the waypoint pause. */
    advanceWaypoint(patrol) {
        const pauseTicks = patrol.pauseTicks ?? 60;
        if (patrol.mode === 'loop') {
            patrol.index = (patrol.index + 1) % patrol.path.length;
            patrol.waitTicks = pauseTicks;
        } else {
            const nextIdx = patrol.index + patrol.dir;
            if (nextIdx < 0 || nextIdx >= patrol.path.length) {
                patrol.dir *= -1;
                patrol.waitTicks = pauseTicks; // Pause at endpoints (Phase 8.76 P4)
            } else {
                patrol.index = nextIdx;
            }
        }
    }
}
