/*
  EASY RIDE 180 — Service Worker
  Цель: базовое кэширование статики для работы при плохом сигнале на трассе.
  Политика:
  - HTML (navigation): network-first, fallback на cache.
  - Статика (css/js/svg/png/json): cache-first.
  - Supabase / внешние API: network-only.
*/

const CACHE_VERSION = 'monolith180-static-v2';
const STATIC_CACHE = CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './final.html',
  './manifest.json',
  './icon.svg',
  './safedrive-responsive.css',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        // Не блокируем установку: кэш может не собраться при плохой сети.
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        );
      } catch (e) {}
      await self.clients.claim();
    })()
  );
});

function isSupabaseOrApiRequest(url) {
  const s = String(url || '');
  if (s.includes('/functions/v1/')) return true;
  if (s.includes('/rest/v1/')) return true;
  if (s.includes('/auth/v1/')) return true;
  if (s.includes('supabase.co')) return true;
  return false;
}

function isCacheableStatic(url) {
  const pathname = url.pathname || '';
  return (
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.json') ||
    pathname.endsWith('.woff2')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не трогаем чужие домены (Telegram/Yandex/CDN) и Supabase API.
  if (url.origin !== self.location.origin) return;
  if (isSupabaseOrApiRequest(url.href)) {
    event.respondWith(fetch(req));
    return;
  }

  // Навигация: network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          const cached = await caches.match(req);
          if (cached) return cached;
          // fallback на precache
          const fallback = await caches.match('./final.html');
          return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  // Статика: cache-first
  if (isCacheableStatic(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;

        try {
          const fresh = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          return new Response('', { status: 504 });
        }
      })()
    );
    return;
  }

  // Остальное: сеть (без кэша)
  event.respondWith(fetch(req));
});

// Совместимость с текущими уведомлениями из приложения
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'SHOW_NOTIFICATION') return;
  const title = data.title || 'EASY RIDE 180';
  const options = data.options || {};
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification?.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (targetUrl && 'navigate' in client) {
            try { client.navigate(targetUrl); } catch (e) {}
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
