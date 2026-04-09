// FoodDiary Service Worker
// Strategia:
// - Navigazioni (HTML): network-first, fallback alla shell in cache
// - GET /api/* whitelist (diary, plan, range): SWR per lettura offline
// - Altre /api/*, /uploads/*: network-only (dinamici, mai cache)
// - Asset same-origin: stale-while-revalidate
// - CDN cross-origin: network-first con fallback alla cache

const VERSION = 'v2';
const SHELL_CACHE = `fd-shell-${VERSION}`;
const RUNTIME_CACHE = `fd-runtime-${VERSION}`;
const API_CACHE = `fd-api-${VERSION}`;

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
  // NB: niente skipWaiting qui — lo scatena il client via messaggio SKIP_WAITING
  // dopo che l'utente ha cliccato "Ricarica" sul banner update.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))
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

// Endpoint GET /api/* che sono sicuri da servire da cache quando offline.
// Restano esclusi: /api/plan/snapshot (no-store per design), /api/foods* (ricerca)
// e tutti gli endpoint di settings.
function isCacheableApi(url) {
  const p = url.pathname;
  if (p === '/api/plan') return true;
  if (p === '/api/plan/all') return true;
  if (p === '/api/diary') return true;                  // ?date=YYYY-MM-DD
  if (p === '/api/diary/range') return true;            // ?from=&to=
  if (p === '/api/diary/days') return true;             // ?limit=
  if (p === '/api/diary/recent') return true;           // ?meal_type=
  if (p === '/api/diary/frequent') return true;         // ?meal_type=
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET: le altre verbs passano diritte alla rete
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API: cache SWR per la whitelist, network-only per il resto
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (!isCacheableApi(url)) return; // lascia al browser
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached); // se la rete fallisce, ripiega su cache
        // SWR: se c'è cache, servila subito e aggiorna in background
        return cached || network;
      })
    );
    return;
  }

  // Uploads e login/logout: sempre network
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/uploads/')
        || url.pathname === '/login'
        || url.pathname === '/logout') {
      return;
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
