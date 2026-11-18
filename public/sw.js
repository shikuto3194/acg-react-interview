// Service Worker: 画像キャッシュ管理
// ブラウザのHTTPキャッシュの代わりにCache APIで画像を管理し、
// 不完全な画像がキャッシュされる問題を防止する。
//
// Cache API は cache.put() 時にレスポンスボディを完全に読み込むため、
// ネットワーク切断で中途半端なデータは自動的に保存されない。

// バージョン導入時(v1→v2)に旧キャッシュを一掃するため bump。
// 以降はファイル毎に ?v=<hash> が付くので CACHE_NAME を上げる必要は無い。
const CACHE_NAME = 'orika-images-v2';
const IMAGE_PATH = '/images/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 画像リクエスト(GET)のみ処理、それ以外はブラウザのデフォルト動作
  if (request.method !== 'GET' || !url.pathname.startsWith(IMAGE_PATH)) return;

  event.respondWith(handleImageRequest(request));
});

async function handleImageRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  // 1. Cache APIから取得（完全なレスポンスのみ保存されている）
  const cached = await cache.match(request);
  if (cached) return cached;

  // 2. キャッシュに無い場合はネットワークから取得
  //    cache: 'no-store' でブラウザHTTPキャッシュをバイパスし、
  //    不完全なHTTPキャッシュの再利用を防ぐ
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      // cache.put() はレスポンスボディを最後まで読み込む。
      // ネットワーク断でボディが不完全な場合は Promise が reject されるため、
      // 不完全な画像がキャッシュに入ることはない。
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // オフライン等でネットワーク不可
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// キャッシュクリア用メッセージハンドラ
// アプリ側から navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_IMAGE_CACHE' })
// で呼び出し可能
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_IMAGE_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ cleared: true });
      })
    );
  }
});
