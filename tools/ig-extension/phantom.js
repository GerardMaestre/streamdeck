// IG Extension - Auto-inject loader
// This script runs in MAIN world on instagram.com pages
// It loads the Phantom V9.4 payload

(function() {
    // Prevent double injection
    if (window.__phantom_v94_loaded) return;
    window.__phantom_v94_loaded = true;

    // Wait for page to be ready
    const waitForReady = () => {
        if (document.readyState === 'complete' || document.querySelector('[role="main"]')) {
            console.log('[IG Extension] Instagram detectado, inyectando Phantom V9.4...');
            loadPhantom();
        } else {
            setTimeout(waitForReady, 1000);
        }
    };

    function loadPhantom() {
        // The payload is in payload.js, loaded as a separate content script
        // If payload didn't load via manifest, try injecting it
        if (typeof window.__phantom_v94_init === 'function') {
            window.__phantom_v94_init();
        } else {
            console.log('[IG Extension] Phantom payload cargado via manifest content_scripts.');
        }
    }

    waitForReady();
})();
