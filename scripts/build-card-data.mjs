// acgtcg.com の cardlist_*.html を取得・解析して src/cardData.generated.js を生成する。
//
// 既存スキーマ (Battle Spirits 系) に寄せつつ ACG 固有のフィールド (ruby/atk/def/kindKey) を追加する。
// テキスト情報がサイトに無い画像 (_T エラータ) はプレースホルダーで補完する。
// BP*-PR* / BP*-SEC* / PR / GP2025 / JUDGE / TokenDS のプロモは
// メインセットのカードのイラスト違い (同名重複) なのでデータからは除外する。
// プレミアムパック (PM*) はカードではないので対象外。
//
// 使い方:
//   node scripts/build-card-data.mjs [--offline]
//     --offline : tmp_acg_html/ に保存済みの HTML を使う (デバッグ用)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXTRA_IMAGE_PAGES, FALLBACK_PRODUCT_PAGES, comparePackPrefix,
  discoverSources, packPrefixFromPage, productPackName,
} from './acg-cardlists.mjs';
import { cardImageRefs, cardReprints, isPlayableCardImage, isReprint, mergeCardSources, trialCardDetails } from './acg-card-images.mjs';
import { ID_MAP_FILE, assignCardIds, kindKeyOf, loadIdMap, saveIdMap } from './card-ids.mjs';
import { createPageReader } from './acg-fetch.mjs';
import { assertSafeCardUpdate, resolveReprint, selectCardImages } from './acg-import-validation.mjs';
import { cardData as previousCards, cardNumberAliases as previousReprints } from '../src/cardData.generated.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const outFile = resolve(projectRoot, 'src', 'cardData.generated.js');
const cacheDir = resolve(projectRoot, 'tmp_acg_html');

const OFFLINE = process.argv.includes('--offline');
// 商品ページの画像が先行公開されたカードの確認済み基本情報。
// 公式の詳細テキストがあるカードには適用しない。
const { cards: boosterCardDetails } = JSON.parse(
  await readFile(resolve(here, 'card-image-details.json'), 'utf8'),
);
const imageCardDetails = { ...boosterCardDetails, ...trialCardDetails };
const packByKind = new Map();

// 弾ページ一覧・弾名・並び順は公式ナビ (_cardlist.html) から自動発見する。
// (新弾 BP5/BP6… はナビに載った時点で自動反映。下記は main() で discoverSources が埋める)
let PACK_NAMES = {};        // { PREFIX: 表示名 }
let PACK_ORDER = [];        // 表示名の配列 (SD→BP→RYO)

// cardNumber を見て収録弾名を返す (PACK_NAMES は発見結果で動的に埋まる)
function packFromCardNumber(num) {
  const sourcePack = packByKind.get(kindKeyOf(num));
  if (sourcePack) return PACK_NAMES[sourcePack] || sourcePack;
  const acgMatch = num.match(/^ACG-(\d+)(?:_T)?$/);
  if (acgMatch) {
    // ACG-### はスターターデッキ。番号レンジで SD1/SD2 を判定 (確定済みの史実値)。
    const n = parseInt(acgMatch[1], 10);
    if (n >= 91 && n <= 164) return PACK_NAMES.SD2 || 'SD2';
    return PACK_NAMES.SD1 || 'SD1';
  }
  const bp = num.match(/^(BP\d+)-/);
  if (bp) {
    const prefix = bp[1].toUpperCase();
    return PACK_NAMES[prefix] || prefix;
  }
  if (/^RYO-/.test(num)) return PACK_NAMES.RYO || '領土カード';
  return '';
}

// 「種類」キー (kindKey) と ID の採番は ./card-ids.mjs を参照。
// ID はカード番号に固定で紐付くため、新弾が増えても既存カードの ID は変わらない。

// rarity を cardNumber から推定 (HTML に明示が無いため)
function rarityFromCardNumber(num) {
  if (/_T$/.test(num)) return 'エラータ';
  if (/^BP\d+-PR\d+$/.test(num)) return 'PR';
  if (/^BP\d+-SEC\d+$/.test(num)) return 'SEC';
  if (/^RYO-/.test(num)) return '領土';
  return '';
}

