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
  Sprite: 'Sprite', // { type: 'player'|'enemy'|'npc', palette: 'hero'|'peer'|'npc'|'enemy', seed: number }
  
  /** UI Overlays */
  UIOverlay: 'UIOverlay', // { type: 'toast'|'fanfare'|'banner', text: string, expires: number }

  /** Full-screen Menu state */
  Menu: 'Menu', // { type: 'inventory'|'quests'|'crafting', data: any }

  /** Camera State */
  Camera: 'Camera', // { x: number, y: number, zoom: number }

  /** Local identity marker */
  PlayerControlled: 'PlayerControlled', // {}

  /** Dialogue state */
  Dialogue: 'Dialogue', // { text: string, speakerId: string, progress: number, page: number, onComplete?: string }
};
