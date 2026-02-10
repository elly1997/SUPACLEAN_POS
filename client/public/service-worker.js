/* SUPACLEAN POS - Offline-capable service worker. Caches app shell for offline load. */
const CACHE_NAME = 'supaclean-pos-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/supaclean-logo.svg',
        '/manifest.json'
      ]).catch(() => {}); // ignore if some fail (e.g. in dev)
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

// Network first for API; cache fallback for same-origin doc/static
self.addEventListener('fetch', (event) => {
  const u = new URL(event.request.url);
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('http') && !u.origin.startsWith(self.location.origin)) {
    return; // API and cross-origin: no cache, let browser handle
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});
