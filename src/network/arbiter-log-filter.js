export const NONFATAL_NETWORK_PATTERNS = [
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT',
    'WebSocket', 'socket hang up', 'Unexpected server response',
    'SSL', 'certificate', 'handshake',
];

const stringifyError = (err, seen) => {
    if (seen.has(err)) return '[Circular Error]';
    seen.add(err);
    return [
        err.name,
        err.message,
        err.code,
        err.errno,
        err.syscall,
        err.hostname,
        err.address,
        err.port,
        err.cause ? stringifyLogArg(err.cause, seen) : '',
    ].filter(Boolean).join(' ');
};

const stringifyObject = (value) => {
    try {
        return JSON.stringify(value);
    } catch (_err) {
        return String(value);
    }
};

export const stringifyLogArg = (value, seen = new WeakSet()) => {
    if (value instanceof Error) return stringifyError(value, seen);
    if (value && typeof value === 'object') return stringifyObject(value);
    return String(value ?? '');
};

export const stringifyLogArgs = (args) => args.map(arg => stringifyLogArg(arg)).join(' ');

export const isNonfatalNetworkLog = (args) => {
    const msg = Array.isArray(args) ? stringifyLogArgs(args) : String(args ?? '');
    return NONFATAL_NETWORK_PATTERNS.some(pattern => msg.includes(pattern));
};

export const summarizeLogArgs = (args, limit = 180) => {
    const msg = stringifyLogArgs(args).replace(/\s+/g, ' ').trim();
    return msg.length > limit ? `${msg.slice(0, limit)}...` : msg;
};

export const installArbiterConsoleNoiseFilter = (targetConsole = console) => {
    const originalError = targetConsole.error.bind(targetConsole);
    targetConsole.error = (...args) => {
        if (isNonfatalNetworkLog(args)) {
            targetConsole.warn('[Arbiter] Network noise (non-fatal):', summarizeLogArgs(args, 160));
            return;
        }
        originalError(...args);
    };
    return () => {
        targetConsole.error = originalError;
    };
};

