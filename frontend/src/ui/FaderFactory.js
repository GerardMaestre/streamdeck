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
    const offset = isDomo ? 55 : 32;
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
    const { track, fill, thumb, isDomo = false, onDragStart, onValueChange, onDragEnd } = opts;
    const captureTarget = opts.captureTarget || thumb;

    let trackRect = null;
    let trackH = 0;
    let isRAFActive = false;
    let latestClientY = 0;
    let isDestroyed = false;

    const renderVisuals = () => {
        isRAFActive = false;
        if (!trackRect || isDestroyed) return;

        let y = latestClientY - trackRect.top;
        let percentSmooth = 100 - (y / trackH) * 100;
        percentSmooth = Math.max(0, Math.min(100, percentSmooth));

        // Visual update
        fill.style.transform = `scale3d(1, ${percentSmooth / 100}, 1)`;
        setThumbTransform(thumb, percentSmooth, trackH, isDomo);

        // Callback with both smooth and rounded
        const percentRounded = Math.round(percentSmooth);
        if (onValueChange) onValueChange(percentSmooth, percentRounded);
    };

    const updateUI = (e) => {
        if (!trackRect) {
            trackRect = track.getBoundingClientRect();
            trackH = trackRect.height;
        }
        latestClientY = e.clientY;

        if (!isRAFActive) {
            isRAFActive = true;
            requestAnimationFrame(renderVisuals);
        }
    };

    const onPointerDown = (e) => {
        if (isDestroyed) return;
        e.preventDefault();
        e.stopPropagation();

        trackRect = track.getBoundingClientRect();
        trackH = trackRect.height;
        document.body.classList.add('dragging-active');

        // Capture all pointer events to this element
        captureTarget.setPointerCapture(e.pointerId);

        if (onDragStart) {
            const y = e.clientY - trackRect.top;
            let p = 100 - (y / trackH) * 100;
            p = Math.max(0, Math.min(100, p));
            onDragStart(Math.round(p));
        }

        updateUI(e);
        captureTarget.addEventListener('pointermove', updateUI);
        captureTarget.addEventListener('pointerup', releaseSlider);
        captureTarget.addEventListener('pointercancel', releaseSlider);
    };

    const releaseSlider = (e) => {
        document.body.classList.remove('dragging-active');

        try {
            captureTarget.releasePointerCapture(e.pointerId);
        } catch (_) { /* already released */ }

        captureTarget.removeEventListener('pointermove', updateUI);
        captureTarget.removeEventListener('pointerup', releaseSlider);
        captureTarget.removeEventListener('pointercancel', releaseSlider);

        if (onDragEnd) {
            const y = latestClientY - (trackRect?.top || 0);
            let p = 100 - (y / (trackRect?.height || 1)) * 100;
            p = Math.max(0, Math.min(100, Math.round(p)));
            onDragEnd(p);
        }

        trackRect = null;
    };

    // Bind: pointerdown on track (so tapping anywhere on the track starts drag)
    track.addEventListener('pointerdown', onPointerDown);

    /**
     * Set fader position programmatically (no event emission).
     */
    const setPercent = (percent) => {
        const p = Math.max(0, Math.min(100, percent));
        fill.style.transform = `scale3d(1, ${p / 100}, 1)`;
        // Need track height — use cached or measure
        let h = trackH;
        if (h === 0) {
            const r = track.getBoundingClientRect();
            h = r.height;
            if (h === 0) {
                const dvh = window.innerHeight * 0.4;
                h = Math.max(160, Math.min(300, dvh));
            }
        }
        setThumbTransform(thumb, p, h, isDomo);
    };

    const getTrackHeight = () => {
        if (trackH > 0) return trackH;
        const r = track.getBoundingClientRect();
        trackH = r.height;
        if (trackH === 0) {
            const dvh = window.innerHeight * 0.4;
            trackH = Math.max(160, Math.min(300, dvh));
        }
        return trackH;
    };

    const destroy = () => {
        isDestroyed = true;
        track.removeEventListener('pointerdown', onPointerDown);
    };

    return { destroy, setPercent, getTrackHeight };
}
