// 生成済み src/cardData.generated.js のカード ID が「固定表どおり・重複なし」かを検証する。
//
// デッキは数値 ID でカードを保存しているため、既存カードの ID が 1 つでもずれると
// 保存済みデッキが別カードにすり替わる。build-card-data.mjs の直後に走らせて、
// ID がずれた生成物をデプロイしてしまう事故を防ぐ。
//
// 使い方: node scripts/check-card-ids.mjs

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { ID_MAX, formulaCardId, kindKeyOf, loadIdMap } from './card-ids.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const generatedFile = resolve(here, '..', 'src', 'cardData.generated.js');

const { cardData, cardIdAliases = {} } = await import(pathToFileURL(generatedFile).href);
const { map: idMap } = await loadIdMap();

const errors = [];
const seenId = new Map();
const seenKind = new Map();

for (const card of cardData) {
  const kindKey = card.kindKey || kindKeyOf(card.cardNumber);
  const id = card.id;

  if (!Number.isInteger(id) || id <= 0 || id > ID_MAX) {
    errors.push(`${kindKey}: ID が不正 (${id})。共有 URL の 2 バイト枠に収まる 1-${ID_MAX} が必要`);
    continue;
  }

  const fixed = idMap.get(kindKey);
  if (fixed !== undefined && fixed !== id) {
    errors.push(`${kindKey}: ID が固定表と違う (表 ${fixed} → 生成 ${id})。既存デッキが壊れる`);
  }
  if (fixed === undefined) {
    // 固定表に未登録の新カード。式 or ハッシュ枠の ID でなければ採番ロジックの想定外。
    const formula = formulaCardId(kindKey);
    const ok = formula !== null ? id === formula : id >= 60000;
    if (!ok) errors.push(`${kindKey}: 新カードの ID が採番ルールと不一致 (${id})`);
  }

  const dupId = seenId.get(id);
  if (dupId) errors.push(`ID ${id} が重複: ${dupId} と ${kindKey}`);
  seenId.set(id, kindKey);

  const dupKind = seenKind.get(kindKey);
  if (dupKind) errors.push(`kindKey ${kindKey} が重複 (${dupKind.cardNumber} と ${card.cardNumber})`);
  seenKind.set(kindKey, card);
}

// 固定表にあるのに生成物から消えたカードは「デッキに残っているかもしれない」ので警告のみ
for (const [alias, target] of Object.entries(cardIdAliases)) {
  if (seenId.has(Number(alias)) || !seenId.has(target)) errors.push(`再録IDの対応が不正: ${alias} → ${target}`);
}
const missing = [...idMap.keys()].filter(k => !seenKind.has(k) && !Object.hasOwn(cardIdAliases, idMap.get(k)));
if (missing.length > 0) {
  console.warn(`[check-card-ids] 固定表にあるが生成物に無いカード ${missing.length} 件 (ID は予約継続): ${missing.join(', ')}`);
}

if (errors.length > 0) {
  console.error('[check-card-ids] 検証エラー:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`[check-card-ids] OK: ${cardData.length} cards / 固定表 ${idMap.size} kinds`);
