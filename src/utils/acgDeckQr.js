/**
 * acg-builder (https://acg-builder.vercel.app/) との QR デッキ形式の相互変換。
 *
 * 形式:
 *   URL    : https://acg-builder.vercel.app/qr?ver=1&deckencdata=<base64url>[&name=<urlencoded>]
 *   payload: zlib(deflate level 9) → base64url、復号後は JSON
 *            { "m": [id, count, ...], "t": [id, count, ...], "r": [id, count, ...] }
 *   m=基礎(main)・t=領土(token)・r=予備(side)。各値はカードID昇順のフラット配列。
 *
 * カード ID は acg-builder 独自体系で、acg-react の cardNumber から導出:
 *   ACG-NNN  → NNN
 *   BPX-NNN  → 5000 + (X-1)*100 + NNN     (X = 1..9)
 *   RYO-NNN  → 8000 + NNN
 *
 * デッキ名は acg-builder 公式仕様には含まれないが、互換維持のため任意で &name=... を付与する。
 * acg-builder は未知クエリを無視するので相互互換は保たれる。
 */
import pako from 'pako';
import cardData from '../cardData.js';
import { cardNumberAliases } from '../cardData.generated.js';
import { canonicalCardId, migrateReprintList } from './cardReprints.js';

const QR_BASE_URL = 'https://acg-builder.vercel.app/qr';
const QR_VER = '1';

/** cardNumber 文字列 → builder ID（マッピング不可なら null）。 */
export function cardNumberToBuilderId(cardNumber) {
  if (typeof cardNumber !== 'string' || cardNumber.indexOf('-') < 0) return null;
  const [prefix, rest] = cardNumber.split('-', 2);
  const baseNum = parseInt(rest.split('_')[0], 10); // BP3-053_T 等の _T サフィックスを除く
  if (!Number.isFinite(baseNum)) return null;
  if (prefix === 'ACG') return baseNum;
  if (prefix === 'RYO') return 8000 + baseNum;
  if (prefix.startsWith('BP')) {
    const bpIdx = parseInt(prefix.slice(2), 10);
    if (!Number.isFinite(bpIdx) || bpIdx < 1) return null;
    return 5000 + (bpIdx - 1) * 100 + baseNum;
  }
  return null;
}

// builder ID → acg-react カード の lookup（モジュール初期化時に 1 回だけ構築）
const builderIdToCardMap = new Map();
for (const c of cardData) {
  const bid = cardNumberToBuilderId(c.cardNumber);
  if (bid != null && !builderIdToCardMap.has(bid)) {
    builderIdToCardMap.set(bid, c);
  }
}
// 外部QRに残っている再録番号も、元カードへ変換する。
const byKind = new Map(cardData.map(card => [card.kindKey, card]));
for (const [alias, original] of Object.entries(cardNumberAliases)) {
  const bid = cardNumberToBuilderId(alias);
  const card = byKind.get(original);
  if (bid != null && card) builderIdToCardMap.set(bid, card);
}
export { builderIdToCardMap };

/** acg-react のカード ID → builder ID。 */
export function acgIdToBuilderId(acgId) {
  const card = cardData.find(c => c.id === canonicalCardId(acgId));
  return card ? cardNumberToBuilderId(card.cardNumber) : null;
}

/** builder ID → acg-react のカード ID（未知なら null）。 */
export function builderIdToAcgId(builderId) {
  const card = builderIdToCardMap.get(Number(builderId));
  return card ? card.id : null;
}

