// src/utils/deckIdMigration.js の動作確認 (node scripts/test-deck-id-migration.mjs)
//
// 「新弾追加で領土カードの ID がずれた保存デッキ」を再現し、
//   - 壊れたデッキが正しく復元されること
//   - 現行世代の正しいデッキには一切手を加えないこと
// を確認する。

import { cardData } from '../src/cardData.generated.js';
import {
  detectLegacyBase,
  migrateDeckSnapshot,
  migrateIdCountPairs,
  migrateSavedDeck,
} from '../src/utils/deckIdMigration.js';

const byNumber = new Map(cardData.map(c => [c.cardNumber, c]));
const ryo = (n) => byNumber.get(`RYO-${String(n).padStart(3, '0')}`).id;
const acg = (n) => byNumber.get(`ACG-${String(n).padStart(3, '0')}`).id;

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  NG   ${label}\n       期待: ${e}\n       実際: ${a}`);
  }
}

// BP3 までしか無かった時代 (領土 ID の起点 = 404) に保存されたデッキ。
// RYO-001 は id=405、RYO-005 は id=409 だった。
const BP3_BASE = 404;
const legacyDeck = {
  name: 'BP3 時代の領土デッキ',
  cards: [{ id: acg(1), count: 4 }, { id: acg(100), count: 3 }],
  tokenDeck: [
    { id: BP3_BASE + 1, count: 4 },
    { id: BP3_BASE + 5, count: 3 },
    { id: BP3_BASE + 18, count: 3 },
  ],
  sideDeck: [{ id: acg(50), count: 2 }, { id: BP3_BASE + 2, count: 1 }],
  thumbnailCardId: BP3_BASE + 1,
};

console.log('[1] 旧世代 (BP3 時代) のデッキを復元する');
check('世代判定', detectLegacyBase(legacyDeck.tokenDeck), BP3_BASE);
const fixed = migrateSavedDeck(legacyDeck);
check('領土デッキ', fixed.tokenDeck, [
  { id: ryo(1), count: 4 },
  { id: ryo(5), count: 3 },
  { id: ryo(18), count: 3 },
]);
check('基礎デッキは不変', fixed.cards, legacyDeck.cards);
check('予備デッキの領土カードも補正', fixed.sideDeck, [{ id: acg(50), count: 2 }, { id: ryo(2), count: 1 }]);
check('サムネイル', fixed.thumbnailCardId, ryo(1));

console.log('[2] 現行世代の正しいデッキには触らない');
const currentDeck = {
  name: '現行デッキ',
  cards: [{ id: acg(1), count: 4 }],
  tokenDeck: { [ryo(1)]: 4, [ryo(2)]: 6 },
  sideDeck: [],
  thumbnailCardId: acg(1),
};
check('同一オブジェクトを返す', migrateSavedDeck(currentDeck) === currentDeck, true);

console.log('[3] 領土デッキが空 / 判定不能なら触らない');
check('空の領土デッキ', migrateSavedDeck({ name: 'x', cards: [], tokenDeck: [] }).tokenDeck, []);
check('未知の ID', detectLegacyBase([{ id: 999999, count: 1 }]), null);

console.log('[4] { id: count } 形式 (作成中デッキ・共有URL) も補正する');
const objDeck = migrateSavedDeck({
  name: 'obj',
  cards: [],
  tokenDeck: { [BP3_BASE + 1]: 5, [BP3_BASE + 3]: 5 },
});
check('オブジェクト形式', objDeck.tokenDeck, { [ryo(1)]: 5, [ryo(3)]: 5 });

console.log('[5] イベント登録スナップショット / 共有URL');
const snap = migrateDeckSnapshot(
  [{ id: acg(3), count: 4 }],
  [{ id: BP3_BASE + 7, count: 10 }],
);
check('スナップショット', snap.tokenDeck, [{ id: ryo(7), count: 10 }]);
const pairs = migrateIdCountPairs(
  [[acg(3), 4]],
  [[BP3_BASE + 7, 10]],
  [[BP3_BASE + 8, 1]],
);
check('共有URLのペア', [pairs.mainPairs, pairs.tokenPairs, pairs.sidePairs], [
  [[acg(3), 4]],
  [[ryo(7), 10]],
  [[ryo(8), 1]],
]);

console.log('[6] さらに古い世代 (BP2 時代 = 起点 324) も復元する');
check('BP2 時代', migrateSavedDeck({
  name: 'bp2',
  cards: [],
  tokenDeck: [{ id: 324 + 4, count: 10 }],
}).tokenDeck, [{ id: ryo(4), count: 10 }]);

console.log('[7] BP5 公開後・ID固定化前の一時世代 (起点 564) も復元する');
const BP5_LEGACY_BASE = 564;
const bp5Deck = migrateSavedDeck({
  name: 'BP5 旧連番デッキ',
  cards: [{ id: 545, count: 2 }], // 旧 BP5-061
  tokenDeck: [
    { id: BP5_LEGACY_BASE + 11, count: 3 },
    { id: BP5_LEGACY_BASE + 12, count: 3 },
    { id: BP5_LEGACY_BASE + 18, count: 4 },
  ],
  sideDeck: [
    { id: 545, count: 2 }, // 旧 BP5-061
    { id: 564, count: 3 }, // 旧 BP5-080
  ],
  thumbnailCardId: 545,
});
check('BP5 旧領土デッキ', bp5Deck.tokenDeck, [
  { id: ryo(11), count: 3 },
  { id: ryo(12), count: 3 },
  { id: ryo(18), count: 4 },
]);
check('BP5 旧基礎カード', bp5Deck.cards, [{ id: 6061, count: 2 }]);
check('BP5 旧予備カード', bp5Deck.sideDeck, [{ id: 6061, count: 2 }, { id: 6080, count: 3 }]);
check('BP5 旧サムネイル', bp5Deck.thumbnailCardId, 6061);

console.log('[8] 領土デッキから世代判定できなくても、埋め込みカード番号から BP5 旧IDを復元する');
const embeddedBp5Deck = migrateSavedDeck({
  name: 'BP5 埋め込みカードのみ',
  cards: [{ id: 545, cardNumber: 'BP5-061', kindKey: 'BP5-061', count: 2 }],
  sideDeck: [],
  thumbnailCardId: 545,
});
check('BP5 埋め込み基礎カード', embeddedBp5Deck.cards, [{ id: 6061, cardNumber: 'BP5-061', kindKey: 'BP5-061', count: 2 }]);
check('BP5 埋め込みサムネイル', embeddedBp5Deck.thumbnailCardId, 6061);

console.log('[9] プレビューカード (id >= 1,000,000) は動かさない');
check('プレビュー混在', migrateSavedDeck({
  name: 'preview',
  cards: [{ id: 1_000_003, count: 4 }],
  tokenDeck: [{ id: BP3_BASE + 1, count: 10 }],
}).cards, [{ id: 1_000_003, count: 4 }]);

if (failed > 0) {
  console.error(`\n${failed} 件失敗しました`);
  process.exit(1);
}
console.log('\nすべて OK');
