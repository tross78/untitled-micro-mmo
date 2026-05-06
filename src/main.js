import { localPlayer } from './state/store.js';
import { flushSync } from './state/persistence.js';
import { start } from './main/bootstrap.js';

// E1: Emergency Flush on tab close or backgrounding
if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushSync(localPlayer);
        } else {
            // Tab became visible. The rAF for triggerVisualRefresh may have been
            // cancelled by the browser while hidden, leaving _vRefreshTimer non-null
            // forever. Import lazily to avoid a circular dependency at startup.
            import('./main/events.js').then(({ triggerLogicalRefresh, resetVisualRefreshTimer }) => {
                resetVisualRefreshTimer();
                triggerLogicalRefresh();
            });
        }
    });
    window.addEventListener('beforeunload', () => {
        flushSync(localPlayer);
    });

    // Start the game engine
    start();
}
