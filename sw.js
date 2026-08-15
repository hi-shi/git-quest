// Service Worker。アプリシェルを precache して、電波が無くても第1〜7章が遊べるようにする。
// 第8章だけは GitHub API を叩くのでネットワークが要る。

const CACHE = 'git-quest-v6';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/game.js',
  './js/store.js',
  './js/gate.js',
  './js/gate-config.js',
  './js/engine/repo.js',
  './js/engine/diff.js',
  './js/engine/parser.js',
  './js/engine/commands.js',
  './js/engine/shell.js',
  './js/engine/graph.js',
  './js/engine/paths.js',
  './js/ui/terminal.js',
  './js/ui/graphview.js',
  './js/ui/filesview.js',
  './js/ui/questview.js',
  './js/ui/cheatsheet.js',
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
      // 1つでも失敗すると全部落ちるので、個別に入れる。
      // `cache: 'reload'` が要: 素の cache.add() はブラウザの HTTP キャッシュを経由するため、
      // GitHub Pages の max-age=600 の間は「新しい版のキャッシュに古い中身を詰める」ことになり、
      // 更新したのに古いままという状態が固定される。
      .then((cache) =>
        Promise.all(
          SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
        )
      )
    // ここで skipWaiting しない。新しい版は「待機」させ、
    // ユーザーが更新ボタンを押したときに初めて切り替える。
    // 作業中に勝手にリロードされると困るため。
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

// アプリから「更新して」と言われたら、待機をやめて新しい版に切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // GitHub API は絶対にキャッシュしない（古い結果を返すと実害が出る）
  if (url.hostname === 'api.github.com') return;
  if (url.origin !== self.location.origin) return;

  // ページ本体（HTML）だけはネットワーク優先。ここがキャッシュ優先だと、
  // 新しい版を入れた直後の1回目が必ず古い画面になる。オフラインならキャッシュに落ちる。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // それ以外はキャッシュ優先、裏で更新しておく（stale-while-revalidate）
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
