/* Офлайн: книги и файлы сборки кладём в кэш насовсем (их имена неизменны — хеш или id
   книги), остальное — сеть с откатом в кэш, иначе после каждой выкладки пришлось бы
   объяснять браузеру, что он устарел. */
const CACHE = 'books-3';
/* Навсегда — только неизменное: файлы сборки (хеш в имени) и содержимое книги (id в пути).
   Прогресс и выписки (/books/<id>/state) сюда попадать не должны: закэшированное навсегда
   состояние — это книга, которая на телефоне навсегда осталась там, где её открыли впервые. */
const FOREVER = /\/assets\/|\/books\/[^/]+\/(file|cover|thumb)\b|icon-\d+\.png$/;
/* Живые потоки: клонировать их в кэш нельзя — clone() у бесконечного SSE/WebSocket
   копит тело в памяти до конца сессии. */
const LIVE = /\/(books|files|tasks)\/events\b|^\/chat\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // бэкенд агента не кэшируем никогда
  if (LIVE.test(url.pathname)) return;                 // потоки отдаём сети напрямую

  if (FOREVER.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      /* Сеть может не ответить, и промах кэша тогда обязан остаться промахом, а не
         отказом: незакрытый reject здесь ронял загрузку <script> — приложение
         навсегда замирало на сплэше «открываю…». */
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      /* Оболочка лежит в кэше под тем адресом, по которому в неё заходят — «/».
         Прежний caches.match('index.html') бил в /index.html, промахивался всегда
         и возвращал undefined: respondWith(undefined) — это сетевая ошибка, то есть
         белый лист вместо читалки. */
      if (req.mode === 'navigate') {
        return (await caches.match('/')) || (await caches.match('/index.html'))
          || new Response('', { status: 504, statusText: 'Offline' });
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