// HTML 内の <br> を改行、<font ...> や <b>/<span> 等のインラインタグを除去してプレーンテキスト化
function htmlToPlain(html) {
  let s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:font|b|i|span|em|strong|small)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 連続改行を 1 つに圧縮
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

// 「条件：水水無無」「条件：山／夜」を解析
function parseCondition(raw) {
  if (!raw) return { color: [], reduction: [], conditionRaw: '' };
  const conditionRaw = raw.trim();
  // 「／」で分岐がある場合: 山／夜 → 両方を color に
  const branches = conditionRaw.split(/[／/]/).map(s => s.trim()).filter(Boolean);
  const colorSet = new Set();
  const reduction = [];
  for (const br of branches) {
    for (const ch of br) {
      if (!ch.trim()) continue;
      reduction.push(ch);
      // 「無」は属性ではなく汎用コスト
      if (ch !== '無') colorSet.add(ch);
    }
  }
  return {
    color: [...colorSet],
    reduction,
    conditionRaw,
  };
}

// 単一の `<div class="cardlist_flex">…</div>` ブロックを解析
function parseCardBlock(blockHtml) {
  // ruby
  const rubyMatch = blockHtml.match(/<font\b[^>]*class=["'][^"']*\bcardlist_ruby\b[^"']*["'][^>]*>([^<]*)<\/font>/i);
  const ruby = rubyMatch ? rubyMatch[1].trim() : '';
  // name + cardNumber
  const nameMatch = blockHtml.match(/<font\b[^>]*class=["'][^"']*\bcardlist_name\b[^"']*["'][^>]*>([^<]*)<\/font>/i);
  if (!nameMatch) return null;
  const nameRaw = nameMatch[1].trim();
  // 「帝王クロコダイルⅡ世（ACG-001）」 → name, cardNumber
  const nm = nameRaw.match(/^(.*?)[（(]([^）)]+)[）)]\s*$/);
  if (!nm) return null;
  const name = nm[1].trim();
  const cardNumber = nm[2].trim().toUpperCase();

  // メタ行: コスト/条件/タイプ/種属/(ATK/DEF)
  // 角括弧で囲まれた key:value のセットを順に抜く
  const cost = pickBracket(blockHtml, 'コスト');
  const condRaw = pickBracket(blockHtml, '条件');
  const type = pickBracket(blockHtml, 'タイプ');
  const tribe = pickBracket(blockHtml, '種属');
  // ATK/DEF は <font class='cardlist_atk'>ATK 7</font>／<font class='cardlist_def'>DEF 4</font>
  const atkMatch = blockHtml.match(/<font\b[^>]*class=["'][^"']*\bcardlist_atk\b[^"']*["'][^>]*>ATK\s*(-?\d+)<\/font>/i);
  const defMatch = blockHtml.match(/<font\b[^>]*class=["'][^"']*\bcardlist_def\b[^"']*["'][^>]*>DEF\s*(-?\d+)<\/font>/i);

  // 効果テキスト: メタ行の後、<br><br> から <p> の終わりまで
  // まず <p>…</p> 内の HTML を取得
  const pMatch = blockHtml.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  let effect = '';
  if (pMatch) {
    let pHtml = pMatch[1];
    // 既知のメタ部 (ruby, name, [コスト]…[ATK/DEF]) を消す
    pHtml = pHtml.replace(/<font\b[^>]*class=["'][^"']*\bcardlist_(?:ruby|name)\b[^"']*["'][^>]*>[^<]*<\/font>\s*(<br\s*\/?>)?/gi, '');
    // メタ行 (`[コスト...] [...] [...] [DEF .. ／ DEF ..]` と末尾の <br><br>) をまるごと削除。
    // メタ行内には <br> が現れない前提で、最初の <br>{1,2} までを消す。
    pHtml = pHtml.replace(/[[［]\s*コスト[\s\S]*?(?:<br\s*\/?>\s*){1,2}/i, '');
    effect = htmlToPlain(pHtml);
  }

  return {
    name,
    ruby,
    cardNumber,
    cost: cost === '' ? '' : parseIntOrEmpty(cost),
    ...parseCondition(condRaw),
    type: type || '',
    tribe: tribe || '',
    atk: atkMatch ? Number(atkMatch[1]) : undefined,
    def: defMatch ? Number(defMatch[1]) : undefined,
    effect,
  };
}

function pickBracket(html, key) {
  // 例: ［コスト：5］　［条件：水水］
  // 半角/全角 ［ ］ の対応も取る
  const re = new RegExp(`[\\[［]\\s*${key}\\s*[:：]\\s*([\\s\\S]*?)\\s*[\\]］]`);
  const m = html.match(re);
  if (!m) return '';
  // インライン HTML を除去
  return htmlToPlain(m[1]);
}

function parseIntOrEmpty(s) {
  const m = String(s).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : '';
}

// 1 ページから複数カードブロックを抜き出す
// 区切りは `</div></div><hr>` (text div の閉じ + flex div の閉じ + 区切り線)。
// カード本文内にエラータへのリンク付き `<hr>` が紛れることがあるので、それは無視する。
export function parseDetailPage(html) {
  const blocks = html.split(/<div\b[^>]*class=["'][^"']*\bcardlist_flex\b[^"']*["'][^>]*>/i).slice(1);
  const cards = [];
  for (const b of blocks) {
    const closeIdx = b.indexOf('</div></div><hr>');
    const blockHtml = closeIdx >= 0 ? b.slice(0, closeIdx) : b;
    const card = parseCardBlock(blockHtml);
    if (card) cards.push(card);
  }
  return cards;
}

// ページ内に登場する画像参照だけを集める (テキスト無し画像の補完用)
function parseImageRefs(html, page) {
  return cardImageRefs(html, page).map(ref => ref.name).filter(isPlayableCardImage);
}

function imageNameToCardNumber(name) {
  return name.replace(/\.(png|jpe?g|webp)$/i, '').toUpperCase();
}

// 補完カード (テキスト無し画像) のプレースホルダー生成
function placeholderCard(cardNumber) {
  const details = imageCardDetails[cardNumber] || imageCardDetails[kindKeyOf(cardNumber)] || {};
  return {
    name: cardNumber, // 名前不明なので番号をそのまま
    ruby: '',
    cardNumber,
    cost: '',
    color: [],
    reduction: [],
    conditionRaw: '',
    type: '',
    tribe: '',
    atk: undefined,
    def: undefined,
    effect: '',
    ...details,
    ...parseCondition(details.conditionRaw || ''),
    // 本文が未公開のカードは、詳細画面で画像参照を案内する。
    effectPending: !details.effect,
  };
}

// ACG ルール (総合ルール 502-504):
//   基礎デッキ: 同名最大 4 枚 / 動物・縄張り・道具・場面・特技 のみ
//   領土デッキ: 10 枚ちょうど / 領土カードのみ / 同名最大 4 枚
//   ただし種属が「基礎」の領土カードは枚数無制限
// UI 側は領土カードを既存の「トークンスロット (maxTokenDeckCount)」枠に流し込む。
const UNLIMITED = 99;

// 禁止カードリスト (https://acgtcg.com/pdf/ACG_Banned.pdf, ver.1.0 適用: 2026-05-11)
// kindKey ベースで判定 (エラータ違い `_T` も同じ kindKey になる)。
// 禁止カードは基礎デッキ・領土デッキ・予備デッキに入れられない。
const BANNED_KIND_KEYS = new Set([
  'BP2-034', // 水面の故郷
]);

function pickDeckLimits(card, kindKey) {
  const type = card.type || '';
  const tribe = card.tribe || '';
  if (BANNED_KIND_KEYS.has(kindKey)) {
    return { maxDeckCount: 0, maxTokenDeckCount: 0 };
  }
  if (type === '領土') {
    return {
      maxDeckCount: 0, // 基礎デッキには入れられない
      maxTokenDeckCount: tribe === '基礎' ? UNLIMITED : 4,
    };
  }
  return {
    // BP6-011「巡行する蠍」の画像に記載されたルールによる例外。
    maxDeckCount: kindKey === 'BP6-011' ? 8 : 4,
    maxTokenDeckCount: 0,
  };
}

export async function buildCardData({ offline = OFFLINE, write = true } = {}) {
  const fetchOrRead = createPageReader({ cacheDir, offline });
  packByKind.clear();
  // 0) 公式ナビから弾ページ・プロモページ・弾名・並び順を自動発見する
  const discovered = await discoverSources((path) => fetchOrRead(path), {
    log: (m) => console.log(m),
  });
  PACK_NAMES = discovered.packNames;
  PACK_ORDER = discovered.packOrder;
  const DETAIL_PAGES = discovered.packPages;
  // 画像補完専用ページ: プロモ (PR 等) + ナビ外の画像ページ (text_correction / event)
  const INDEX_PAGES = [...new Set([...discovered.indexPages, ...EXTRA_IMAGE_PAGES])];

  // 1) 詳細ページから完全データを得る
  let detailCardsByNumber = new Map();
  for (const page of DETAIL_PAGES) {
    const html = await fetchOrRead(page);
    const cards = parseDetailPage(html);
    if (!cards.length && !parseImageRefs(html, page).length) {
      throw new Error(`カードを解析できません: ${page}`);
    }
    for (const c of cards) {
      if (isReprint(c.cardNumber)) continue;
      detailCardsByNumber.set(c.cardNumber, c);
      const prefix = packPrefixFromPage(page);
      if (/^TD-/.test(c.cardNumber) || (/^ACG-/.test(c.cardNumber) && /^SD\d+$/.test(prefix))) {
        packByKind.set(kindKeyOf(c.cardNumber), prefix);
      }
    }
    console.log(`[detail] ${page}: ${cards.length} cards`);
  }

  // 2) インデックスページ + 詳細ページから全ての画像参照を集めて、補完が必要な画像を洗い出す
  const allImages = new Set();
  const imageRefs = new Map();
  const collectImages = (html, page) => {
    for (const ref of cardImageRefs(html, page)) {
      if (!isPlayableCardImage(ref.name)) continue;
      allImages.add(ref.name);
      if (!imageRefs.has(ref.name)) imageRefs.set(ref.name, ref);
    }
  };
  for (const page of [...DETAIL_PAGES, ...INDEX_PAGES]) {
    const html = await fetchOrRead(page);
    collectImages(html, page);
  }

  // カードリスト掲載前の商品画像も対象にする。詳細テキストがあればそちらを優先。
  for (const page of discovered.productPages) {
    let html;
    try {
      html = await fetchOrRead(page);
    } catch (err) {
      if (FALLBACK_PRODUCT_PAGES.includes(page)) throw err;
      console.warn(`[product] SKIP ${page}: ${err.message}`);
      continue;
    }
    collectImages(html, page);
    const names = parseImageRefs(html, page);
    const pagePrefix = packPrefixFromPage(page);
    for (const name of names) {
      allImages.add(name);
      const num = imageNameToCardNumber(name);
      const prefix = /^TD-/.test(num) ? pagePrefix : num.match(/^(BP\d+)-/)?.[1];
      if (prefix) {
        if (!PACK_NAMES[prefix]) PACK_NAMES[prefix] = productPackName(html, prefix);
        // TD-001 の番号だけでは TD1/TD2/TD3 を区別できないため掲載ページを使う。
        if (/^TD-/.test(num) && (!packByKind.has(kindKeyOf(num)) || packByKind.get(kindKeyOf(num)) === 'TD')) {
          packByKind.set(kindKeyOf(num), prefix);
        }
      }
    }
    if (names.length) console.log(`[product] ${page}: ${names.length} card image refs`);
  }
  PACK_ORDER = Object.keys(PACK_NAMES).sort(comparePackPrefix).map(prefix => PACK_NAMES[prefix]);
  console.log(`[images] total card image refs across pages: ${allImages.size}`);

  // 3) 詳細と商品画像を統合。重複・エラータ・再録を除外して1種類1枚にする。
  // 自動判定済みの対応も次のビルドへ引き継ぎ、再録が復活しないようにする。
  const reprints = new Map(Object.entries({ ...previousReprints, ...cardReprints }));
  detailCardsByNumber = mergeCardSources(detailCardsByNumber.values(), allImages, placeholderCard, {
    reprints, previousCards, requireName: true,
    onDeferred: number => console.warn(`[deferred] ${number}: 名前未確認のため再録判定まで保留`),
  });
  assertSafeCardUpdate(previousCards, [...detailCardsByNumber.values()], reprints);
  const selectedImages = selectCardImages(detailCardsByNumber.values(), imageRefs.values());

  // 4) 最終カード配列の生成
  const cardNumbersSorted = [...detailCardsByNumber.keys()].sort(compareCardNumber);

  // ID は並び順ではなく kindKey に固定で紐付ける (新弾追加で既存 ID をずらさないため)
  const { map: idMap, comment: idMapComment } = await loadIdMap();
  const { assigned: idByKindKey, added: newIds } = assignCardIds(
    cardNumbersSorted.map(kindKeyOf),
    idMap,
  );
  if (newIds.length > 0) {
    console.log(`[id] 新規採番 ${newIds.length} 件: ${newIds.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  const cards = cardNumbersSorted.map((num) => {
    const base = detailCardsByNumber.get(num);
    const kindKey = kindKeyOf(num);
    const limits = pickDeckLimits(base, kindKey);
    return {
      id: idByKindKey.get(kindKey),
      name: base.name,
      ruby: base.ruby,
      cardNumber: num,
      kindKey,
      cost: base.cost,
      color: base.color,
      reduction: base.reduction,
      conditionRaw: base.conditionRaw,
      type: base.type,
      tribe: base.tribe,
      symbol: [],
      rarity: rarityFromCardNumber(num),
      pack: packFromCardNumber(num),
      atk: base.atk,
      def: base.def,
      effect: base.effect,
      ...(base.effectPending ? { effectPending: true } : {}),
      image: `images/${selectedImages.get(num).name}`,
      maxDeckCount: limits.maxDeckCount,
      maxTokenDeckCount: limits.maxTokenDeckCount,
    };
  });

  // 5) 出力
  const cardIdAliases = {};
  const cardNumberAliases = {};
  for (const reprint of reprints.keys()) {
    const target = resolveReprint(reprint, reprints);
    const targetId = idByKindKey.get(target);
    if (targetId == null) throw new Error(`再録の対応先がありません: ${reprint} → ${target}`);
    cardNumberAliases[reprint] = target;
    if (idMap.has(reprint)) cardIdAliases[idMap.get(reprint)] = targetId;
  }
  const banner = `// Auto-generated by scripts/build-card-data.mjs. Do not edit directly.\n// Total: ${cards.length} cards (${new Set(cards.map(c => c.kindKey)).size} unique kinds)\n`;
  const body = `export const cardData = ${JSON.stringify(cards, null, 2)};\n\nexport const packOrder = ${JSON.stringify([...PACK_ORDER], null, 2)};\n\nexport const cardIdAliases = ${JSON.stringify(cardIdAliases, null, 2)};\n\nexport const cardNumberAliases = ${JSON.stringify(cardNumberAliases, null, 2)};\n`;
  if (write) {
    await writeFile(outFile, banner + body);
    console.log(`[write] ${outFile}: ${cards.length} cards, ${new Set(cards.map(c => c.kindKey)).size} kinds`);
  }

  // 6) ID 表の更新
  // 収録が消えたカード (エラータ・削除) のエントリも残す。ID を再利用してしまうと
  // 古いデッキが別カードを指すため、一度使った ID は永久に予約したままにする。
  if (write && newIds.length > 0) {
    const merged = new Map(idMap);
    for (const [kindKey, id] of newIds) merged.set(kindKey, id);
    const total = await saveIdMap(merged, idMapComment);
    console.log(`[write] ${ID_MAP_FILE}: ${total} kinds (新規 ${newIds.length} 件。忘れずにコミットすること)`);
  }
  return { cards, images: [...selectedImages.values()] };
}

// カード番号比較: pack → 番号
function compareCardNumber(a, b) {
  const ra = packIndex(a);
  const rb = packIndex(b);
  if (ra !== rb) return ra - rb;
  // 同じパック内: PR > SEC > 通常番号 のフォールバック比較
  return naturalCompare(a, b);
}

function packIndex(num) {
  const p = packFromCardNumber(num);
  const i = PACK_ORDER.indexOf(p);
  return i < 0 ? 999 : i;
}

function naturalCompare(a, b) {
  const tokA = a.match(/\d+|\D+/g) || [];
  const tokB = b.match(/\d+|\D+/g) || [];
  const len = Math.max(tokA.length, tokB.length);
  for (let i = 0; i < len; i++) {
    const ta = tokA[i] ?? '';
    const tb = tokB[i] ?? '';
    const na = parseInt(ta, 10);
    const nb = parseInt(tb, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (ta !== tb) {
      return ta < tb ? -1 : 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCardData().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
