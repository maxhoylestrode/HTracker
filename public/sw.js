// Minimal service worker — its only job is to make the app installable
// (Chrome/Android requires one) and slightly speed up repeat loads of the
// static shell. It deliberately does NOT cache API responses or interfere
// with auth: every /api/ request and every non-GET request bypasses it
// entirely, so login state and expense data are always fetched fresh.
const CACHE_NAME = 'htracker-shell-v1';

const SHELL_ASSETS = [
  '/css/style.css',
  '/js/common.js',
  '/js/theme-boot.js',
  '/js/dashboard.js',
  '/js/calendar.js',
  '/js/expenses.js',
  '/js/budget.js',
  '/js/settings.js',
  '/js/login.js',
  '/js/signup.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API calls and anything non-GET: don't touch, let the browser do a normal
  // network request. This is the important safety rule — no financial data
  // and no auth state ever gets served from a cache.
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // HTML pages: network-first so you always see the real logged-in/out state;
  // only fall back to a cached copy if the network request fails outright
  // (offline), so the app still opens to something instead of a blank error.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (css/js/icons/manifest): cache-first, network fallback.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
