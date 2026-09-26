// 離線快取：App 本身優先抓網路（才拿得到更新），沒網路時用快取。
const CACHE = 'kitchen-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './config.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase SDK 檔案有版本號，不會變，快取優先
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(request).then(
        hit =>
          hit ||
          fetch(request).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // no-cache：略過瀏覽器的 HTTP 快取（GitHub Pages 預設快取 10 分鐘），更新才會馬上生效
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))),
  );
});
