import { bus } from '../state/eventbus.js';
import { getGameAreaEl } from '../adapters/dom/shell.js';

export const ACTION = {
  MOVE_N: 'move_n', MOVE_S: 'move_s', MOVE_E: 'move_e', MOVE_W: 'move_w',
  INTERACT: 'interact',
  ATTACK: 'attack',
  INVENTORY: 'inventory',
  MENU: 'menu',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  SPRINT: 'sprint',
  PAGE_UP: 'page_up',
  PAGE_DOWN: 'page_down',
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
  'Shift': ACTION.SPRINT,
  'm': ACTION.MENU, 'M': ACTION.MENU,
  'PageUp': ACTION.PAGE_UP, 'PageDown': ACTION.PAGE_DOWN,
};

export class InputManager {
  constructor() {
    this.activeActions = new Set();
    this.prevGamepadButtons = new Set();
    this.gamepadConnected = false;
    this.touchStart = { x: 0, y: 0 };
    this.lastInputMode = 'keyboard'; // 'keyboard', 'gamepad', 'touch'
  }

  init() {
    window.addEventListener('keydown', (e) => {
      this.lastInputMode = 'keyboard';
      this.handleKeyDown(e);
    });
    window.addEventListener('keyup', (e) => this.handleKeyUp(e));
    
    // D1: Gamepad connection tracking
    window.addEventListener('gamepadconnected', () => { this.gamepadConnected = true; });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).some(g => g);
    });

    // D2: Touch swipe gestures
    const canvas = getGameAreaEl();
    if (canvas) {
      canvas.addEventListener('touchstart', (e) => {
        this.lastInputMode = 'touch';
        this.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });

      canvas.addEventListener('touchend', (e) => {
        this.lastInputMode = 'touch';
        const touchEnd = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        const dx = touchEnd.x - this.touchStart.x;
        const dy = touchEnd.y - this.touchStart.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (Math.max(absX, absY) > 20) {
          // Swipe detected
          e.preventDefault(); // Prevent synthetic click
          let action = null;
          if (absX > absY) {
            action = dx > 0 ? ACTION.MOVE_E : ACTION.MOVE_W;
          } else {
            action = dy > 0 ? ACTION.MOVE_S : ACTION.MOVE_N;
          }
          if (action) {
            bus.emit('input:action', { action, type: 'down' });
            // Emit UP immediately since swipe is a discrete step
            setTimeout(() => bus.emit('input:action', { action, type: 'up' }), 50);
          }
        }
      }, { passive: false });
    }

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
      if (!this.gamepadConnected) {
        requestAnimationFrame(poll);
        return;
      }
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp) continue;

        // Button mapping (standard layout)
        const buttons = [
          { idx: 0, action: ACTION.INTERACT },
          { idx: 1, action: ACTION.CANCEL },
          { idx: 2, action: ACTION.ATTACK },
          { idx: 3, action: ACTION.INVENTORY },
          { idx: 4, action: ACTION.PAGE_UP },   // LB / L1
          { idx: 5, action: ACTION.PAGE_DOWN }, // RB / R1
          { idx: 9, action: ACTION.MENU },      // Start
          { idx: 12, action: ACTION.MOVE_N },
          { idx: 13, action: ACTION.MOVE_S },
          { idx: 14, action: ACTION.MOVE_W },
          { idx: 15, action: ACTION.MOVE_E },
        ];

        buttons.forEach(b => {
          const pressed = gp.buttons[b.idx].pressed;
          const key = `${gp.index}-${b.idx}`;
          if (pressed && !this.prevGamepadButtons.has(key)) {
            this.lastInputMode = 'gamepad';
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
          if (val > stickThreshold) {
            this.lastInputMode = 'gamepad';
            this.emitContinuous(posAction);
          } else if (val < -stickThreshold) {
            this.lastInputMode = 'gamepad';
            this.emitContinuous(negAction);
          } else {
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
