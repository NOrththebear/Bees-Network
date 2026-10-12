// Service Worker for Bees Network PWA
//
// Caching strategy (deliberately conservative):
// - Non-GET (notably CKB JSON-RPC POSTs): NEVER intercepted. The Cache API
//   rejects non-GET puts, and app code must never run stale.
// - Immutable static assets (icons, manifest, svg): cache-first.
// - Everything else (HTML shell, _next chunks): NETWORK-FIRST with cache
//   fallback. Dev chunk URLs are stable across edits (no content hashes),
//   so cache-first here replays stale code forever to repeat visitors —
//   that exact bug once trapped the app behind its splash screen.
//   Network-first keeps repeat visits (including installed-PWA relaunches)
//   always fresh, while still working offline from cache.

const CACHE_NAME = 'bees-network-v3';
const API_CACHE_NAME = 'bees-network-api-v3';

// Fingerprinted-by-content in prod, never edited: safe to serve from cache.
const IMMUTABLE_ASSETS = [
  '/manifest.json',
  '/bee-mark.svg',
  '/bee_network_splash.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Install - cache immutable assets (failures must not block activation)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        IMMUTABLE_ASSETS.map((url) =>
          fetch(url)
            .then((response) => {
              if (response.ok) return cache.put(url, response);
              return undefined;
            })
            .catch(() => undefined),
        ),
      );
    }),
  );
  self.skipWaiting();
});

// Activate - clean old caches (v1/v2 held stale shells and POST debris)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Third-party GETs (fonts, RPC endpoints): never cache, never intercept.
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function putSafely(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    // Cache write failures (quota, races) must never break loads.
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await putSafely(CACHE_NAME, request, response);
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await putSafely(CACHE_NAME, request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('/');
    throw new Error('Offline');
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
