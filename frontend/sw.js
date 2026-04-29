const CACHE_NAME = 'streamdeck-pro-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/styles.css?v=3.1',
    '/styles/domotica.css?v=3.0',
    '/styles/mixer.css?v=3.0',
    '/styles/discord.css?v=3.0',
    '/app.js?v=4.1',
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
