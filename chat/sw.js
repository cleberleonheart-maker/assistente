const CACHE = 'assistente-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './vendor/marked.min.js',
  './vendor/purify.min.js',
  './vendor/hljs/highlight.min.js',
  './vendor/hljs/github-dark.min.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const MATCH = { ignoreSearch: true };

async function redeDepoisCache(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, MATCH);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // chamadas de API (provedores de chat/imagem) nunca passam pelo cache
  if (url.origin !== self.location.origin) return;

  e.respondWith(redeDepoisCache(req));
});
