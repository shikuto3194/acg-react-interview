import assert from 'node:assert/strict';
import { test } from 'node:test';
import pako from 'pako';
import { cardData, cardIdAliases } from '../src/cardData.generated.js';
import { migrateReprintDeck } from '../src/utils/cardReprints.js';
import { migrateSavedDeck, migrateDeckSnapshot, migrateParticipantDecks, migrateIdCountPairs } from '../src/utils/deckIdMigration.js';
import { decodeBuilderDeckUrl, encodeDeckToBuilderUrl } from '../src/utils/acgDeckQr.js';

test('除外済みIDを予約したまま、保存デッキを元カードへ読み替える', () => {
  const known = { 147: 282, 152: 88, 7077: 269, 7078: 307, 7079: 329, 7080: 199, 59019: 485, 59020: 486, 59021: 487, 59022: 488 };
  for (const [from, to] of Object.entries(known)) assert.equal(cardIdAliases[from], to);
  for (const [from, to] of Object.entries(cardIdAliases)) {
    const old = { cards: [{ id: Number(from), count: 2 }], thumbnailCardId: Number(from) };
    const migrated = migrateSavedDeck(old);
    assert.deepEqual(migrated.cards, [{ id: to, count: 2 }]);
    assert.equal(migrated.thumbnailCardId, to);
    assert.equal(old.cards[0].id, Number(from));
    assert.ok(cardData.some(card => card.id === to));
    assert.equal(migrateSavedDeck(migrated), migrated);
  }
});

test('基礎・領土・予備で元版と再録が混在しても合算し、上書きで枚数を失わない', () => {
  const old = {
    cards: [{ id: 269, count: 1 }, { id: 7077, count: 2, isDeckThumbnail: true }],
    tokenDeck: { 485: 4, 59019: 6 },
    sideDeck: [{ id: 307, count: 1 }, { id: 7078, count: 2 }],
    thumbnailCardId: 7077,
  };
  const copy = JSON.stringify(old);
  const migrated = migrateSavedDeck(old);
  assert.deepEqual(migrated.cards, [{ id: 269, count: 3, isDeckThumbnail: true }]);
  assert.deepEqual(migrated.tokenDeck, { 485: 10 });
  assert.deepEqual(migrated.sideDeck, [{ id: 307, count: 3 }]);
  assert.equal(migrated.thumbnailCardId, 269);
  assert.equal(JSON.stringify(old), copy);
});

test('領土だけが再録のイベント登録も更新し、共有URLの枚数も合算する', () => {
  const part = { deck_data: [{ id: 1, count: 4 }], token_deck: [{ id: 59019, count: 10 }] };
  assert.deepEqual(migrateParticipantDecks(part).token_deck, [{ id: 485, count: 10 }]);
  assert.deepEqual(migrateDeckSnapshot([], [{ id: 59019, count: 10 }], [{ id: 7080, count: 3 }]).sideDeck, [{ id: 199, count: 3 }]);
  assert.deepEqual(migrateIdCountPairs([[7077, 2], [269, 1]], [[59019, 6], [485, 4]], [[7079, 2]]), {
    mainPairs: [[269, 3]], tokenPairs: [[485, 10]], sidePairs: [[329, 2]],
  });
});

test('旧連番の補正と再録ID補正を併用できる', () => {
  const migrated = migrateSavedDeck({
    cards: [{ id: 152, count: 2 }],
    tokenDeck: [{ id: 405, count: 10 }],
  });
  assert.deepEqual(migrated.cards, [{ id: 88, count: 2 }]);
  assert.deepEqual(migrated.tokenDeck, [{ id: 485, count: 10 }]);
});

test('完全なスナップショットでは誤記や古い画像を元カードの情報に更新する', () => {
  const deck = migrateSavedDeck({ cards: [
    { id: 7079, cardNumber: 'BP6-079', name: '間猿', image: 'images/BP6-079.png', count: 2, effectPending: true },
    { id: 329, count: 1 },
  ] });
  assert.equal(deck.cards.length, 1);
  assert.equal(deck.cards[0].name, '聞猿');
  assert.equal(deck.cards[0].cardNumber, 'BP3-005');
  assert.equal(deck.cards[0].count, 3);
  assert.equal(deck.cards[0].effectPending, undefined);
  const unchanged = { cards: [{ id: 1_000_003, count: 4 }], side_deck: { 199: 1 } };
  assert.equal(migrateReprintDeck(unchanged), unchanged);
});

test('クラウド形式のフィールド・サムネイルも読み替える', () => {
  assert.deepEqual(migrateSavedDeck({ deck_data: [{ id: 7080, count: 2 }], token_deck: { 59020: 10 }, side_deck: { 7078: 1 }, thumbnail_card_id: 7080 }), {
    deck_data: [{ id: 199, count: 2 }], token_deck: { 486: 10 }, side_deck: { 307: 1 }, thumbnail_card_id: 199,
  });
});

test('外部QRに元版と再録が混在していても読み込み・再出力できる', () => {
  const encoded = Buffer.from(pako.deflate(JSON.stringify({ m: [5525, 0, 5577, 2, 5125, 1], t: [8019, 6, 8001, 4], r: [5579, 1] }))).toString('base64url');
  const deck = decodeBuilderDeckUrl(encoded);
  assert.deepEqual(deck.mainCards, [{ id: 269, count: 3 }]);
  assert.deepEqual(deck.tokenCards, [{ id: 485, count: 10 }]);
  assert.deepEqual(deck.sideCards, [{ id: 329, count: 1 }]);
  assert.deepEqual(deck.unknownBuilderIds, []);
  const output = encodeDeckToBuilderUrl({ mainCards: [{ id: 7077, count: 2 }, { id: 269, count: 1 }] });
  assert.deepEqual(output.unknownIds, []);
  assert.deepEqual(decodeBuilderDeckUrl(output.url).mainCards, [{ id: 269, count: 3 }]);
});
