// FoodDiary Service Worker
// Strategia:
// - Navigazioni (HTML): network-first, fallback alla shell in cache
// - /api/*, /uploads/*: network-only (dati dinamici, mai cache)
// - Asset same-origin: stale-while-revalidate
// - CDN cross-origin: network-first con fallback alla cache

const VERSION = 'v1';
const SHELL_CACHE = `fd-shell-${VERSION}`;
const RUNTIME_CACHE = `fd-runtime-${VERSION}`;

// Shell minima da precachare all'installazione.
// Non includiamo i JS/CSS versionati: li prende il runtime cache al primo load.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/img/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Permette alla pagina di forzare l'aggiornamento del SW
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isNavigationRequest(request) {
  return request.mode === 'navigate'
    || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET: le altre verbs passano diritte alla rete
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Mai cacheare API, upload, login/logout
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')
        || url.pathname.startsWith('/uploads/')
        || url.pathname === '/login'
        || url.pathname === '/logout') {
      return; // lascia al browser
    }
  }

  // Navigazioni: network-first, fallback a index.html in cache
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Aggiorna la shell in cache
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Asset same-origin: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (CDN: Chart.js, html5-qrcode, cropper): network-first + cache fallback
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
      }
    })
  );
});
