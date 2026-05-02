// Minimal pub/sub, no deps
const listeners = {};
export const bus = {
  on(event, fn) { (listeners[event] ??= []).push(fn); },
  off(event, fn) { listeners[event] = (listeners[event] || []).filter(f => f !== fn); },
  emit(event, data) { (listeners[event] || []).forEach(f => f(data)); },
};
