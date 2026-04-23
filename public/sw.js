// FoodDiary Service Worker
// Strategia:
// - Navigazioni (HTML): network-first, fallback alla shell in cache
// - GET /api/* whitelist (diary, plan, range): SWR per lettura offline
// - Altre /api/*, /uploads/*: network-only (dinamici, mai cache)
// - Asset same-origin: stale-while-revalidate
// - CDN cross-origin: network-first con fallback alla cache

const VERSION = 'v24';
const SHELL_CACHE = `fd-shell-${VERSION}`;
const RUNTIME_CACHE = `fd-runtime-${VERSION}`;
const API_CACHE = `fd-api-${VERSION}`;
const UPLOADS_CACHE = `fd-uploads-${VERSION}`;

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
  '/img/meals/colazione.svg',
  '/img/meals/spuntino.svg',
  '/img/meals/pranzo.svg',
  '/img/meals/merenda.svg',
  '/img/meals/cena.svg',
  '/img/meals/extra.svg',
];

// CDN cross-origin usati da index.html (Chart.js, html5-qrcode, cropper).
// Vengono pre-cacheati con mode: 'no-cors' per avere le response opaque
// disponibili offline. Senza precache, se il SW installa ma la pagina non
// viene ricaricata online, gli script non sarebbero in cache.
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.css',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.js',
  // Inter font: CSS + family entry point (i file woff2 vengono risolti run-time)
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

// Helper: true se la response è valida da cacheare (incluse opaque dei CDN)
function isCacheable(response) {
  if (!response) return false;
  // Same-origin 200, o opaque (cross-origin no-cors)
  return response.status === 200 || response.type === 'opaque';
}

// Install: precache robusto. Ogni asset fallito non blocca gli altri.
async function precacheShell(cache) {
  await Promise.all(SHELL_ASSETS.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (isCacheable(res)) await cache.put(url, res);
    } catch (e) {
      console.warn('[sw] precache fallito per', url, e);
    }
  }));
  await Promise.all(CDN_ASSETS.map(async (url) => {
    try {
      const req = new Request(url, { mode: 'no-cors' });
      const res = await fetch(req);
      if (isCacheable(res)) await cache.put(req, res);
    } catch (e) {
      console.warn('[sw] precache CDN fallito per', url, e);
    }
  }));
}

self.addEventListener('install', (event) => {
  // NB: niente skipWaiting qui — lo scatena il client via messaggio SKIP_WAITING
  // dopo che l'utente ha cliccato "Ricarica" sul banner update.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => precacheShell(cache))
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, API_CACHE, UPLOADS_CACHE]);
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
// Restano esclusi: /api/plan/snapshot (no-store per design), /api/me e
// tutti gli endpoint di settings.
function isCacheableApi(url) {
  const p = url.pathname;
  if (p === '/api/plan') return true;
  if (p === '/api/plan/all') return true;
  if (p === '/api/diary') return true;                  // ?date=YYYY-MM-DD
  if (p === '/api/diary/range') return true;            // ?from=&to=
  if (p === '/api/diary/days') return true;             // ?limit=
  if (p === '/api/diary/recent') return true;           // ?meal_type=
  if (p === '/api/diary/frequent') return true;         // ?meal_type=
  // Libreria alimenti: lista, ricerche, dettagli, barcode, proxy immagini
  if (p.startsWith('/api/foods')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET: le altre verbs passano diritte alla rete
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API: network-first, cache fallback (solo offline)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (!isCacheableApi(url)) return; // lascia al browser
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (isCacheable(response)) cache.put(request, response.clone());
          return response;
        } catch (err) {
          // Offline: serve dalla cache se disponibile
          const cached = await cache.match(request);
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  // Login/logout: sempre network (le POST non passano di qui, ma per sicurezza)
  if (url.origin === self.location.origin
      && (url.pathname === '/login' || url.pathname === '/logout')) {
    return;
  }

  // Uploads (foto alimenti): SWR su cache dedicata
  if (url.origin === self.location.origin && url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(UPLOADS_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (isCacheable(response)) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
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
            if (isCacheable(response)) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (CDN: Chart.js, html5-qrcode, cropper): cache-first
  // Questi sono pre-cacheati all'install in SHELL_CACHE. Se miss → network → cache.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (isCacheable(response)) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      // Ultima chance: ricerca in tutte le cache
      const fallback = await caches.match(request, { ignoreSearch: false });
      if (fallback) return fallback;
      throw err;
    }
  })());
});
