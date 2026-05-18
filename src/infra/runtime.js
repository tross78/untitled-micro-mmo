const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;

const runtimeScope = params?.get('scope') || '';
let resolvedArbiterUrl = '';

export const normalizeArbiterUrl = (value) => {
    if (typeof value !== 'string') return '';
    let trimmed = value.trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
        const looksLikeHost = trimmed.includes('.')
            || /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[^\]]+\])(?::|\/|$)/i.test(trimmed);
        if (!looksLikeHost) return '';
        const localHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[^\]]+\])(?::|\/|$)/i.test(trimmed);
        trimmed = `${localHost ? 'http' : 'https'}://${trimmed}`;
    }

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        const path = url.pathname.replace(/\/+$/, '');
        return `${url.origin}${path === '/' ? '' : path}`;
    } catch {
        return '';
    }
};

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
            : normalizeArbiterUrl(runtimeUrl);
    }

    if (typeof window !== 'undefined') {
        const storedUrl = window.localStorage?.getItem('fenhollow_arbiter_url') || '';
        const normalizedStoredUrl = normalizeArbiterUrl(storedUrl);
        if (normalizedStoredUrl) return normalizedStoredUrl;
    }

    if (resolvedArbiterUrl) return resolvedArbiterUrl;

    return normalizeArbiterUrl(fallback);
};

export const setResolvedArbiterUrl = (url, options = {}) => {
    resolvedArbiterUrl = normalizeArbiterUrl(url);
    if (options.persist && typeof window !== 'undefined' && window.localStorage && resolvedArbiterUrl) {
        window.localStorage.setItem('fenhollow_arbiter_url', resolvedArbiterUrl);
    }
};
