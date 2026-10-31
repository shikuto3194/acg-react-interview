// ホーム画面用データ。ビルド時に scripts/build-home-data.mjs が生成した
// homeData.generated.js を初期値として読み込み、ランタイムで /home-proxy 経由に
// 最新版（acgtcg.com/index.html）を取りに行く。

import {
  homeNews as generatedNews,
  homeProducts as generatedProducts,
  homeEvents as generatedEvents,
  homeMeta as generatedMeta,
} from './homeData.generated.js';
import { parseHomeHtml, parseEventsHtml } from './homeParser.js';

export const homeNews = generatedNews;
export const homeProducts = generatedProducts;
export const homeEvents = generatedEvents || [];
export const homeMeta = generatedMeta;

const HOME_PROXY_PATH = '/home-proxy';
const EVENT_PROXY_PATH = '/event-proxy';

const TTL_MS = 5 * 60 * 1000;

function makeFetcher({ path, parse, isValidHtml, isValidParsed }) {
  let inflight = null;
  let cached = null;
  let cachedAt = 0;
  return async function fetchLatest() {
    const now = Date.now();
    if (cached && now - cachedAt < TTL_MS) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch(path, { cache: 'no-cache' });
        if (!r.ok) return null;
        const html = await r.text();
        if (!html || !isValidHtml(html)) return null;
        const parsed = parse(html);
        if (!isValidParsed(parsed)) return null;
        return parsed;
      } catch {
        return null;
      }
    })();
    const result = await inflight;
    inflight = null;
    if (result) {
      cached = result;
      cachedAt = Date.now();
    }
    return result;
  };
}

export const fetchLatestHome = makeFetcher({
  path: HOME_PROXY_PATH,
  parse: parseHomeHtml,
  isValidHtml: (html) => /お知らせ/.test(html),
  isValidParsed: (p) => p.news.length > 0 || p.products.length > 0,
});

export const fetchLatestEvents = makeFetcher({
  path: EVENT_PROXY_PATH,
  parse: parseEventsHtml,
  isValidHtml: (html) => /イベント一覧/.test(html),
  isValidParsed: (p) => p.events.length > 0,
});
