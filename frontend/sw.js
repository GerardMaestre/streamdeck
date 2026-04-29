// Auto-generated cache version based on build timestamp.
// Bump this value on every deploy or use the build system to inject it.
const BUILD_TIMESTAMP = '__BUILD_TS__';
const CACHE_NAME = BUILD_TIMESTAMP === '__BUILD_TS__'
    ? `streamdeck-pro-dev-${Date.now()}`
    : `streamdeck-pro-${BUILD_TIMESTAMP}`;

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/styles.css?v=5.0',
    '/styles/domotica.css?v=5.0',
    '/styles/mixer.css?v=5.0',
    '/styles/discord.css?v=5.0',
    '/dist/app.bundle.js',
    '/styles.css',
    '/styles/domotica.css',
    '/styles/mixer.css',
    '/styles/discord.css',
    '/socket.io/socket.io.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        ))
        .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);

    // Network-first for critical assets (HTML, JS, CSS) to avoid stale tablets
    const isCritical = requestUrl.pathname === '/' ||
        requestUrl.pathname.endsWith('.html') ||
        requestUrl.pathname.endsWith('.js') ||
        requestUrl.pathname.endsWith('.css');

    if (isCritical) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    return new Response('Offline', { status: 503, statusText: 'Offline' });
                }))
        );
        return;
    }

    // Cache-first for non-critical assets (images, fonts, etc.)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request)
                .then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
                        return networkResponse;
                    }

                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    return networkResponse;
                })
                .catch(() => {
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    return new Response('Offline', {
                        status: 503,
                        statusText: 'Offline'
                    });
                });
        })
    );
});

// Listen for messages from the app to force cache bust
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
