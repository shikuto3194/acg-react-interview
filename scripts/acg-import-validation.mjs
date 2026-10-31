import { kindKeyOf } from './card-ids.mjs';

export function resolveReprint(kind, reprints) {
  const seen = new Set();
  while (reprints.has(kind)) {
    if (seen.has(kind)) throw new Error(`再録の対応が循環しています: ${kind}`);
    seen.add(kind);
    kind = reprints.get(kind);
  }
  return kind;
}

// HTTP 200 のエラーページやナビの掲載終了も、既存データの削除として公開しない。
export function assertSafeCardUpdate(previousCards, cards, reprints) {
  const byKind = new Map(cards.map(card => [kindKeyOf(card.cardNumber), card]));
  const missing = [];
  for (const previous of previousCards) {
    const key = kindKeyOf(previous.cardNumber);
    const current = byKind.get(resolveReprint(key, reprints));
    if (!current) missing.push(key);
    else if (key === kindKeyOf(current.cardNumber)) {
      if (/_T$/.test(previous.cardNumber) && !/_T$/.test(current.cardNumber)) {
        throw new Error(`訂正版が取得できません: ${previous.cardNumber}`);
      }
      if ((!previous.effectPending && current.effectPending)
        || (previous.effect?.trim() && !current.effect?.trim())) {
        throw new Error(`詳細テキストが取得できません: ${key}`);
      }
    }
  }
  if (missing.length) throw new Error(`既存カードが ${missing.length} 件欠落しています: ${missing.join(', ')}`);
}

// 表示するカードと実際に取得する画像を同じ集合にする。拡張子を決め打ちしない。
export function selectCardImages(cards, refs) {
  const byNumber = new Map();
  const rank = name => /\.png$/i.test(name) ? 0 : /\.jpe?g$/i.test(name) ? 1 : 2;
  for (const ref of [...refs].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))) {
    const number = ref.name.replace(/\.[^.]+$/, '').toUpperCase();
    if (!byNumber.has(number)) byNumber.set(number, ref);
  }
  const selected = new Map();
  for (const card of cards) {
    const ref = byNumber.get(card.cardNumber.toUpperCase());
    if (!ref) throw new Error(`カード画像が取得対象にありません: ${card.cardNumber}`);
    selected.set(card.cardNumber, ref);
  }
  return selected;
}
