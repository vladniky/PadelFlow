// PadelFlow service worker — офлайн на корте.
// При изменении index.html поднимайте версию, чтобы у всех подтянулась новая сборка.
const CACHE = 'padelflow-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  const url = new URL(request.url);
  // Запросы к Supabase никогда не кэшируем — это живые данные.
  if(url.hostname.endsWith('supabase.co')) return;

  // Саму страницу берем из сети, но при её отсутствии отдаем кэш.
  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(()=>{});
          return response;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Остальное (иконки, шрифты, supabase-js с CDN) — сначала кэш, потом сеть.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(()=>{});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
