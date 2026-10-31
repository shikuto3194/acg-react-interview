// acgtcg.com トップページ index.html を解析して { news, products, fetchedAt } を返す純関数。
// Node (scripts/build-home-data.mjs) とブラウザ (homeData.js のランタイム取得) で共有する。

const SITE_BASE = 'https://acgtcg.com/';

const ENT = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
};
function decodeEntities(s) {
  return String(s).replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENT[m] || m);
}

// "./img/foo.png" / "./products_20.html" / "https://..." を絶対 URL に。クエリは保持。
function toAbsoluteUrl(href) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href.replace(/^\.\//, ''), SITE_BASE).toString();
}

// すべての <a> タグを正規化: href を絶対URL化、target/rel を統一して付与（重複させない）。
function rewriteRelativeLinks(html) {
  return String(html).replace(/<a\s+([^>]*?)>/gi, (full, attrs) => {
    const hrefMatch = attrs.match(/\bhref=(["'])([^"']+)\1/i);
    if (!hrefMatch) return full;
    const href = toAbsoluteUrl(hrefMatch[2]);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
  });
}

// インラインで装飾だけ取り除く（テキスト取得用）。<br>と<a>は残す。
function cleanInlineHtml(html) {
  let s = String(html);
  // <font color=red>...</font> → 強調用 class へ
  s = s.replace(/<font[^>]*(?:color\s*=\s*["']?red|style\s*=\s*["'][^"']*color\s*:\s*red)[^>]*>/gi,
    '<span class="home-news-important">');
  s = s.replace(/<font[^>]*>/gi, '');
  s = s.replace(/<\/font>/gi, '</span>');
  // 他のフォント/装飾タグは除去
  s = s.replace(/<\/?(?:b|i|em|strong|small)(?=[\s>/])[^>]*>/gi, '');
  // 連続<br>を抑制
  s = s.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  // 先頭・末尾の<br>除去
  s = s.replace(/^(?:\s|<br\s*\/?>)+/i, '').replace(/(?:\s|<br\s*\/?>)+$/i, '');
  return s.trim();
}

// 日付文字列 "2026年5月18日" → "YYYY-MM-DD"
function normalizeDate(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}

// <p>...</p>1件分から ニュースエントリを取り出す
function buildNewsEntry(pInner, idx) {
  // 日付（先頭 or <br> 直後）
  const dateMatch = pInner.match(/更新日[：:]\s*(\d{4}年\s*\d{1,2}月\s*\d{1,2}日)/);
  const date = dateMatch ? normalizeDate(dateMatch[1]) : '';
  // 日付部分を除いた残り
  let body = pInner.replace(/(?:<br\s*\/?>)?\s*更新日[：:]\s*\d{4}年\s*\d{1,2}月\s*\d{1,2}日\s*(?:<br\s*\/?>)?/i, '');
  body = rewriteRelativeLinks(body);
  const important = /<font[^>]*(?:red|color\s*:\s*red)/i.test(pInner);
  const html = cleanInlineHtml(body);
  // links 一覧
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lm;
  while ((lm = re.exec(html)) !== null) {
    links.push({ href: lm[1], label: lm[2].replace(/<[^>]+>/g, '').trim() });
  }
  if (!html && links.length === 0) return null;
  return {
    id: `news-${idx}`,
    date,
    html,
    links,
    important,
  };
}

// お知らせ <h2>お知らせ</h2><div class="scroll_box">…</div>
function parseNews(html) {
  const m = html.match(/<h2>\s*お知らせ\s*<\/h2>\s*<div[^>]*class=["'][^"']*scroll_box[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return [];
  const body = m[1];
  const out = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  let idx = 0;
  while ((pm = pRe.exec(body)) !== null) {
    idx += 1;
    const entry = buildNewsEntry(pm[1], idx);
    if (entry) out.push(entry);
  }
  return out;
}

// 公式サイト側で <a> リンクが無く、本文が長文な告知ブロック向けの固定見出し。
// 画像ファイル名 (basename) でマッチさせる。新規追加時はここに編集者が1行足す運用。
const IMAGE_TITLE_OVERRIDES = {
  'index_mainimg2.png': 'クラウドファンディング返礼品の配送について',
};

function imageBasename(url) {
  if (!url) return '';
  return url.split('/').pop().split('?')[0];
}

// <p> 内側の HTML から「先頭の1セグメント」だけを抽出（<br> 区切り）。
function extractFirstLine(pInner) {
  const first = String(pInner).split(/<br\s*\/?>/i)[0];
  return decodeEntities(first.replace(/<[^>]+>/g, '').trim());
}

// <p> 内側を <br> で分割し、空行を除いて先頭から連結したサマリを返す。
//   - 文字数が minChars 以上に達するまで、または
//   - 連結セグメント数が maxSegments に達するまで
// のいずれか早い方で停止する。挨拶だけの短い1行で終わらないようにするため。
function extractAutoSummary(pInner, minChars = 25, maxSegments = 3) {
  const segments = String(pInner)
    .split(/<br\s*\/?>/i)
    .map((s) => decodeEntities(s.replace(/<[^>]+>/g, '').trim()))
    .filter((s) => s.length > 0);
  if (segments.length === 0) return '';
  let out = segments[0];
  for (let i = 1; i < segments.length && i < maxSegments && out.length < minChars; i++) {
    out += ' ' + segments[i];
  }
  return out;
}

// <div class="flex_index"> 配下の各 <div> 子要素から { title, image, href } を取り出す。
// 新弾・新製品（index.html）と公式・公認イベント一覧（index_event.html）で共有する。
function parseFlexIndexItems(body, idPrefix) {
  const out = [];
  const reItem = /<div>([\s\S]*?)<\/div>/g;
  let im;
  let idx = 0;
  while ((im = reItem.exec(body)) !== null) {
    const inner = im[1];
    if (!/<img/i.test(inner)) continue; // 画像が無いものはスキップ
    idx += 1;
    // title
    const titleMatch = inner.match(/<p[^>]*class=["'][^"']*index_news_cell[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const title = titleMatch
      ? decodeEntities(titleMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim())
      : '';
    // image
    const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
    const image = imgMatch ? toAbsoluteUrl(imgMatch[1]) : '';
    // link (btn_event)
    const linkMatch = inner.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*btn_event[^"']*["'][^>]*>/i)
      || inner.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
    const href = linkMatch ? toAbsoluteUrl(linkMatch[1]) : '';
    // 補足テキスト（メインビジュアル系で title 無し / 説明文だけのケース）。
    //   - firstLine: 先頭1行（override 併用時の見出し前置きに使う）
    //   - autoSummary: 先頭〜30字までの自動連結（override 無しのフォールバック表示用）
    let firstLine = '';
    let autoSummary = '';
    if (!title) {
      const pMatch = inner.match(/<p(?![^>]*class)[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) {
        firstLine = extractFirstLine(pMatch[1]);
        autoSummary = extractAutoSummary(pMatch[1]);
      }
    }
    if (!image && !title && !autoSummary) continue;
    // タイトル決定:
    //   1. index_news_cell の title があればそれを使用
    //   2. 画像名に基づく固定見出し override があれば「先頭1行 + 見出し」（または見出し単独）
    //   3. autoSummary（先頭〜30字までの自動連結）
    //   4. フォールバック
    const overrideHeading = IMAGE_TITLE_OVERRIDES[imageBasename(image)] || '';
    let finalTitle;
    if (title) {
      finalTitle = title;
    } else if (overrideHeading) {
      finalTitle = firstLine ? `${firstLine}\n${overrideHeading}` : overrideHeading;
    } else {
      finalTitle = autoSummary || '詳細';
    }
    out.push({
      id: `${idPrefix}-${idx}`,
      title: finalTitle,
      image,
      href,
      hasButton: !!linkMatch && /btn_event/i.test(linkMatch[0] || ''),
    });
  }
  return out;
}

// 新着情報 <h2>新着情報</h2><div class="flex_index">…</div>
function parseProducts(html) {
  const m = html.match(/<h2>\s*新着情報\s*<\/h2>\s*<div[^>]*class=["'][^"']*flex_index[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/i)
    || html.match(/<h2>\s*新着情報\s*<\/h2>\s*<div[^>]*class=["'][^"']*flex_index[^"']*["'][^>]*>([\s\S]*)$/i);
  if (!m) return [];
  return parseFlexIndexItems(m[1], 'prod');
}

// 公式・公認イベント一覧 (index_event.html): <h1>イベント一覧</h1><div class="flex_index">…</div>
function parseEvents(html) {
  const m = html.match(/<h1>\s*イベント一覧\s*<\/h1>\s*<div[^>]*class=["'][^"']*flex_index[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/i)
    || html.match(/<h1>\s*イベント一覧\s*<\/h1>\s*<div[^>]*class=["'][^"']*flex_index[^"']*["'][^>]*>([\s\S]*)$/i);
  if (!m) return [];
  return parseFlexIndexItems(m[1], 'event');
}

export function parseHomeHtml(html) {
  const fetchedAt = new Date().toISOString();
  if (typeof html !== 'string' || !html) return { news: [], products: [], fetchedAt };
  return {
    news: parseNews(html),
    products: parseProducts(html),
    fetchedAt,
  };
}

export function parseEventsHtml(html) {
  const fetchedAt = new Date().toISOString();
  if (typeof html !== 'string' || !html) return { events: [], fetchedAt };
  return {
    events: parseEvents(html),
    fetchedAt,
  };
}
