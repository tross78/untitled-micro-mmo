import { bus } from './eventbus.js';

describe('EventBus', () => {
  test('emits events to multiple subscribers', () => {
    const mockFn1 = jest.fn();
    const mockFn2 = jest.fn();
    
    bus.on('test:event', mockFn1);
    bus.on('test:event', mockFn2);
    
    bus.emit('test:event', { data: 123 });
    
    expect(mockFn1).toHaveBeenCalledWith({ data: 123 });
    expect(mockFn2).toHaveBeenCalledWith({ data: 123 });
  });

  test('removes subscribers correctly', () => {
    const mockFn = jest.fn();
    bus.on('test:remove', mockFn);
    bus.off('test:remove', mockFn);
    
    bus.emit('test:remove', { data: 456 });
    
    expect(mockFn).not.toHaveBeenCalled();
  });

  test('only emits to specific event type', () => {
    const mockFn1 = jest.fn();
    const mockFn2 = jest.fn();
    
    bus.on('event:a', mockFn1);
    bus.on('event:b', mockFn2);
    
    bus.emit('event:a', { type: 'A' });
    
    expect(mockFn1).toHaveBeenCalledWith({ type: 'A' });
    expect(mockFn2).not.toHaveBeenCalled();
  });
});
