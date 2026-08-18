/*
 * Opportunity Radar service worker.
 *
 * Intelligence is never served from a cache: a score shown offline that has
 * since moved is worse than no score at all. The worker therefore caches only
 * the application shell and static assets, and always goes to the network for
 * pages and API responses. When the network is unavailable it says so plainly
 * rather than presenting stale numbers as current.
 */
const SHELL_CACHE = 'radar-shell-v1';
const SHELL_ASSETS = ['/offline', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache data. Falling back to a cached opportunity score would make the
  // interface lie about what Radar currently believes.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline').then((cached) => cached ?? new Response('Offline', { status: 503 })),
      ),
    );
    return;
  }

  // Immutable build output is safe to serve from cache.
  if (url.pathname.startsWith('/_next/static/') || SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
