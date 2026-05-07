import { flushSync } from '../state/persistence.js';

export const bindSessionLifecycle = (localPlayer, target = window) => {
    if (!target?.addEventListener || !target?.removeEventListener) return () => {};

    const flush = () => flushSync(localPlayer);

    target.addEventListener('pagehide', flush);
    target.addEventListener('beforeunload', flush);

    return () => {
        target.removeEventListener('pagehide', flush);
        target.removeEventListener('beforeunload', flush);
    };
};
