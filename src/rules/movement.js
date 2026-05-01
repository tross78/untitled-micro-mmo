import { GAME_NAME, world } from '../data.js';

export const getShardName = (loc, inst) => `${GAME_NAME}-${loc}-v1-${inst}`;

export function validateMove(currentLocation, direction) {
    return world[currentLocation]?.exits[direction] || null;
}
