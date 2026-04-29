/**
 * PerfService — Performance monitoring + low-perf mode detection.
 */
export class PerfMonitor {
    constructor() {
        this.fps = 0;
        this.frames = 0;
        this.lastTime = performance.now();
        this.lastPing = 0;
    }

    markRender(ms) {
        // Placeholder for DevTools integration
    }

    updateServerStats(data) {
        // Placeholder
    }

    updatePing(ms) {
        this.lastPing = ms;
    }
}

/**
 * Detecta si el dispositivo debería usar modo low-performance.
 * Usa navigator.deviceMemory, hardwareConcurrency y maxTouchPoints.
 */
export function shouldUseLowPerformanceMode() {
    const savedLowPerf = localStorage.getItem('streamdeck_lowPerf');
    if (savedLowPerf !== null) return savedLowPerf === 'true';

    const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 2;
    const lowCpu = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const oldTouchDevice = navigator.maxTouchPoints > 0 && (lowMemory || lowCpu);
    return Boolean(lowMemory || oldTouchDevice);
}
