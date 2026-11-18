import { cardData, cardIdAliases } from '../cardData.generated.js';

const byId = new Map(cardData.map(card => [card.id, card]));
export const canonicalCardId = id => cardIdAliases[Number(id)] ?? Number(id);

// 再録IDを元カードに寄せる。両方が入っていた場合は枚数を合算する。
// プレビューや未知のID、枚数、サムネイル指定は失わない。
export function migrateReprintList(list) {
  if (!list || typeof list !== 'object') return list;
  const ids = Array.isArray(list) ? list.map(item => typeof item === 'object' ? item?.id : item) : Object.keys(list);
  if (!ids.some(id => canonicalCardId(id) !== Number(id))) return list;
  if (!Array.isArray(list)) {
    const result = {};
    for (const [id, count] of Object.entries(list)) {
      const target = canonicalCardId(id);
      result[target] = (result[target] || 0) + (Number(count) || 0);
    }
    return result;
  }
  const result = [];
  const counted = new Map();
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      result.push(item == null ? item : canonicalCardId(item));
      continue;
    }
    const id = canonicalCardId(item.id);
    let next = { ...item, id };
    if (id !== Number(item.id) && (item.name || item.cardNumber)) {
      next = { ...item, ...byId.get(id), id };
      if (!byId.get(id)?.effectPending) delete next.effectPending;
    }
    const previous = counted.get(id);
    if (previous && 'count' in item) {
      previous.count = (Number(previous.count) || 0) + (Number(item.count) || 0);
      if (item.isDeckThumbnail) previous.isDeckThumbnail = true;
    } else {
      result.push(next);
      if ('count' in item) counted.set(id, next);
    }
  }
  return result;
}

export function migrateReprintPairs(pairs) {
  if (!pairs?.some(([id]) => canonicalCardId(id) !== Number(id))) return pairs;
  const result = new Map();
  for (const [id, count] of pairs) {
    const target = canonicalCardId(id);
    result.set(target, (result.get(target) || 0) + (Number(count) || 0));
  }
  return [...result];
}

export function migrateReprintDeck(deck) {
  if (!deck || typeof deck !== 'object') return deck;
  let result = deck;
  for (const key of ['cards', 'deck_data', 'tokenDeck', 'token_deck', 'sideDeck', 'side_deck']) {
    const list = migrateReprintList(deck[key]);
    if (list !== deck[key]) result = { ...result, [key]: list };
  }
  for (const key of ['thumbnailCardId', 'thumbnail_card_id']) {
    if (deck[key] == null) continue;
    const id = canonicalCardId(deck[key]);
    if (id !== Number(deck[key])) result = { ...result, [key]: id };
  }
  return result;
}
