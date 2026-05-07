// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { playBGM, playHit, playCrit, playDeath, playPickup, playLevelUp, playPortal, playStep } from '../engine/audio.js';
import { world } from '../content/data.js';

/**
 * AudioSystem manages BGM transitions and sound effect triggers.
 */
export class AudioSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     */
    constructor(world) {
        this.world = world;
        this.lastLocation = null;
        this.lastStepBucket = -1;

        // SFX Listeners
        bus.on('combat:hit', ({ crit }) => { if (crit) playCrit(); else playHit(); });
        bus.on('combat:death', ({ entity }) => { if (entity === 'You') playDeath(); else playPickup(); });
        bus.on('item:pickup', () => playPickup());
        bus.on('player:levelup', () => playLevelUp());
        bus.on('player:move', ({ from, to }) => { if (from !== to) playPortal(); });
    }

    /**
     * @param {number} _dt
     */
    update(_dt) {
        const players = this.world.query([Component.PlayerControlled, Component.Transform]);
        if (players.length === 0) return;

        const transform = this.world.getComponent(players[0], Component.Transform);
        const locId = transform.mapId;

        // 1. Manage BGM transitions
        if (locId !== this.lastLocation) {
            this.handleBgmTransition(locId);
            this.lastLocation = locId;
        }

        // 2. Footstep SFX
        const tween = this.world.getComponent(players[0], Component.Tweenable);
        if (tween) {
            const bucket = Math.floor(tween.progress * 5);
            if (bucket === 0 && this.lastStepBucket !== 0) {
                playStep();
            }
            this.lastStepBucket = bucket;
        } else {
            this.lastStepBucket = -1;
        }
    }

    handleBgmTransition(locId) {
        const zone = world[locId]?.zone ?? 'wilderness';
        if (zone === 'dungeon') playBGM('dungeon');
        else if (zone === 'town') playBGM('town');
        else playBGM('grass');
    }
}
