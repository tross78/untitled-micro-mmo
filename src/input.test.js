import { InputManager, inputManager, ACTION } from './input.js';
import { bus } from './eventbus.js';

describe('InputManager', () => {
  let emitSpy;

  beforeEach(() => {
    emitSpy = jest.spyOn(bus, 'emit');
    inputManager.activeActions.clear();
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  test('emits action on keydown', () => {
    const event = new KeyboardEvent('keydown', { key: 'w' });
    Object.defineProperty(event, 'target', { value: document.body });
    inputManager.handleKeyDown(event);
    
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_N, type: 'down' });
    expect(inputManager.activeActions.has(ACTION.MOVE_N)).toBe(true);
  });

  test('does not emit duplicate down events for held keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'w' });
    Object.defineProperty(event, 'target', { value: document.body });
    inputManager.handleKeyDown(event);
    inputManager.handleKeyDown(event); // Second call
    
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  test('emits action on keyup', () => {
    // Prime it with a down event
    const downEvent = new KeyboardEvent('keydown', { key: 'w' });
    Object.defineProperty(downEvent, 'target', { value: document.body });
    inputManager.handleKeyDown(downEvent);
    emitSpy.mockClear();

    inputManager.handleKeyUp(new KeyboardEvent('keyup', { key: 'w' }));
    
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_N, type: 'up' });
    expect(inputManager.activeActions.has(ACTION.MOVE_N)).toBe(false);
  });

  test('suppresses input when focused on a text field', () => {
    const input = document.createElement('input');
    const event = { key: 'w', target: input, preventDefault: jest.fn() };
    
    inputManager.handleKeyDown(event);
    
    expect(emitSpy).not.toHaveBeenCalled();
  });

  test('prevents default behavior for navigation keys', () => {
    const event = { key: 'ArrowUp', target: document.body, preventDefault: jest.fn() };
    inputManager.handleKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  test('keyup for inactive action does not emit', () => {
    inputManager.handleKeyUp(new KeyboardEvent('keyup', { key: 'w' }));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  test('continuous actions emit down once and up when stopped', () => {
    inputManager.emitContinuous(ACTION.MOVE_E);
    inputManager.emitContinuous(ACTION.MOVE_E);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_E, type: 'down' });

    inputManager.stopContinuous(ACTION.MOVE_E);
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_E, type: 'up' });
  });

  test('gamepad button polling emits down and up transitions', () => {
    const manager = new InputManager();
    manager.gamepadConnected = true;
    const frames = [];
    global.requestAnimationFrame = jest.fn(cb => {
      frames.push(cb);
      return frames.length;
    });
    const button = { pressed: true };
    Object.defineProperty(navigator, 'getGamepads', {
      value: jest.fn(() => [{
        index: 0,
        buttons: Array.from({ length: 16 }, (_, i) => i === 0 ? button : { pressed: false }),
        axes: [0, 0],
      }]),
      configurable: true,
    });

    manager.startGamepadPolling();
    frames.shift()();
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.INTERACT, type: 'down' });

    emitSpy.mockClear();
    button.pressed = false;
    frames.shift()();
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.INTERACT, type: 'up' });
  });

  test('swipe gesture emits discrete movement down and delayed up', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<canvas id="game-area"></canvas>';
    global.requestAnimationFrame = jest.fn();
    const manager = new InputManager();
    manager.init();
    const canvas = document.getElementById('game-area');

    canvas.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 10 }],
    }));
    canvas.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 60, clientY: 12 }],
    }));

    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_E, type: 'down' });
    jest.advanceTimersByTime(50);
    expect(emitSpy).toHaveBeenCalledWith('input:action', { action: ACTION.MOVE_E, type: 'up' });
    jest.useRealTimers();
  });
});
