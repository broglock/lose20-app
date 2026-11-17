// Offline cache for the app shell. Bump VERSION after editing any app file.
const VERSION = 'lose20-1.3.1';
const FILES = ['./', 'index.html', 'version.js', 'styles.css', 'app.js', 'coach.js', 'gamify.js', 'tips.js', 'avatar.js', 'charts.js', 'fx.js', 'services.js', 'photomaya.js', 'maya/maya-frames.json', 'maya/maya-base.jpg', 'maya/maya-talk1.jpg', 'maya/maya-talk2.jpg', 'maya/maya-talk3.jpg', 'maya/maya-blink.jpg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/caveat-latin-700-normal.woff2', 'fonts/caveat-latin-500-normal.woff2', 'fonts/patrick-hand-latin-400-normal.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // never cache API calls
  // Network first so updates show up; cache when offline.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
