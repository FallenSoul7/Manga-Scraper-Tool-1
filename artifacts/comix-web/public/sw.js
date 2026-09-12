const STATIC_CACHE = 'comihub-static-v10';
const API_CACHE    = 'comihub-api-v4';
const IMAGE_CACHE  = 'comihub-images-v1';
const OFFLINE_IMAGE_CACHE = 'comihub-offline-v1';
const OFFLINE_PAGES_CACHE = 'comihub-offline-pages-v1';

const OWNED_CACHES = [
  STATIC_CACHE,
  API_CACHE,
  IMAGE_CACHE,
  OFFLINE_IMAGE_CACHE,
  OFFLINE_PAGES_CACHE,
];

const API_PATTERNS = ['/api/sources/catalog', '/api/popular', '/api/latest', '/api/search', '/api/tags', '/api/details', '/api/chapters', '/api/pages'];
const IMAGE_PATTERNS = ['/api/image'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.add('/')).catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Offline chapter caches are user data. Never delete them during a
          // service-worker version update.
          .filter((k) => !OWNED_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return API_PATTERNS.some((p) => url.pathname.includes(p));
}
function isImageRequest(url) {
  return IMAGE_PATTERNS.some((p) => url.pathname.includes(p)) ||
    /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url.pathname);
}
function isHashedAsset(url) {
  return /\/assets\/[^/]+-[a-zA-Z0-9]{8,}\.(js|css)$/.test(url.pathname);
}
function isCodeAsset(url) {
  return /\.(js|css)$/i.test(url.pathname) &&
    !url.pathname.endsWith('/sw.js');
}
function isStaticAsset(url) {
  return /\.(woff2?|ttf|eot|svg|ico|png|webp|jpg|jpeg|manifest\.json)$/i.test(url.pathname) &&
    !url.pathname.includes('/api/');
}
function isHtml(request, url) {
  return request.mode === 'navigate' || (url.pathname === '/' || url.pathname === '/index.html');
}

// Cache API responses under the selected extension as well as the URL. Cache
// matching otherwise ignores the X-Source header and can return another
// extension's detail response for the same manga ID.
function sourceCacheKey(request) {
  const source = request.headers.get('X-Source');
  if (!source) return request;
  const url = new URL(request.url);
  url.searchParams.set('__comihub_source', source);
  return new Request(url.toString(), { method: 'GET' });
}

async function networkFirst(request, cacheName, maxAgeSecs) {
  const cache = await caches.open(cacheName);
  const key = sourceCacheKey(request);
  try {
    const res = await fetch(request.clone());
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cloned = new Response(await res.clone().arrayBuffer(), { status: res.status, headers });
      cache.put(key, cloned);
    }
    return res;
  } catch {
    const cached = await cache.match(key);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      if (!maxAgeSecs || Date.now() - cachedAt < maxAgeSecs * 1000) return cached;
    }
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName, maxAgeSecs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
    if (!maxAgeSecs || Date.now() - cachedAt < maxAgeSecs * 1000) return cached;
  }
  try {
    const res = await fetch(request.clone());
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cloned = new Response(await res.clone().arrayBuffer(), { status: res.status, headers });
      cache.put(request, cloned);
    }
    return res;
  } catch {
    if (cached) return cached;
    return new Response('', { status: 503 });
  }
}

async function offlineImageFirst(request) {
  const offlineCache = await caches.open(OFFLINE_IMAGE_CACHE);
  const offline = await offlineCache.match(request);
  if (offline) return offline;
  return cacheFirst(request, IMAGE_CACHE, 30 * 24 * 3600);
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request) ||
    (request.mode === 'navigate' ? await cache.match('/') : undefined);

  const update = fetch(request.clone()).then((res) => {
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cloned = new Response(res.clone().body, { status: res.status, headers });
      cache.put(request, cloned);
    }
    return res;
  }).catch(() => null);

  if (cached) {
    // Do not hold the navigation open for a network response. The next
    // launch will use the refreshed shell if the update succeeded.
    update.catch(() => {});
    return cached;
  }

  const fresh = await update;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/auth')) return;

  // Downloaded pages are stored under same-origin /api/image URLs. Check the
  // persistent offline cache first so the reader works with no network.
  if (isImageRequest(url)) {
    event.respondWith(
      url.origin === self.location.origin
        ? offlineImageFirst(event.request)
        : cacheFirst(event.request, IMAGE_CACHE, 30 * 24 * 3600),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(event.request, API_CACHE, 3600));
  } else if (isHashedAsset(url) || isCodeAsset(url)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE, null));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE, 7 * 24 * 3600));
  } else if (isHtml(event.request, url)) {
    event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
  }
});

async function getCacheSizes() {
  const names = [STATIC_CACHE, API_CACHE, IMAGE_CACHE];
  const result = {};
  for (const name of names) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    let bytes = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (res) {
        const blob = await res.clone().blob();
        bytes += blob.size;
      }
    }
    result[name] = bytes;
  }
  return result;
}

async function clearAllCaches() {
  const names = await caches.keys();
  await Promise.all(names.map((n) => caches.delete(n)));
}


// ─── Background Fetch API ─────────────────────────────────────────────────────
// On Chrome/Edge/Android, downloads can continue even when the tab is closed.
// These handlers cache the downloaded images for offline reading and notify
// open tabs so the UI can update.

self.addEventListener('backgroundfetchsuccess', async (event) => {
  const bgFetch = event.registration;
  try {
    const cache = await caches.open('comihub-offline-v1');
    const responses = await bgFetch.matchAll();
    for (const response of responses) {
      const url = response.url;
      if (!url) continue;
      const ct = response.headers.get('Content-Type') || '';
      if (ct.startsWith('image/') || ct.startsWith('application/octet-stream')) {
        await cache.put(url, response.clone());
      }
    }
  } catch (e) {
    // Caching may fail if storage quota is exceeded — downloads still completed
  }

  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'BG_FETCH_SUCCESS', id: bgFetch.id });
  }

  event.waitUntil(Promise.resolve());
});

self.addEventListener('backgroundfetchfail', async (event) => {
  const bgFetch = event.registration;
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'BG_FETCH_FAIL', id: bgFetch.id });
  }
  event.waitUntil(Promise.resolve());
});

self.addEventListener('backgroundfetchabort', async (event) => {
  const bgFetch = event.registration;
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'BG_FETCH_ABORT', id: bgFetch.id });
  }
  event.waitUntil(Promise.resolve());
});

self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});


self.addEventListener('message', async (event) => {
  if (event.data === 'GET_CACHE_SIZES') {
    const sizes = await getCacheSizes();
    event.source.postMessage({ type: 'CACHE_SIZES', sizes });
  }
  if (event.data === 'CLEAR_ALL_CACHES') {
    await clearAllCaches();
    event.source.postMessage({ type: 'CACHES_CLEARED' });
  }
});
