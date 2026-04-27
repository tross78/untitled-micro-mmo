import { bus } from './eventbus.js';

export const ACTION = {
  MOVE_N: 'move_n', MOVE_S: 'move_s', MOVE_E: 'move_e', MOVE_W: 'move_w',
  INTERACT: 'interact',   // talk to NPC / pick up item / use portal
  ATTACK: 'attack',       // engage nearest enemy
  INVENTORY: 'inventory', // open inventory panel
  MENU: 'menu',           // open action menu / pause
  CONFIRM: 'confirm',     // select highlighted option
  CANCEL: 'cancel',       // back / close panel
  SPRINT: 'sprint',       // hold to move faster (Phase 8: smooth scroll)
};

const KEY_MAP = {
  'ArrowUp': ACTION.MOVE_N, 'w': ACTION.MOVE_N, 'W': ACTION.MOVE_N,
  'ArrowDown': ACTION.MOVE_S, 's': ACTION.MOVE_S, 'S': ACTION.MOVE_S,
  'ArrowLeft': ACTION.MOVE_W, 'a': ACTION.MOVE_W, 'A': ACTION.MOVE_W,
  'ArrowRight': ACTION.MOVE_E, 'd': ACTION.MOVE_E, 'D': ACTION.MOVE_E,
  ' ': ACTION.INTERACT, 'e': ACTION.INTERACT, 'E': ACTION.INTERACT,
  'f': ACTION.ATTACK, 'F': ACTION.ATTACK, 'z': ACTION.ATTACK, 'Z': ACTION.ATTACK,
  'i': ACTION.INVENTORY, 'I': ACTION.INVENTORY, 'Tab': ACTION.INVENTORY,
  'Escape': ACTION.CANCEL,
  'Enter': ACTION.CONFIRM,
  'Shift': ACTION.SPRINT
};

export class InputManager {
  constructor() {
    this.activeActions = new Set();
    this.prevGamepadButtons = new Set();
  }

  init() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => this.handleKeyUp(e));
    this.startGamepadPolling();
  }

  handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const action = KEY_MAP[e.key];
    if (action) {
      if (!this.activeActions.has(action)) {
        this.activeActions.add(action);
        bus.emit('input:action', { action, type: 'down' });
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    }
  }

  handleKeyUp(e) {
    const action = KEY_MAP[e.key];
    if (action && this.activeActions.has(action)) {
      this.activeActions.delete(action);
      bus.emit('input:action', { action, type: 'up' });
    }
  }

  startGamepadPolling() {
    const poll = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp) continue;

        // Button mapping (standard layout)
        const buttons = [
          { idx: 0, action: ACTION.INTERACT },  // A / Cross — interact first; falls back to confirm in handler
          { idx: 1, action: ACTION.CANCEL },    // B / Circle
          { idx: 2, action: ACTION.ATTACK },    // X / Square
          { idx: 3, action: ACTION.INVENTORY }, // Y / Triangle
          { idx: 9, action: ACTION.MENU },      // Start
          { idx: 12, action: ACTION.MOVE_N },   // D-pad Up
          { idx: 13, action: ACTION.MOVE_S },   // D-pad Down
          { idx: 14, action: ACTION.MOVE_W },   // D-pad Left
          { idx: 15, action: ACTION.MOVE_E },   // D-pad Right
        ];

        buttons.forEach(b => {
          const pressed = gp.buttons[b.idx].pressed;
          const key = `${gp.index}-${b.idx}`;
          if (pressed && !this.prevGamepadButtons.has(key)) {
            bus.emit('input:action', { action: b.action, type: 'down' });
            this.prevGamepadButtons.add(key);
          } else if (!pressed && this.prevGamepadButtons.has(key)) {
            bus.emit('input:action', { action: b.action, type: 'up' });
            this.prevGamepadButtons.delete(key);
          }
        });

        // Stick mapping (simple threshold)
        const stickThreshold = 0.5;
        const checkStick = (val, posAction, negAction) => {
          if (val > stickThreshold) this.emitContinuous(posAction);
          else if (val < -stickThreshold) this.emitContinuous(negAction);
          else {
            this.stopContinuous(posAction);
            this.stopContinuous(negAction);
          }
        };

        checkStick(gp.axes[1], ACTION.MOVE_S, ACTION.MOVE_N);
        checkStick(gp.axes[0], ACTION.MOVE_E, ACTION.MOVE_W);
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  emitContinuous(action) {
    if (!this.activeActions.has(action)) {
      this.activeActions.add(action);
      bus.emit('input:action', { action, type: 'down' });
    }
  }

  stopContinuous(action) {
    if (this.activeActions.has(action)) {
      this.activeActions.delete(action);
      bus.emit('input:action', { action, type: 'up' });
    }
  }
}

export const inputManager = new InputManager();
