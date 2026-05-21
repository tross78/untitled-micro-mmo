import { summarizeLogArgs } from './arbiter-log-filter.js';

const DEFAULT_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 30 * 60 * 1000;
const SUCCESS_LOG_COOLDOWN_MS = 5 * 60 * 1000;
const FAILURE_LOG_COOLDOWN_MS = 60 * 1000;

const timeoutSignal = (timeoutMs) => {
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
    return AbortSignal.timeout(timeoutMs);
};

export const createOptionalGistPublisher = ({
    gistId,
    token,
    fetchImpl = globalThis.fetch,
    log = console,
    now = () => Date.now(),
    timeoutMs = 15000,
    retryMs = DEFAULT_RETRY_MS,
    maxRetryMs = MAX_RETRY_MS,
    successLogCooldownMs = SUCCESS_LOG_COOLDOWN_MS,
    failureLogCooldownMs = FAILURE_LOG_COOLDOWN_MS,
} = {}) => {
    let failureCount = 0;
    let nextAttemptAt = 0;
    let lastSuccessLogAt = 0;
    let lastFailureLogAt = 0;
    let status = token && gistId ? 'ready' : 'unconfigured';

    const configured = Boolean(token && gistId);

    const logSuccess = (at) => {
        if (status !== 'ok' || at - lastSuccessLogAt >= successLogCooldownMs) {
            log.log('[Arbiter] Beacon updated (Gist).');
            lastSuccessLogAt = at;
        }
    };

    const logFailure = (err, waitMs, at) => {
        if (status !== 'error' || at - lastFailureLogAt >= failureLogCooldownMs) {
            log.warn(`[Arbiter] Gist update failed (${summarizeLogArgs([err], 140)}); retrying in ${Math.ceil(waitMs / 1000)}s.`);
            lastFailureLogAt = at;
        }
    };

    return {
        isConfigured() {
            return configured;
        },
        getStatus() {
            return {
                configured,
                status,
                failureCount,
                nextAttemptAt,
            };
        },
        async publish(packet) {
            if (!configured) return { ok: false, skipped: 'unconfigured' };
            const at = now();
            if (at < nextAttemptAt) return { ok: false, skipped: 'backoff', nextAttemptAt };

            const gistPayload = { ...packet, ts: at };
            const files = {
                'mmo_arbiter_discovery_v4.json': {
                    content: JSON.stringify(gistPayload),
                },
            };

            try {
                const response = await fetchImpl(`https://api.github.com/gists/${gistId}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files }),
                    signal: timeoutSignal(timeoutMs),
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                failureCount = 0;
                nextAttemptAt = 0;
                logSuccess(at);
                status = 'ok';
                return { ok: true };
            } catch (err) {
                failureCount += 1;
                const waitMs = Math.min(maxRetryMs, retryMs * (2 ** Math.max(0, failureCount - 1)));
                nextAttemptAt = at + waitMs;
                logFailure(err, waitMs, at);
                status = 'error';
                return { ok: false, error: err, nextAttemptAt };
            }
        },
    };
};

