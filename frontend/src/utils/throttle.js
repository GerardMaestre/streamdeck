/**
 * Throttle & Debounce Utilities
 */

/**
 * Throttled emit scheduler — coalesce rapid emits into one per interval.
 * Shared state is stored per-instance in the maps passed as context.
 */
export class ThrottleScheduler {
    constructor(defaultIntervalMs = 50) {
        this.defaultIntervalMs = defaultIntervalMs;
        this._times = {};
        this._timers = {};
        this._fns = {};
    }

    schedule(key, emitFn, intervalMs = this.defaultIntervalMs) {
        this._fns[key] = emitFn;

        const now = Date.now();
        const last = this._times[key] || 0;
        const elapsed = now - last;

        const runEmit = () => {
            this._times[key] = Date.now();
            this._timers[key] = null;
            if (this._fns[key]) this._fns[key]();
        };

        if (elapsed >= intervalMs) {
            if (this._timers[key]) {
                clearTimeout(this._timers[key]);
                this._timers[key] = null;
            }
            runEmit();
            return;
        }

        if (!this._timers[key]) {
            this._timers[key] = setTimeout(runEmit, Math.max(1, intervalMs - elapsed));
        }
    }

    cancel(key) {
        if (this._timers[key]) {
            clearTimeout(this._timers[key]);
            this._timers[key] = null;
        }
        delete this._fns[key];
    }

    cancelAll() {
        Object.keys(this._timers).forEach(key => this.cancel(key));
    }
}

/**
 * Simple debounce — delays execution until `delayMs` of silence.
 */
export function debounce(fn, delayMs) {
    let timer = null;
    const debounced = (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delayMs);
    };
    debounced.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };
    return debounced;
}
