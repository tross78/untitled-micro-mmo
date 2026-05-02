// @ts-check

/**
 * Standard ECS component definitions.
 */

export const Component = {
  /** Logical grid coordinates and current map */
  Transform: 'Transform', // { x: number, y: number, mapId: string }
  
  /** Visual interpolation state */
  Tweenable: 'Tweenable', // { startX: number, startY: number, targetX: number, targetY: number, progress: number }
  
  /** Movement intent */
  Intent: 'Intent', // { action: 'move' | 'attack' | 'interact', dir?: string, targetId?: string }
  
  /** Health status */
  Health: 'Health', // { current: number, max: number }
  
  /** Display metadata */
  Sprite: 'Sprite', // { type: string, seed: number }
  
  /** Local identity marker */
  PlayerControlled: 'PlayerControlled', // {}
};
