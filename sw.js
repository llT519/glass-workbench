/* 玻璃工作台 Service Worker：静态资源缓存优先，API 请求直连。
   注意：浏览器仅允许 https 或 localhost 页面注册 SW；局域网 http 访问时会静默跳过（功能不受影响）。 */
const CACHE = 'workbench-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sync.js',
  './manifest.json',
  './vendor/palette-engine.js',
  './vendor/palette-presets.js',
  './vendor/fluid-glass-engine.js',
  './vendor/fluid-glass-material.css',
  './三维卡片环/index.html',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((u) => cache.add(u))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.includes('/rest/v1/')) return; // 云同步 API 直连不缓存
  if (url.origin !== location.origin) return;
  /* 网络优先：文件更新后立即生效，断网时回退缓存 */
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html')))
  );
});
