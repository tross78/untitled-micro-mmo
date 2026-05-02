import { bus } from '../state/eventbus.js';
import { initLogHandlers, injectLog } from './log.js';

export * from './helpers.js';
export * from './status.js';
export * from './radar.js';
export * from './ticker.js';
export * from './actions.js';

import { initUIActions } from './actions.js';

// Initialize core UI handlers
initLogHandlers();
initUIActions(bus);

export const log = (msg, color = '#0f0') => {
    bus.emit('log', { msg, color });
};

// Re-expose legacy internal state hooks for tests if needed
export { _getUiState, _resetUiState } from './actions.js';
