/**
 * DOM Utilities — Helpers compartidos por todos los módulos
 */

/** Convierte un nombre de app/sesión a un ID seguro para HTML */
export function sanitizeId(name) {
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/** Crea un DocumentFragment a partir de un string HTML */
export function htmlToFragment(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content;
}

/**
 * Batch Update System — Coalesce multiple DOM updates into a single RAF.
 * Usage: queueUpdate('mixer_vol_spotify', () => { ... });
 */
const updateQueue = new Map();
let isBatching = false;
let perfCallback = null;

export function setQueuePerfCallback(fn) {
    perfCallback = fn;
}

export function queueUpdate(id, fn) {
    updateQueue.set(id, fn);
    if (!isBatching) {
        isBatching = true;
        requestAnimationFrame(() => {
            const start = performance.now();
            updateQueue.forEach(fn => fn());
            updateQueue.clear();
            isBatching = false;
            if (perfCallback) perfCallback(performance.now() - start);
        });
    }
}
