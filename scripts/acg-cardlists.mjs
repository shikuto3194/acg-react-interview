// 公式ナビと商品一覧からカードの掲載ページを自動発見する共有モジュール。
//
// 目的:
//   新弾 (BP5, BP6, ...) が公式ナビに載った時点で、スクリプトのハードコードを
//   足さずに自動でクロール対象・パック名・並び順へ反映されるようにする。
//
// 安全側の設計:
//   ネットワーク不通やパース失敗時は FALLBACK_CARDLISTS / KNOWN_PACK_NAMES へ
//   フォールバックし、ビルドが壊れない・既存弾が消えないようにする。
//
// ログ:
//   ビルド時に「何を発見し、弾名をどう導出したか」を細かく出力する。
//   公式 HTML の構造は実ビルド時にしか確認できないため、自動抽出した弾名には
//   "(要確認)" を付けて警告する (必要なら KNOWN_PACK_NAMES に正式名を追記する)。

export const BASE = 'https://acgtcg.com/';
export const NAV_PAGE = '_cardlist.html';
export const PRODUCT_INDEX_PAGES = ['products.html', 'index.html'];
// 一覧が一時的に取得できなくても、取り込み済みの先行公開カードを残す。
export const FALLBACK_PRODUCT_PAGES = [
  'products_22.html',
  'products_TD1.html',
  'products_TD2.html',
  'products_TD3.html',
];

// ナビには載らないが、カード画像 / エラータを含むため常に併用するページ。
export const EXTRA_IMAGE_PAGES = [
  'text_correction.html',
  'event_miniGP2026.html',
];

// ナビ発見が完全に失敗した時のフォールバック一覧 (現行挙動を維持)。
export const FALLBACK_CARDLISTS = [
  'cardlist_SD1.html',
  'cardlist_SD2.html',
  'cardlist_BP1.html',
  'cardlist_BP2.html',
  'cardlist_BP3.html',
  'cardlist_BP4.html',
  'cardlist_BP5.html',
  'cardlist_PR.html',
  'cardlist_RYO.html',
];

// パック表示名の正式名 (上書き)。
// 既存弾はナビ文言の揺れに左右されないよう従来名で固定する。
// 未知の新弾はここに無いので、ナビ文言から自動抽出する (無ければプレフィックスのみ)。
export const KNOWN_PACK_NAMES = {
  SD1: 'SD1 アニマルカードゲーム スターターデッキ',
  SD2: 'SD2 アニマルカードゲーム スターターデッキ第二弾',
  TD1: 'TD1 狼の夜',
  TD2: 'TD2 狸の宴',
  TD3: 'TD3 猫の戯',
  BP1: 'BP1 種属戦争',
  BP2: 'BP2 運命の物語',
  BP3: 'BP3 青嵐再来',
  BP4: 'BP4 適者生存',
  BP5: 'BP5 天空の忌み地',
  BP6: 'BP6 復讐のアニマ',
  RYO: '領土カード',
};

// 「弾 (パック)」とみなすページプレフィックス。これらだけがパック名・並び順を持つ。
// PR 等のプロモは画像補完専用 (index) 扱い。
const PACK_FAMILY = /^(SD\d+|TD\d*|BP\d+|RYO)$/;

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ナビ HTML から cardlist_*.html リンクを抽出する。
// 戻り値: [{ page, prefix, text }]  (page はファイル名へ正規化、prefix は大文字)
export function parseCardlistNav(html) {
  const byPage = new Map();

  const add = (href, text) => {
    let url;
    try { url = new URL(href, BASE); } catch { return; }
    if (url.origin !== new URL(BASE).origin) return;
    const match = url.pathname.match(/^\/cardlist_([a-z0-9]+)\.html$/i);
    if (!match) return;
    const prefix = match[1].toUpperCase();
    const page = url.pathname.slice(1);
    const prev = byPage.get(page);
    // テキストが取れている方を優先して保持
    if (!prev || (!prev.text && text)) byPage.set(page, { page, prefix, text });
  };

  // 1) アンカー (<a href=...>表示文言</a>) を拾い、弾名候補の文言も取る。
  //    href は相対 (cardlist_X / ./cardlist_X) でも絶対 URL でも可。
  const anchorRe =
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    let text = stripTags(m[2] || '');
    if (!text) {
      // 画像リンクの場合は alt / title から弾名を拾う
      const alt = (m[2] || '').match(/\b(?:alt|title)\s*=\s*["']([^"']+)["']/i);
      if (alt) text = alt[1].trim();
    }
    add(m[1], text);
  }

  // 2) アンカー外も含め、取りこぼした cardlist_*.html href を網羅 (ページ発見だけは確実に)。
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
  while ((m = hrefRe.exec(html)) !== null) add(m[1], '');

  return [...byPage.values()];
}

// ナビ文言から弾のサブタイトルを取り出す (例: 「5弾 ブースターパック 天空の忌み地」→「天空の忌み地」)。
// 公式 HTML を実機で見られないためヒューリスティック。抽出結果はログで要確認とする。
export function cleanPackTitle(text) {
  if (!text) return '';
  // 「…」/『…』で括られていればそれを最優先
  const q = text.match(/[「『]([^」』]+)[」』]/);
  if (q) return q[1].trim();
  return text
    .replace(/第?\s*\d+\s*弾/g, ' ')
    .replace(/ブースターパック|ブースター|スターターパック|スターターデッキ|デッキ|セット/gi, ' ')
    .replace(/好評発売中|発売中|発売予定|予約(受付中)?|NEW|新発売/gi, ' ')
    .replace(/[!！。、，,・\-―—|｜/／]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 商品一覧・トップページから同一サイトの商品ページだけを発見する。
// クエリやフラグメントは除き、外部サイトの似た URL は追わない。
export function parseProductLinks(html) {
  const pages = new Set();
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], BASE);
      if (url.origin !== new URL(BASE).origin) continue;
      if (/^\/products_[a-z0-9]+\.html$/i.test(url.pathname)) {
        pages.add(url.pathname.slice(1));
      }
    } catch { /* 不正なリンクは無視 */ }
  }
  return [...pages];
}

