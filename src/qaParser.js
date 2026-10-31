// acgtcg.com の QA.html を解析して { sections, entries, fetchedAt } を返す純関数。
// Node (scripts/build-qa-data.mjs) とブラウザ (qaData.js のランタイム更新) で共有する。
// DOM API には依存せず、正規表現のみで処理する。

const ENT = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeEntities(s) {
  return s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENT[m] || m);
}

// インラインタグを除いてプレーンテキスト化（タグ抽出用）
// 注意: ACG のカードテキストには <山岳域> <夜域> <森林域> <ムーブ> など、
// 山括弧で囲んだゲーム用語が登場する。これらは HTML タグではないため、
// 素朴な /<[^>]+>/ で消すと「あなたの<山岳域>が」→「あなたのが」のように
// 情報が欠落する。HTML5 パーサと同様に「タグ名が ASCII 英字・"/"・"!" で
// 始まるもの」だけを実タグとみなして除去し、ゲーム用語は温存する。
function stripInline(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(?:font|b|i|span|em|strong|small)[^>]*>/gi, '')
      .replace(/<[/!]?[a-zA-Z][^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// answer 表示用：<br>を残し、他のインラインタグだけ除く。
function cleanAnswerHtml(html) {
  let s = String(html)
    // updated マーカーの font タグは entry の updated フラグで管理するのでここでは除去
    .replace(/<font[^>]*>/gi, '')
    .replace(/<\/font>/gi, '')
    // 残った装飾タグは除去（`<br>` を誤って消さないように lookahead で境界を確認）
    .replace(/<\/?(?:b|i|em|strong|small)(?=[\s>/])[^>]*>/gi, '')
    // 連続改行を抑制
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .trim();
  // 末尾の <br> を除去
  s = s.replace(/(?:<br\s*\/?>\s*)+$/i, '');
  return s;
}

// 日付文字列 (例: "2026年4月9日") → "YYYY-MM-DD"
function normalizeDate(raw) {
  if (!raw) return '';
  const m = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return raw.trim();
  const y = m[1];
  const mo = String(m[2]).padStart(2, '0');
  const d = String(m[3]).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// セクション見出しから種別と表示名を分ける
//   "遊び方Q&A（適者生存）" → { kind: 'play', name: '適者生存' }
//   "フロアルール Q&A"     → { kind: 'floor', name: 'フロアルール' }
//   "開発中Q&A（X）"        → { kind: 'dev', name: 'X' }
function classifyHeader(headerRaw) {
  const header = stripInline(headerRaw);
  if (/^遊び方Q&A/.test(header)) {
    const m = header.match(/（([^）]+)）/);
    return { kind: 'play', name: m ? m[1] : '遊び方' };
  }
  if (/フロアルール/.test(header)) return { kind: 'floor', name: 'フロアルール' };
  if (/開発中/.test(header)) {
    const m = header.match(/（([^）]+)）/);
    return { kind: 'dev', name: m ? m[1] : '開発中' };
  }
  return { kind: 'other', name: header };
}

// 同一弾内で連番。slug は弾名から生成。
function makeSlug(name) {
  return String(name)
    .replace(/[（）\s]/g, '')
    .replace(/[^\w　-鿿豈-﫿ぁ-ヿ]/g, '')
    || 'qa';
}

// 「赤字（更新）」マーカーを文字列上の区間として返す。
// acgtcg.com では <font color="red"> / <font style="color:red"> の両方が使われる。
function findRedRanges(body) {
  const ranges = [];
  const reOpen = /<font[^>]*(?:color\s*=\s*["']?red|style\s*=\s*["'][^"']*color\s*:\s*red)[^>]*>/gi;
  let m;
  while ((m = reOpen.exec(body)) !== null) {
    const start = m.index;
    const closeRe = /<\/font>/gi;
    closeRe.lastIndex = reOpen.lastIndex;
    const c = closeRe.exec(body);
    const end = c ? c.index + c[0].length : body.length;
    ranges.push([start, end]);
  }
  return ranges;
}

// セクション本文から個別 Q&A エントリを抜き出す
//   フォーマットA: <br><hr><br><b>関連ワード：「X」「Y」</b><br>Q）...<br>A）...<br>
//   フォーマットB: <br>Q）...<br>A）...<br>（フロアルール / 開発中）
function parseEntries(sectionBody, sectionSlug) {
  const entries = [];
  const redRanges = findRedRanges(sectionBody);

  // 答えの終端 lookahead。次エントリの直前に <font.../> や <br> が挟まっていてもまたぐようにする。
  const GAP = '(?:\\s|<font[^>]*>|<\\/font>|<br\\s*\\/?>)*';
  const reA = new RegExp(
    `<b>\\s*関連ワード[：:]\\s*([\\s\\S]*?)<\\/b>\\s*<br>\\s*(?:<font[^>]*>)?\\s*Q[）)]([\\s\\S]*?)<br>\\s*A[）)]([\\s\\S]*?)(?=<br>${GAP}(?:<hr|<b>\\s*関連ワード)|<\\/div>|$)`,
    'gi'
  );

  let m;
  let counter = 0;
  while ((m = reA.exec(sectionBody)) !== null) {
    const tagsRaw = m[1] || '';
    const qHtml = m[2];
    const aHtml = m[3];
    const tags = [...stripInline(tagsRaw).matchAll(/「([^」]+)」/g)].map((x) => x[1]);
    const matchEnd = m.index + m[0].length;
    const overlapsRed = redRanges.some(([a, b]) => a < matchEnd && b > m.index);
    counter += 1;
    entries.push({
      id: `${sectionSlug}-${String(counter).padStart(3, '0')}`,
      tags,
      question: stripInline(qHtml),
      answer: cleanAnswerHtml(aHtml),
      updated: overlapsRed,
    });
  }

  if (entries.length > 0) return entries;

  // フォーマットB: 関連ワードが無い素朴な <br>Q）/<br>A）形式
  const reB = /<br>\s*Q[）)]([\s\S]*?)<br>\s*A[）)]([\s\S]*?)(?=<br>\s*Q[）)]|<\/div>|$)/gi;
  while ((m = reB.exec(sectionBody)) !== null) {
    const matchEnd = m.index + m[0].length;
    const overlapsRed = redRanges.some(([a, b]) => a < matchEnd && b > m.index);
    counter += 1;
    entries.push({
      id: `${sectionSlug}-${String(counter).padStart(3, '0')}`,
      tags: [],
      question: stripInline(m[1]),
      answer: cleanAnswerHtml(m[2]),
      updated: overlapsRed,
    });
  }
  return entries;
}

