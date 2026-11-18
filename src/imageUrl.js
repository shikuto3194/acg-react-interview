// 画像 URL に ?v=<hash> を付与してキャッシュバスティングするヘルパー。
// マニフェストは scripts/generate-image-manifest.mjs が生成する。

import manifest from './imagesManifest.generated.js';

// "images/foo.png", "/images/foo.png", "foo.png" を全て "foo.png" に正規化
function normalize(path) {
  if (!path) return '';
  let p = String(path).replace(/^\.?\//, '').replace(/^images\//, '');
  // 先頭スラッシュ付き("/images/...")も剥がす
  p = p.replace(/^\/+/, '').replace(/^images\//, '');
  return p;
}

// 単一の画像パスにバージョンクエリを付与
export function versionedImageUrl(src) {
  if (!src) return src;
  // data:/blob:/絶対 http(s) は保持し、同梱画像は現在の配布先へ更新する
  if (/^(data:|blob:|https?:)/.test(src)) return src;
  const path = src.split(/[?#]/)[0];
  const key = normalize(path).replace(/\.(png)\.webp$/i, '.$1');
  const entry = manifest[key];
  if (!entry) return src;
  const prefix = path.startsWith('/') ? '/images/' : path.startsWith('images/') ? 'images/' : '';
  const webpKey = key.replace(/\.(png|jpe?g)$/i, '.webp');
  if (typeof entry === 'string' && webpKey !== key && typeof manifest[webpKey] === 'string') return `${prefix}${webpKey}?v=${manifest[webpKey]}`;
  return typeof entry === 'string' ? `${prefix}${key}?v=${entry}` : `${prefix}${entry.path}?v=${entry.hash}`;
}

// HTML 文字列内の <img src="/images/..."> を全て差し替える
const HTML_IMG_RE = /(\bsrc=["'])(\/?images\/[^"']+?)(["'])/g;
export function applyVersionToHtml(html) {
  if (typeof html !== 'string') return html;
  return html.replace(HTML_IMG_RE, (_, pre, src, post) => `${pre}${versionedImageUrl(src)}${post}`);
}

// カード(front/back を含む)の image フィールドを再帰的に書き換える
export function applyVersionToCard(card) {
  if (!card || typeof card !== 'object') return card;
  const out = { ...card };
  if (typeof out.image === 'string') out.image = versionedImageUrl(out.image);
  if (out.front) out.front = applyVersionToCard(out.front);
  if (out.back) out.back = applyVersionToCard(out.back);
  return out;
}
