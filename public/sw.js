// Minimal offline-ish cache. App shell cached; data network-first w/ cache fallback.
const SHELL = 'radar-shell-v4';
const ASSET_VERSION = '20260618b';
const SHELL_FILES = ['./index.html', `./app.js?v=${ASSET_VERSION}`, `./style.css?v=${ASSET_VERSION}`, './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // don't cache tiles/leaflet
  if (url.pathname.endsWith('.json')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(SHELL).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(SHELL).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  }
});
