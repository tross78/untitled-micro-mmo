import { inputManager, ACTION } from './input.js';
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
});
