// 每日时事 离线缓存 v2：
// 网络优先、失败回退缓存 —— 保证网页/App 永远拿到最新版本，断网时才用缓存兜底
const CACHE = 'daily-news-v3';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    // 新闻接口：网络优先，断网时返回最近一次缓存
    e.respondWith(
      fetch(e.request)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
        .catch(() => caches.match(e.request).then(m => m || new Response(JSON.stringify({ error: '当前离线，暂无缓存数据' }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })))
    );
    return;
  }
  // 页面与静态资源：网络优先（保证代码更新及时），失败回退缓存
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && url.origin === self.location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
