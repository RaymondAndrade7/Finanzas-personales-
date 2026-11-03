// Service worker: permite usar la app sin conexión.
const CACHE = 'rayfin-v11';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './cloud.js', './auth-bg.js', './splash.js', './ray.js', './fijos.js', './deudas.js', './pareja.js', './firebase-config.js', './manifest.json',
  './icons/rayfin-rf.svg', './icons/rayfin-rf-180.png', './icons/rayfin-rf-192.png', './icons/rayfin-rf-512.png', './icons/rayfin-rf-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Red primero (para recibir actualizaciones), caché si no hay conexión.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Archivos propios + librería de Firebase (para abrir la app sin conexión).
  const cacheable = url.origin === location.origin || url.href.startsWith('https://www.gstatic.com/firebasejs/');
  if (e.request.method !== 'GET' || !cacheable) return;
  // Archivos propios: siempre preguntar al servidor si hay versión nueva (evita la caché de 10 min).
  const req = url.origin === location.origin
    ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(e.request);
  e.respondWith(
    req
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
