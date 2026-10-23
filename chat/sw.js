const CACHE = 'assistente-v2';
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
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // não falha a instalação inteira se um arquivo estiver indisponível
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
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

// vendor/ícones não mudam: responde do cache e atualiza em segundo plano
async function cacheDepoisRede(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  const rede = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    rede.catch(() => {});
    return hit;
  }
  return rede;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // chamadas de API (provedores de chat/imagem) nunca passam pelo cache
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')) {
    e.respondWith(cacheDepoisRede(req));
    return;
  }

  e.respondWith((async () => {
    try {
      return await redeDepoisCache(req);
    } catch (err) {
      // navegação offline: devolve o app shell mesmo com URL/query diferente
      if (req.mode === 'navigate' || req.destination === 'document') {
        const cache = await caches.open(CACHE);
        const hit = await cache.match('./index.html', MATCH);
        if (hit) return hit;
      }
      throw err;
    }
  })());
});
