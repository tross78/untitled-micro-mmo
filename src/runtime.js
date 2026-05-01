const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;

const runtimeScope = params?.get('scope') || '';

export const isE2EMode = () => params?.get('e2e') === '1';

export const getRuntimeScope = () => runtimeScope;

export const scopedStorageKey = (base) => runtimeScope ? `${base}_${runtimeScope}` : base;

export const getRuntimeParam = (key) => params?.get(key) || '';
