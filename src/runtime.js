const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;

const runtimeScope = params?.get('scope') || '';
let resolvedArbiterUrl = '';

export const isE2EMode = () => params?.get('e2e') === '1';
export const useFakeTransport = () => isE2EMode() && params?.get('transport') !== 'real';

export const getRuntimeScope = () => runtimeScope;

export const scopedStorageKey = (base) => runtimeScope ? `${base}_${runtimeScope}` : base;

export const getRuntimeParam = (key) => params?.get(key) || '';

export const getArbiterUrl = (fallback = '') => {
    const runtimeUrl = getRuntimeParam('arbiter');
    if (runtimeUrl) {
        return runtimeUrl === 'self' && typeof window !== 'undefined'
            ? window.location.origin
            : runtimeUrl;
    }

    if (typeof window !== 'undefined') {
        const storedUrl = window.localStorage?.getItem('hearthwick_arbiter_url') || '';
        if (storedUrl) return storedUrl;
    }

    if (resolvedArbiterUrl) return resolvedArbiterUrl;

    return fallback;
};

export const setResolvedArbiterUrl = (url) => {
    resolvedArbiterUrl = typeof url === 'string' ? url.trim() : '';
};

export const getBootstrapDomain = () =>
    getRuntimeParam('bootstrap') || (typeof window !== 'undefined'
        ? window.localStorage?.getItem('hearthwick_bootstrap_domain') || ''
        : '');

export const resolveBootstrapArbiterUrl = async (domain = getBootstrapDomain()) => {
    if (!domain || typeof window === 'undefined' || typeof fetch !== 'function') return '';

    const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const bootstrapUrl = `${window.location.protocol === 'http:' ? 'http' : 'https'}://${normalizedDomain}/.well-known/hearthwick-bootstrap.json`;

    try {
        const response = await fetch(bootstrapUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return '';
        const data = await response.json().catch(() => null);
        const arbiterUrl = data?.arbiterUrl || data?.arbiter_url || '';
        if (typeof arbiterUrl !== 'string' || !arbiterUrl.trim()) return '';
        const trimmed = arbiterUrl.trim();
        setResolvedArbiterUrl(trimmed);
        return trimmed;
    } catch {
        return '';
    }
};