// QA.html 全体を解析。
export function parseQaHtml(html) {
  if (typeof html !== 'string' || !html) {
    return { sections: [], fetchedAt: new Date().toISOString() };
  }
  // <h2>...Q&A...</h2> ごとに分割
  const sections = [];
  const sectionRe = /<h2>([\s\S]*?Q&A[\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|<\/body|$)/gi;
  let m;
  while ((m = sectionRe.exec(html)) !== null) {
    const header = m[1];
    const body = m[2];
    const { kind, name } = classifyHeader(header);
    // 最初の <p> から 公開日 / 更新日 を取得
    const pMatch = body.match(/<p>([\s\S]*?)<\/p>/);
    const pText = pMatch ? stripInline(pMatch[1]) : '';
    const publishedRaw = (pText.match(/公開日[：:]\s*([^　\s（(]+)/) || [])[1] || '';
    const updatedRaw = (pText.match(/更新日[：:]\s*([^（(]+)/) || [])[1] || '';
    const slug = `${kind}-${makeSlug(name)}`;
    const entries = parseEntries(body, slug);
    if (entries.length === 0) continue;
    sections.push({
      id: slug,
      kind,
      name,
      title: kind === 'play' ? `遊び方Q&A（${name}）` : (kind === 'floor' ? 'フロアルールQ&A' : `開発中Q&A（${name}）`),
      publishedAt: normalizeDate(publishedRaw),
      updatedAt: normalizeDate(updatedRaw),
      entries,
    });
  }
  return { sections, fetchedAt: new Date().toISOString() };
}

// フラットなエントリ配列に変換（既存 App.jsx の qaData 互換）
//   { id, question, answer, tags, updatedAt, section, sectionKind, updated }
export function flattenQa(parsed) {
  const out = [];
  for (const sec of parsed.sections || []) {
    for (const e of sec.entries || []) {
      out.push({
        id: e.id,
        question: e.question,
        answer: e.answer,
        tags: e.tags,
        updatedAt: sec.updatedAt || sec.publishedAt || '',
        section: sec.name,
        sectionKind: sec.kind,
        sectionId: sec.id,
        updated: !!e.updated,
      });
    }
  }
  return out;
}
