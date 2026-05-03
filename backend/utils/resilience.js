const DEFAULT_TIMEOUT_CODE = 'TIMEOUT_EXCEEDED';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promiseFactory, timeoutMs, { reasonCode = DEFAULT_TIMEOUT_CODE } = {}) => {
    let timer = null;
    try {
        return await Promise.race([
            Promise.resolve().then(() => promiseFactory()),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(`Operation timed out after ${timeoutMs}ms`);
                    error.code = reasonCode;
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const retryWithBackoff = async (operation, {
    retries = 2,
    initialDelayMs = 200,
    maxDelayMs = 2000,
    factor = 2,
    shouldRetry = () => true,
    onRetry = () => {}
} = {}) => {
    let attempt = 0;
    let delay = initialDelayMs;

    while (true) {
        try {
            return await operation(attempt + 1);
        } catch (error) {
            const canRetry = attempt < retries && shouldRetry(error, attempt + 1);
            if (!canRetry) throw error;
            onRetry(error, attempt + 1, delay);
            await wait(delay);
            delay = Math.min(maxDelayMs, Math.max(1, Math.round(delay * factor)));
            attempt += 1;
        }
    }
};

const createCircuitState = ({ failureThreshold = 3, cooldownMs = 30000 } = {}) => {
    let failures = 0;
    let openedAt = 0;

    const isOpen = () => failures >= failureThreshold && (Date.now() - openedAt) < cooldownMs;

    return {
        canRequest() {
            if (!isOpen()) return true;
            return false;
        },
        recordSuccess() {
            failures = 0;
            openedAt = 0;
        },
        recordFailure() {
            failures += 1;
            if (failures >= failureThreshold && !openedAt) openedAt = Date.now();
        },
        snapshot() {
            return {
                failures,
                isOpen: isOpen(),
                retryInMs: isOpen() ? Math.max(0, cooldownMs - (Date.now() - openedAt)) : 0
            };
        }
    };
};

module.exports = { withTimeout, retryWithBackoff, circuitState: createCircuitState };
