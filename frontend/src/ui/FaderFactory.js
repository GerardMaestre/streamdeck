/**
 * FaderFactory — Unified fader touch pipeline for Mixer, Discord, and Domotica.
 *
 * Instead of repeating the pointer-capture + RAF + percent-calc logic 3 times,
 * this factory creates reusable fader controllers attached to any track element.
 */

/**
 * Positions the fader thumb using compositor-only transforms (no layout reflow).
 * @param {HTMLElement} thumbEl
 * @param {number} percent  0..100
 * @param {number} trackH   track height in px
 * @param {boolean} isDomo  whether this is the large domotica thumb (110px)
 */
export function setThumbTransform(thumbEl, percent, trackH, isDomo = false) {
    if (!thumbEl) return;
    const offset = isDomo ? 55 : 55;
    const ty = offset - (percent / 100) * trackH;
    thumbEl.style.transform = `translate3d(-50%, ${ty}px, 0)`;
}

/**
 * Creates a fader controller for a given track/fill/thumb triple.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.track      - The slider container element
 * @param {HTMLElement} opts.fill       - The fill bar element
 * @param {HTMLElement} opts.thumb      - The thumb element
 * @param {boolean}     [opts.isDomo]   - Whether this is a domotica fader (larger thumb)
 * @param {Function}    opts.onDragStart - Called when drag starts: (percent) => void
 * @param {Function}    opts.onValueChange - Called on each new percent: (percentSmooth, percentRounded) => void
 * @param {Function}    opts.onDragEnd  - Called when drag ends: (finalPercent) => void
 * @param {HTMLElement} [opts.captureTarget] - Element to capture pointer on (defaults to thumb)
 * @returns {Object} Controller with { destroy(), setPercent(p) }
 */
export function createFaderController(opts) {
    const { track, fill, thumb, isDomo = false, onDragStart, onValueChange, onDragEnd, initialPercent = 0 } = opts;
    const captureTarget = opts.captureTarget || track;
    const disableSmooth = !!opts.disableSmooth;
    const lowPerf = document.body.classList.contains('low-perf') || document.body.classList.contains('mixer-low-perf');
    const lerpFactor = disableSmooth || lowPerf ? 1 : 0.25;

    let trackRect = null;
    let trackH = 0;
    let targetPercent = initialPercent;
    let currentPercent = initialPercent;
    let isRendering = false;
    let isDragging = false;
    let isDestroyed = false;
    let currentPointerId = null;
    let lastRounded = -1;

    const updateVisuals = () => {
        const percent = currentPercent;
        fill.style.transform = `scale3d(1, ${percent / 100}, 1)`;
        setThumbTransform(thumb, percent, trackH, isDomo);
    };

    const renderLoop = () => {
        if (isDestroyed || !trackRect) {
            isRendering = false;
            return;
        }

        if (lowPerf) {
            currentPercent = targetPercent;
        } else {
            currentPercent += (targetPercent - currentPercent) * lerpFactor;
        }

        updateVisuals();

        const rounded = Math.round(currentPercent);
        if (onValueChange && rounded !== lastRounded) {
            lastRounded = rounded;
            onValueChange(currentPercent, rounded);
        }

        if (!isDragging && Math.abs(targetPercent - currentPercent) > 0.15 && !lowPerf) {
            requestAnimationFrame(renderLoop);
        } else {
            currentPercent = targetPercent;
            updateVisuals();
            isRendering = false;
        }
    };

    const scheduleRender = () => {
        if (isRendering) return;
        isRendering = true;
        requestAnimationFrame(renderLoop);
    };

    const updateTargetFromEvent = (e) => {
        if (!trackRect) {
            trackRect = track.getBoundingClientRect();
            trackH = trackRect.height;
        }
        let y = e.clientY - trackRect.top;
        let p = 100 - (y / trackH) * 100;
        targetPercent = Math.max(0, Math.min(100, p));
    };

    const updateUI = (e) => {
        updateTargetFromEvent(e);
        if (isDragging) {
            currentPercent = targetPercent;
            updateVisuals();
            const rounded = Math.round(currentPercent);
            if (onValueChange && rounded !== lastRounded) {
                lastRounded = rounded;
                onValueChange(currentPercent, rounded);
            }
        }
    };

    const addDocumentListeners = () => {
        // Use passive pointermove to let browser optimize touch handling.
        try {
            window.addEventListener('pointermove', updateUI, { passive: true });
        } catch (e) {
            // fallback for older browsers
            window.addEventListener('pointermove', updateUI);
        }
        window.addEventListener('pointerup', releaseSlider);
        window.addEventListener('pointercancel', releaseSlider);
    };

    const removeDocumentListeners = () => {
        window.removeEventListener('pointermove', updateUI);
        window.removeEventListener('pointerup', releaseSlider);
        window.removeEventListener('pointercancel', releaseSlider);
    };

    const onPointerDown = (e) => {
        if (isDestroyed) return;
        e.preventDefault();
        e.stopPropagation();
        trackRect = track.getBoundingClientRect();
        trackH = trackRect.height;
        document.body.classList.add('dragging-active');
        currentPointerId = e.pointerId;
        isDragging = true;

        // Aggressive compositor hints while dragging
        try {
            track.style.willChange = 'transform';
            fill.style.willChange = 'transform';
            thumb.style.willChange = 'transform';
        } catch (_) {}

        try {
            captureTarget.setPointerCapture(e.pointerId);
        } catch (_) {}

        updateTargetFromEvent(e);
        currentPercent = targetPercent;
        updateVisuals();

        if (onDragStart) {
            onDragStart(Math.round(targetPercent));
        }

        addDocumentListeners();
    };

    const releaseSlider = (e) => {
        document.body.classList.remove('dragging-active');
        isDragging = false;
        // Remove aggressive compositor hints
        try {
            track.style.willChange = '';
            fill.style.willChange = '';
            thumb.style.willChange = '';
        } catch (_) {}
        try {
            if (currentPointerId !== null) captureTarget.releasePointerCapture(currentPointerId);
        } catch (_) { }

        removeDocumentListeners();

        if (onDragEnd) {
            onDragEnd(Math.round(targetPercent));
        }

        scheduleRender();
        trackRect = null;
        currentPointerId = null;
    };

    track.addEventListener('pointerdown', onPointerDown);

    const setPercent = (percent, immediate = false) => {
        const p = Math.max(0, Math.min(100, percent));
        targetPercent = p;
        if (immediate) currentPercent = p;

        if (trackH === 0) {
            const r = track.getBoundingClientRect();
            trackH = r.height || Math.max(160, Math.min(300, window.innerHeight * 0.4));
            trackRect = r;
        }

        if (immediate) {
            updateVisuals();
        } else {
            scheduleRender();
        }
    };

    const getTrackHeight = () => {
        if (trackH > 0) return trackH;
        const r = track.getBoundingClientRect();
        trackH = r.height;
        if (trackH === 0) {
            trackH = Math.max(160, Math.min(300, window.innerHeight * 0.4));
        }
        return trackH;
    };

    const destroy = () => {
        isDestroyed = true;
        track.removeEventListener('pointerdown', onPointerDown);
        removeDocumentListeners();
    };

    return { destroy, setPercent, getTrackHeight };
}