// ─────────────────────────────────────────────────────────────
// Base64URL ヘルパ（標準 base64 のパディング除去・URL-safe 文字置換）
// ─────────────────────────────────────────────────────────────
function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─────────────────────────────────────────────────────────────
// デッキ正規化（入力が array `[{id,count}]` でも object `{id:count}` でも受ける）
// 戻り値は builder ID 昇順の [id, count, id, count, ...] フラット配列。
// 未知カード (builder ID へマップ不可) はスキップし、unknownIds で返す。
// ─────────────────────────────────────────────────────────────
function normalizeToBuilderPairs(input) {
  input = migrateReprintList(input);
  const pairs = [];
  const unknownIds = [];
  if (!input) return { pairs, unknownIds };

  const rawPairs = [];
  if (Array.isArray(input)) {
    for (const it of input) {
      if (!it) continue;
      const id = Number(it.id);
      const count = Number(it.count) || 0;
      if (Number.isFinite(id) && id > 0 && count > 0) rawPairs.push([id, count]);
    }
  } else if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      const id = Number(k);
      const count = Number(v) || 0;
      if (Number.isFinite(id) && id > 0 && count > 0) rawPairs.push([id, count]);
    }
  }

  for (const [acgId, count] of rawPairs) {
    const bid = acgIdToBuilderId(acgId);
    if (bid == null) {
      unknownIds.push(acgId);
      continue;
    }
    pairs.push([bid, count]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { pairs, unknownIds };
}

function pairsToFlat(pairs) {
  const out = [];
  for (const [id, count] of pairs) out.push(id, count);
  return out;
}

// ─────────────────────────────────────────────────────────────
// エンコード
// ─────────────────────────────────────────────────────────────

/**
 * デッキ → acg-builder QR URL。
 * @param {object} args
 * @param {Array|Object} args.mainCards   - 基礎デッキ。`[{id,count}]` または `{id:count}`
 * @param {Array|Object} [args.tokenCards] - 領土デッキ
 * @param {Array|Object} [args.sideCards]  - 予備デッキ
 * @param {string} [args.name] - デッキ名（任意。`&name=` として付与）
 * @returns {{ url: string, deckEncData: string, unknownIds: number[] }}
 */
export function encodeDeckToBuilderUrl({ mainCards, tokenCards, sideCards, name } = {}) {
  const m = normalizeToBuilderPairs(mainCards);
  const t = normalizeToBuilderPairs(tokenCards);
  const r = normalizeToBuilderPairs(sideCards);

  const payload = {
    m: pairsToFlat(m.pairs),
    t: pairsToFlat(t.pairs),
    r: pairsToFlat(r.pairs),
  };
  const json = JSON.stringify(payload);
  const compressed = pako.deflate(json, { level: 9 });
  const deckEncData = bytesToBase64Url(compressed);

  const params = new URLSearchParams();
  params.set('ver', QR_VER);
  params.set('deckencdata', deckEncData);
  if (name && String(name).trim()) params.set('name', String(name).trim());

  const url = `${QR_BASE_URL}?${params.toString()}`;
  const unknownIds = [...m.unknownIds, ...t.unknownIds, ...r.unknownIds];
  return { url, deckEncData, unknownIds };
}

// ─────────────────────────────────────────────────────────────
// デコード
// ─────────────────────────────────────────────────────────────

/**
 * 任意の入力（フル URL / クエリ文字列 / 生 deckencdata）から
 * `deckencdata` と `name` クエリを抽出する。
 */
function extractDeckEncData(input) {
  if (typeof input !== 'string') throw new Error('入力が文字列ではありません');
  const trimmed = input.trim();
  let query = '';
  if (trimmed.includes('?')) {
    query = trimmed.slice(trimmed.indexOf('?') + 1);
  } else if (trimmed.includes('=')) {
    query = trimmed;
  } else {
    // 生 deckencdata のみ
    return { deckEncData: trimmed, name: null };
  }
  const params = new URLSearchParams(query);
  const deckEncData = params.get('deckencdata');
  if (!deckEncData) throw new Error('deckencdata パラメータが見つかりません');
  return { deckEncData, name: params.get('name') };
}

/**
 * builder QR URL or deckencdata → minimal デッキ。
 * 未知 builder ID は unknownBuilderIds で返す（acg-react に無いカード）。
 *
 * @param {string} input
 * @returns {{
 *   name: string|null,
 *   mainCards: Array<{id:number,count:number}>,
 *   tokenCards: Array<{id:number,count:number}>,
 *   sideCards: Array<{id:number,count:number}>,
 *   unknownBuilderIds: number[]
 * }}
 */
export function decodeBuilderDeckUrl(input) {
  const { deckEncData, name } = extractDeckEncData(input);
  const bytes = base64UrlToBytes(deckEncData);
  const json = pako.inflate(bytes, { to: 'string' });
  const obj = JSON.parse(json);

  const unknownBuilderIds = [];
  const flatToMinimal = (flat) => {
    const counts = new Map();
    if (!Array.isArray(flat)) return [];
    for (let i = 0; i < flat.length; i += 2) {
      const bid = Number(flat[i]);
      const count = Number(flat[i + 1]) || 0;
      if (!Number.isFinite(bid) || count <= 0) continue;
      const acgId = builderIdToAcgId(bid);
      if (acgId == null) {
        unknownBuilderIds.push(bid);
        continue;
      }
      counts.set(acgId, (counts.get(acgId) || 0) + count);
    }
    return [...counts].map(([id, count]) => ({ id, count }));
  };

  return {
    name: name ? decodeURIComponent(name) : null,
    mainCards: flatToMinimal(obj.m),
    tokenCards: flatToMinimal(obj.t),
    sideCards: flatToMinimal(obj.r),
    unknownBuilderIds,
  };
}
