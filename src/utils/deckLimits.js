// 基礎・領土・予備を合わせた上限。カードに記載された枚数例外も反映する。
export function getSameNameLimit(card) {
  if (card?.type === '領土') {
    return card.tribe === '基礎' ? 99 : (card.maxTokenDeckCount ?? 4);
  }
  return card?.maxDeckCount ?? 4;
}

// 基礎領土の枚数無制限は領土デッキのみ。予備は従来どおり4枚。
export function getSideDeckLimit(card) {
  return card?.type === '領土' && card.tribe === '基礎' ? 4 : getSameNameLimit(card);
}
