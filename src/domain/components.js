// @ts-check

/**
 * Standard ECS component definitions.
 */

export const Component = {
  /** Logical grid coordinates and current map */
  Transform: 'Transform', // { x: number, y: number, mapId: string, facing: 'n'|'s'|'e'|'w' }
  
  /** Visual interpolation state */
  Tweenable: 'Tweenable', // { startX: number, startY: number, targetX: number, targetY: number, progress: number }
  
  /** Temporary visual effects */
  VisualEffect: 'VisualEffect', // { type: 'hit_flash'|'shake', expires: number }

  /** Attack Animation state */
  AttackAnimation: 'AttackAnimation', // { dir: 'n'|'s'|'e'|'w', progress: number }
  
  /** Movement intent */
  Intent: 'Intent', // { action: 'move' | 'attack' | 'interact', dir?: string, targetId?: string }

  /** Movement target for multi-tile navigation */
  MovementTarget: 'MovementTarget', // { x: number, y: number }

  /** Visual shudder/bounce on collision */
  CollisionBump: 'CollisionBump', // { dir: 'n'|'s'|'e'|'w', progress: number }
  
  /** Health status */
  Health: 'Health', // { current: number, max: number }
  
  /** Display metadata */
  Sprite: 'Sprite', // { type: 'player'|'enemy'|'npc', palette: 'hero'|'peer'|'npc'|'enemy', seed: number }
  
  /** UI Overlays */
  UIOverlay: 'UIOverlay', // { type: 'toast'|'fanfare'|'banner', text: string, expires: number }

  /** Full-screen interactive menu state */
  Menu: 'Menu', // { type: string, title: string, message?: string, entries: Array<{label,detail?,disabled?,action?}>, selectedIndex: number, context?: any, parent?: any }

  /** Camera State */
  Camera: 'Camera', // { x: number, y: number, zoom: number }

  /** Local identity marker */
  PlayerControlled: 'PlayerControlled', // {}

  /** Entity identity (name, peer hash) */
  Identity: 'Identity', // { name: string, ph?: string, id?: string }

  /** Dialogue state */
  Dialogue: 'Dialogue', // { text: string, speakerId: string, progress: number, page: number, onComplete?: string }
};
