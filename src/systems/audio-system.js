// @ts-check

import { Component } from '../domain/components.js';
import { bus } from '../state/eventbus.js';
import { playBGM, playHit, playCrit, playDeath, playPickup, playLevelUp, playPortal, playStep } from '../engine/audio.js';

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

        // SFX Listeners
        bus.on('combat:hit', ({ crit }) => { if (crit) playCrit(); else playHit(); });
        bus.on('combat:death', ({ entity }) => { if (entity === 'You') playDeath(); });
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
        if (tween && tween.progress > 0.1 && tween.progress < 0.15) {
            playStep();
        }
    }

    handleBgmTransition(locId) {
        const dungeonRooms = new Set(['catacombs', 'dungeon_cell', 'throne_room', 'cave', 'ruins_descent', 'sea_cave', 'smuggler_den']);
        const townRooms = new Set(['tavern', 'market', 'mill', 'herbalist_hut', 'library', 'hallway', 'cellar']);
        
        if (dungeonRooms.has(locId)) {
            playBGM('dungeon');
        } else if (townRooms.has(locId)) {
            playBGM('town');
        } else {
            playBGM('grass');
        }
    }
}
