// @ts-check

/**
 * ECS component definitions.
 *
 * Each component is a string key used to look up component data on an entity via World.
 * Annotations show: data shape, and which system(s) own/mutate it.
 * Adding a new component: add the key here, then add a system that reads/writes it.
 */

export const Component = {
  /** Logical grid coordinates and current map.
   *  Shape: { x, y, mapId, facing: 'n'|'s'|'e'|'w' }
   *  Owner: movement-system.js (writes), map-render-system.js (reads) */
  Transform: 'Transform',

  /** Visual interpolation state for smooth tile-to-tile movement.
   *  Shape: { startX, startY, targetX, targetY, progress, speed? }
   *  Owner: tween-system.js (advances progress), movement-system.js (sets on move) */
  Tweenable: 'Tweenable',

  /** Temporary visual effects (hit flash, screen shake).
   *  Shape: { type: 'hit_flash'|'shake', expires: number (ms timestamp) }
   *  Owner: combat-system.js (writes), entity-render-system.js (reads, removes expired) */
  VisualEffect: 'VisualEffect',

  /** Attack animation direction and progress.
   *  Shape: { dir: 'n'|'s'|'e'|'w', progress: number }
   *  Owner: combat-system.js (writes), entity-render-system.js (reads) */
  AttackAnimation: 'AttackAnimation',

  /** Movement or interaction intent queued this frame.
   *  Shape: { action: 'move'|'attack'|'interact', dir?: string, targetId?: string }
   *  Owner: input-system.js / command handlers (writes), movement-system.js (consumes and removes) */
  Intent: 'Intent',

  /** Multi-tile navigation destination (pathfinding target).
   *  Shape: { x, y }
   *  Owner: canvas click handler (writes), movement-system.js (consumes) */
  MovementTarget: 'MovementTarget',

  /** Visual shudder/bounce on blocked move attempt.
   *  Shape: { dir: 'n'|'s'|'e'|'w', progress: number }
   *  Owner: movement-system.js (writes on collision), entity-render-system.js (reads, animates) */
  CollisionBump: 'CollisionBump',

  /** Current and max HP. Used for combat resolution and HUD rendering.
   *  Shape: { current, max }
   *  Owner: combat-system.js (mutates current), entity-render-system.js (reads for health bar) */
  Health: 'Health',

  /** Sprite identity — which compiled asset to render and with which palette.
   *  Shape: { type: string, palette: string, seed: number }
   *  Owner: entity-render-system.js (reads), room-load path (writes on entity spawn) */
  Sprite: 'Sprite',

  /** Full-screen overlay: toasts, fanfares, banners.
   *  Shape: { type: 'toast'|'fanfare'|'banner', text, expires: number (ms timestamp) }
   *  Owner: ui-render-system.js (reads), various event handlers (writes) */
  UIOverlay: 'UIOverlay',

  /** Full-screen interactive menu (inventory, shop, stats, quests, etc.).
   *  Shape: { type, title, message?, entries: [{label,detail?,disabled?,action?}], selectedIndex, context?, parent? }
   *  Owner: canvas-menu.js (writes), ui-render-system.js (reads and renders) */
  Menu: 'Menu',

  /** Marks the entity as the locally-controlled player. Used to scope system queries.
   *  Shape: {}
   *  Owner: store.js / spawn path (writes once at init) */
  PlayerControlled: 'PlayerControlled',

  /** Human-readable name and peer identity hash.
   *  Shape: { name, ph?: string, id?: string }
   *  Owner: presence path (writes on peer join), entity-render-system.js (reads for name tag) */
  Identity: 'Identity',

  /** NPC dialogue in progress.
   *  Shape: { text, speakerId, progress, page, onComplete?: string }
   *  Owner: talk command (writes), ui-render-system.js (reads), dialogue-close handler (removes) */
  Dialogue: 'Dialogue',

  /** NPC & Enemy patrol state.
   *  Shape: { path: [{x,y},...], index: number, dir: 1|-1, waitTicks: number, mode?: 'pingpong'|'loop', pauseTicks?: number, stepPauseTicks?: number }
   *  Owner: patrol-system.js (writes) */
  Patrol: 'Patrol',

  /** Short-lived tap/click feedback pulse on a tile.
   *  Shape: { x, y, expiresAt: number (ms timestamp) }
   *  Owner: renderer.js (writes on pointer tap), map-render-system.js (reads, draws, removes expired) */
  TapPulse: 'TapPulse',
};
