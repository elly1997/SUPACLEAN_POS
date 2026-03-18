/* SUPACLEAN POS - Offline-capable service worker. Caches static assets only; never cache the app document. */
const CACHE_NAME = 'supaclean-pos-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/supaclean-logo.svg',
        '/manifest.json'
      ]).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Never cache the app document (/, index.html) so normal mode always gets fresh HTML/JS after deploy.
// Cache static assets only; for docs use network with no-store so we don't serve stale app.
self.addEventListener('fetch', (event) => {
  const u = new URL(event.request.url);
  if (u.pathname.startsWith('/api/') || (u.origin !== self.location.origin)) {
    return;
  }
  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document';
  if (isDocument) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
