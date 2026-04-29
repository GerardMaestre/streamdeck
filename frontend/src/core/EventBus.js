/**
 * EventBus — Pub/Sub desacoplado entre módulos.
 * Evita que los módulos se referencien directamente entre sí.
 */
export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Registra un listener para un evento.
     * @returns {Function} Función para desregistrar el listener.
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /** Desregistra un listener */
    off(event, callback) {
        const set = this._listeners.get(event);
        if (set) {
            set.delete(callback);
            if (set.size === 0) this._listeners.delete(event);
        }
    }

    /** Emite un evento a todos los listeners registrados */
    emit(event, ...args) {
        const set = this._listeners.get(event);
        if (set) {
            set.forEach(cb => {
                try { cb(...args); }
                catch (e) { console.error(`[EventBus] Error in handler for "${event}":`, e); }
            });
        }
    }

    /** Listener de una sola vez */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        return this.on(event, wrapper);
    }

    /** Limpia todos los listeners */
    destroy() {
        this._listeners.clear();
    }
}
