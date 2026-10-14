// PadelFlow service worker — офлайн на корте.
// При изменении index.html поднимайте версию, чтобы у всех подтянулась новая сборка.
const CACHE = 'padelflow-v14';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

// Сколько ждём сеть при открытии приложения. У корта связь бывает «одна палочка»:
// запрос не падает, а висит — без лимита приложение открывалось бы десятки секунд.
const NAV_TIMEOUT_MS = 3000;

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

  // Саму страницу берём из сети, но если сеть не ответила за NAV_TIMEOUT_MS
  // или недоступна — сразу отдаём сохранённую копию. Запрос к сети при этом
  // продолжается и обновит кэш, когда (если) ответит.
  if(request.mode === 'navigate'){
    const network = fetch(request).then(response => {
      if(response && response.ok){
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(()=>{});
      }
      return response;
    });
    event.waitUntil(network.catch(()=>{}));

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS));
    event.respondWith(
      Promise.race([network, timeout]).catch(() =>
        caches.match('./index.html')
          .then(cached => cached || caches.match('./'))
          // Кэша ещё нет (самый первый запуск) — остаётся только ждать сеть.
          .then(cached => cached || network)
      )
    );
    return;
  }

  // Остальное (иконки, манифест) — сначала кэш, потом сеть.
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
