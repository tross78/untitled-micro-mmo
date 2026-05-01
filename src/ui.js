import { bus } from './eventbus.js';
import { initLogHandlers, injectLog } from './ui/log.js';

export * from './ui/helpers.js';
export * from './ui/status.js';
export * from './ui/radar.js';
export * from './ui/ticker.js';
export * from './ui/actions.js';

import { initUIActions } from './ui/actions.js';

// Initialize core UI handlers
initLogHandlers();
initUIActions(bus);

export const log = (msg, color = '#0f0') => {
    bus.emit('log', { msg, color });
};

// Re-expose legacy internal state hooks for tests if needed
export { _getUiState, _resetUiState } from './ui/actions.js';
