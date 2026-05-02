import { localPlayer } from './state/store.js';
import { flushSync } from './state/persistence.js';
import { start } from './main/bootstrap.js';

// E1: Emergency Flush on tab close or backgrounding
if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSync(localPlayer);
    });
    window.addEventListener('beforeunload', () => {
        flushSync(localPlayer);
    });

    // Start the game engine
    start();
}
