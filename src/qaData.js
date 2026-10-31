// ACG 用 Q&A データ。
// ビルド時に scripts/build-qa-data.mjs が acgtcg.com/QA.html から生成した
// qaData.generated.js を読み込み、画像URLにキャッシュバスティングを付与する。
// fetchLatestQa() でランタイムにも最新版を取得できる（Netlify/Vite 経由のプロキシ越し）。
//
// 注意: このモジュールは ~1MB の qaData.generated.js を import するため、
// App 側からは dynamic import で QA タブ表示時にのみロードすること。

import { applyVersionToHtml } from './imageUrl.js';
import {
  qaSections as generatedSections,
  qaMeta as generatedMeta,
} from './qaData.generated.js';
import { parseQaHtml } from './qaParser.js';

function versionizeSections(secs) {
  return secs.map((sec) => ({
    ...sec,
    entries: sec.entries.map((e) => ({
      ...e,
      question: applyVersionToHtml(e.question),
      answer: applyVersionToHtml(e.answer),
    })),
  }));
}

export const qaSections = versionizeSections(generatedSections);
export const qaMeta = generatedMeta;

// /qa-proxy は vite dev サーバ / Netlify の両方で acgtcg.com/QA.html を逆プロキシする。
// CORS を回避しつつ、ランタイムで最新の QA を取得するためのエンドポイント。
const PROXY_PATH = '/qa-proxy';

// ランタイムで最新 QA を取得して再パースする。
// 失敗時は null を返す（呼び出し側でフォールバック）。
export async function fetchLatestQa({ signal } = {}) {
  try {
    const r = await fetch(PROXY_PATH, { signal, cache: 'no-cache' });
    if (!r.ok) return null;
    const html = await r.text();
    if (!html || !/関連ワード/.test(html)) return null;
    const parsed = parseQaHtml(html);
    if (!parsed.sections.length) return null;
    return {
      sections: versionizeSections(parsed.sections),
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}
