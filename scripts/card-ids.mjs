// カード ID の採番ルール。
//
// デッキ (localStorage / Supabase / 共有 URL / イベント登録) はカードを「数値 ID」で
// 保存する。以前は生成時の並び順 (index + 1) をそのまま ID にしていたため、新弾が
// 追加されるたびにその弾より後ろへ並ぶカード = 常に最後尾の領土カードの ID が弾の
// 枚数ぶん丸ごとずれ、保存済みデッキ (特に領土デッキ) の中身が別カードにすり替わって
// いた。
//
// そこで ID は kindKey (エラータ違いを正規化したカード番号) に固定で紐付ける:
//   1. card-id-map.json に載っている kindKey → その ID をそのまま再利用 (不変)
//   2. 表に無い新カード → formulaCardId() が cardNumber から決定的に算出
// 2 は「他にどのカードが存在するか」に依存しないので、card-id-map.json を書き戻せない
// CI (Netlify の prebuild) でも常に同じ ID になる。ローカル生成時は新カードが表へ
// 追記されるため、cardData.generated.js と一緒に必ずコミットすること。
//
// ID は共有 URL で 2 バイトにエンコードされるので 65535 以下に収める:
//   1-999      : 既存カード (card-id-map.json の初期値。502 まで使用済み)
//   1000-1999  : ACG-### (スターターデッキ) の追加分
//   2000-58999 : BP{k}-### → (k + 1) * 1000 + ###   (BP1 → 2001, BP4 → 5001 …)
//   59000-59999: RYO-### (領土カード)
//   60000-65535: 上記に当てはまらない番号 (PR / SEC など) のハッシュ採番
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ID_MAP_FILE = resolve(here, 'card-id-map.json');

export const ID_MAX = 65535;
const ID_HASH_BASE = 60000;
const ID_HASH_SPAN = ID_MAX - ID_HASH_BASE + 1;

// 「種類」キー: 同一カードのエラータ違い (_T) を 1 種類に正規化
//   ACG-149_T → ACG-149 / BP1-041_T → BP1-041
export function kindKeyOf(cardNumber) {
  return String(cardNumber).replace(/_T$/, '');
}

// カード番号から ID を決定的に算出する (未知の体系なら null)
export function formulaCardId(kindKey) {
  const acg = kindKey.match(/^ACG-(\d{1,3})$/);
  if (acg) {
    const n = parseInt(acg[1], 10);
    if (n >= 1 && n <= 999) return 1000 + n;
  }
  const bp = kindKey.match(/^BP(\d{1,2})-(\d{1,3})$/);
  if (bp) {
    const k = parseInt(bp[1], 10);
    const n = parseInt(bp[2], 10);
    // (k + 1) * 1000 + n が 58999 以下に収まる範囲 (BP1〜BP57) のみ式で採番
    if (k >= 1 && k <= 57 && n >= 1 && n <= 999) return (k + 1) * 1000 + n;
  }
  const ryo = kindKey.match(/^RYO-(\d{1,3})$/);
  if (ryo) {
    const n = parseInt(ryo[1], 10);
    if (n >= 1 && n <= 999) return 59000 + n;
  }
  return null;
}

// 式に当てはまらない番号用。kindKey の FNV-1a ハッシュを 60000-65535 に落とし込む。
// 衝突時のみ +1 ずつずらす (該当カードはほぼ無いので実際に衝突することはまず無い)。
export function hashCardId(kindKey, taken = new Set()) {
  let h = 0x811c9dc5;
  for (let i = 0; i < kindKey.length; i++) {
    h ^= kindKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  for (let probe = 0; probe < ID_HASH_SPAN; probe++) {
    const id = ID_HASH_BASE + ((h + probe) % ID_HASH_SPAN);
    if (!taken.has(id)) return id;
  }
  throw new Error(`カード ID のハッシュ枠が枯渇しました: ${kindKey}`);
}

// card-id-map.json を読む。読めない場合は既存デッキの ID が壊れるので中断する。
export async function loadIdMap(file = ID_MAP_FILE) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`${file} を読めません。既存デッキの ID が壊れるため中断します: ${e.message}`);
  }
  const parsed = JSON.parse(raw);
  const ids = parsed && typeof parsed === 'object' && parsed.ids ? parsed.ids : parsed;
  const map = new Map();
  for (const [kindKey, id] of Object.entries(ids)) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0 || n > ID_MAX) {
      throw new Error(`card-id-map.json の ID が不正です: ${kindKey} → ${id}`);
    }
    map.set(kindKey, n);
  }
  return { map, comment: parsed?._comment };
}

// 収録が消えたカード (エラータ・削除) のエントリも残したまま新規ぶんを追記する。
// ID を再利用すると古いデッキが別カードを指すため、一度使った ID は永久に予約する。
export async function saveIdMap(map, comment, file = ID_MAP_FILE) {
  const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
  const json = { _comment: comment, ids: Object.fromEntries(sorted) };
  await writeFile(file, JSON.stringify(json, null, 2) + '\n');
  return sorted.length;
}

// kindKey 一覧に ID を割り当てる (既存は据え置き、新規のみ採番)
export function assignCardIds(kindKeys, idMap) {
  const taken = new Set(idMap.values());
  const assigned = new Map();
  const added = [];
  const usedThisRun = new Map(); // id → kindKey (重複検出用)

  for (const kindKey of kindKeys) {
    let id = idMap.get(kindKey);
    if (id === undefined) {
      id = formulaCardId(kindKey);
      // 式の枠が既に埋まっている (番号体系の想定外) 場合はハッシュ枠へ退避
      if (id === null || taken.has(id)) id = hashCardId(kindKey, taken);
      taken.add(id);
      added.push([kindKey, id]);
    }
    const dup = usedThisRun.get(id);
    if (dup) throw new Error(`カード ID が重複しました: ${dup} と ${kindKey} が id=${id}`);
    usedThisRun.set(id, kindKey);
    assigned.set(kindKey, id);
  }
  return { assigned, added };
}