export function packPrefixFromPage(page) {
  return page.match(/^(?:cardlist|products)_((?:SD|TD|BP)\d*|RYO)\.html$/i)?.[1].toUpperCase() || '';
}

export function productPackName(html, prefix) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const title = cleanPackTitle(stripTags(heading));
  return KNOWN_PACK_NAMES[prefix] || (title ? `${prefix} ${title}` : prefix);
}

function packSortKey(prefix) {
  const mm = prefix.match(/^(SD|TD|BP|RYO)(\d*)$/);
  if (!mm) return [9, 0];
  const famRank = { SD: 0, TD: 1, BP: 2, RYO: 3 }[mm[1]];
  const n = mm[2] ? parseInt(mm[2], 10) : 0;
  return [famRank, n];
}

export function comparePackPrefix(a, b) {
  const ka = packSortKey(a);
  const kb = packSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || (a < b ? -1 : a > b ? 1 : 0);
}

// 公式ナビを取得・解析して、弾ページ / プロモページ / 弾名 / 並び順をまとめて返す。
//
//   fetchText: async (path) => html   公式の相対パスを受け取り HTML を返す関数
//   log:       (msg) => void          進捗ログ出力 (省略時 console.log)
//
// 戻り値:
//   allPages    : クロール対象の全 cardlist_*.html (弾 + プロモ、重複除去)
//   packPages   : 詳細テキスト付き弾ページ (SD/TD/BP/RYO)
//   productPages: 商品一覧・トップから発見した先行公開画像ページ
//   indexPages  : 画像補完専用ページ (PR 等プロモ)
//   packNames   : { PREFIX: 表示名 }
//   packOrder   : 表示名の配列 (SD→TD→BP→RYO 昇順)
//   orderedPrefixes : プレフィックスの配列 (同順)
export async function discoverSources(fetchText, { log = console.log } = {}) {
  let nav = [];
  try {
    const html = await fetchText(NAV_PAGE);
    nav = parseCardlistNav(html);
    log(`[discover] ${NAV_PAGE}: cardlist リンク ${nav.length} 件を発見`);
  } catch (err) {
    log(`[discover] WARN: ${NAV_PAGE} 取得/解析に失敗 (${err.message}) → フォールバック一覧を使用`);
  }

  const productPages = new Set(FALLBACK_PRODUCT_PAGES);
  for (const page of PRODUCT_INDEX_PAGES) {
    try {
      const html = await fetchText(page);
      for (const product of parseProductLinks(html)) productPages.add(product);
    } catch (err) {
      log(`[discover] WARN: ${page} 取得失敗 (${err.message}) → 既知の商品ページを併用`);
    }
  }
  log(`[discover] 商品ページ: ${productPages.size} 件`);

  // ナビが一部だけになった場合も既知のカードリストを読み続ける。
  const byPage = new Map();
  for (const e of nav) byPage.set(e.page, e);
  for (const page of FALLBACK_CARDLISTS) {
    if (!byPage.has(page)) {
      const prefix = (page.match(/^cardlist_([A-Za-z0-9]+)\.html$/i)?.[1] || '').toUpperCase();
      byPage.set(page, { page, prefix, text: '' });
    }
  }

  // 弾ページ / プロモページに分類
  const packPages = [];
  const indexPages = [];
  for (const e of byPage.values()) {
    if (PACK_FAMILY.test(e.prefix)) packPages.push(e);
    else indexPages.push(e.page);
  }

  // 弾名: 正式名 (上書き) → ナビ文言から抽出 → プレフィックスのみ
  const packNames = {};
  for (const e of packPages) {
    if (KNOWN_PACK_NAMES[e.prefix]) {
      packNames[e.prefix] = KNOWN_PACK_NAMES[e.prefix];
      continue;
    }
    const title = cleanPackTitle(e.text);
    if (title) {
      packNames[e.prefix] = `${e.prefix} ${title}`;
      log(`[discover] NOTE: ${e.page} 弾名を自動抽出 → "${packNames[e.prefix]}" (要確認: 正式名なら KNOWN_PACK_NAMES へ追記)`);
    } else {
      packNames[e.prefix] = e.prefix;
      log(`[discover] WARN: ${e.page} の弾名をナビから抽出できず → "${e.prefix}" で暫定表示 (ナビ文言: "${e.text || '(空)'}")`);
    }
  }
  // 既知弾がナビに出ていなくても消えないよう補完
  for (const [prefix, name] of Object.entries(KNOWN_PACK_NAMES)) {
    if (!packNames[prefix]) packNames[prefix] = name;
  }

  const orderedPrefixes = Object.keys(packNames).sort(comparePackPrefix);
  const packOrder = orderedPrefixes.map((p) => packNames[p]);
  const allPages = [...byPage.keys()];

  log(`[discover] 弾ページ: ${packPages.map((p) => p.page).join(', ') || '(なし)'}`);
  if (indexPages.length) log(`[discover] プロモ/index ページ: ${indexPages.join(', ')}`);
  log(`[discover] 並び順: ${packOrder.join(' / ')}`);

  return {
    allPages,
    packPages: packPages.map((p) => p.page),
    indexPages,
    packNames,
    packOrder,
    orderedPrefixes,
    productPages: [...productPages],
  };
}
