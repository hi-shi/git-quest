// Service Worker。アプリシェルを precache して、電波が無くても第1〜6章が遊べるようにする。
// 第7章だけは GitHub API を叩くのでネットワークが要る。

const CACHE = 'git-quest-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/game.js',
  './js/store.js',
  './js/engine/repo.js',
  './js/engine/diff.js',
  './js/engine/parser.js',
  './js/engine/commands.js',
  './js/engine/shell.js',
  './js/engine/graph.js',
  './js/ui/terminal.js',
  './js/ui/graphview.js',
  './js/ui/filesview.js',
  './js/ui/questview.js',
  './js/stages/index.js',
  './js/real/github.js',
  './js/real/realmode.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 1つでも失敗すると全部落ちるので、個別に入れる
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // GitHub API は絶対にキャッシュしない（古い結果を返すと実害が出る）
  if (url.hostname === 'api.github.com') return;
  if (url.origin !== self.location.origin) return;

  // アプリシェルはキャッシュ優先、裏で更新しておく（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
