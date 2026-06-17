const STATIC_CACHE = 'comihub-static-v2';
const API_CACHE = 'comihub-api-v2';
const IMAGE_CACHE = 'comihub-images-v1';

const API_PATTERNS = ['/api/popular', '/api/latest', '/api/search', '/api/tags', '/api/details', '/api/chapters', '/api/pages'];
const IMAGE_PATTERNS = ['/api/image'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete all old caches (any that are not in the current set)
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, API_CACHE, IMAGE_CACHE].includes(k))
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

function isStaticAsset(url) {
  return /\.(js|css|woff2?|ttf|eot|svg|ico)$/i.test(url.pathname);
}

async function networkFirst(request, cacheName, maxAgeSecs) {
  const cache = await caches.open(cacheName);
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
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      if (!maxAgeSecs || Date.now() - cachedAt < maxAgeSecs * 1000) return cached;
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !isImageRequest(url)) return;

  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE, 30 * 24 * 3600));
  } else if (isApiRequest(url)) {
    event.respondWith(networkFirst(event.request, API_CACHE, 3600));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE, null));
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
