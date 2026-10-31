import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FALLBACK_PRODUCT_PAGES, discoverSources, parseProductLinks,
  packPrefixFromPage, productPackName,
} from './acg-cardlists.mjs';
import {
  cardImageRefs, isDownloadableCardImage, isPlayableCardImage, mergeCardSources,
  trialCardDetails, trialReprints, cardReprints, normalizedCardName,
} from './acg-card-images.mjs';
import { cardData, packOrder } from '../src/cardData.generated.js';
import { kindKeyOf } from './card-ids.mjs';

const placeholder = cardNumber => ({ cardNumber, name: cardNumber, effect: '', effectPending: true });

test('カードリストと複数の商品ページに重複していても詳細を保持して1枚だけ登録', () => {
  const detail = { cardNumber: 'TD-001', name: '群狼の巫女', effect: '公式の詳細テキスト', cost: 0 };
  const cards = mergeCardSources([detail], ['TD-001.png', 'TD-001.png', 'TD-001.webp'], placeholder);
  assert.equal(cards.size, 1);
  assert.deepEqual(cards.get('TD-001'), detail);
  const variants = mergeCardSources([
    detail,
    { ...detail, cardNumber: 'TD-001F' },
    { ...detail, cardNumber: 'TD-PR01' },
  ], [], placeholder);
  assert.deepEqual([...variants.keys()], ['TD-001']);
});

test('先行公開から詳細公開に切り替わっても同じカードを更新し、二重登録しない', () => {
  const images = ['TD-001.png'];
  const preview = mergeCardSources([], images, placeholder);
  const detail = { cardNumber: 'TD-001', name: '群狼の巫女', effect: '詳細本文' };
  const published = mergeCardSources([detail], images, placeholder);
  assert.deepEqual([...preview.keys()], [...published.keys()]);
  assert.equal(published.get('TD-001').effect, '詳細本文');
  assert.equal(published.get('TD-001').effectPending, undefined);
});

test('元画像とエラータが混在しても1種類に統合し、詳細を継承', () => {
  const detail = { cardNumber: 'BP1-041', name: '救助する森狼', effect: '詳細本文' };
  const cards = mergeCardSources([detail], ['BP1-041_T.png', 'BP1-041.png'], placeholder);
  assert.equal(cards.size, 1);
  assert.equal(cards.get('BP1-041_T').effect, '詳細本文');
  assert.equal(kindKeyOf(cards.get('BP1-041_T').cardNumber), 'BP1-041');
  const corrected = { ...detail, cardNumber: 'BP1-041_T', effect: '訂正本文' };
  const published = mergeCardSources([corrected, detail], ['BP1-041.png'], placeholder);
  assert.equal(published.size, 1);
  assert.equal(published.get('BP1-041_T').effect, '訂正本文');
});

test('TD再録がカードリストに載っても追加せず、未知の再録は名前で照合', () => {
  const cards = mergeCardSources([
    { cardNumber: 'BP1-066', name: '小さき破壊者' },
    { cardNumber: 'TD-008', name: '小さき破壊者' },
    { cardNumber: 'TD-100', name: '小さき破壊者' },
  ], ['TD-008.png', 'TD-100.png'], placeholder);
  assert.deepEqual([...cards.keys()], ['BP1-066']);
});

test('商品一覧とトップの両方から、カードリスト未掲載の商品も発見する', async () => {
  const pages = {
    '_cardlist.html': '<a href="./cardlist_BP7.html">第7弾「次の弾」</a>',
    'products.html': '<a href="./products_TD4.html">詳細</a>',
    'index.html': '<a href="./products_30.html">新商品</a>',
  };
  const sources = await discoverSources(async page => pages[page], { log: () => {} });
  assert.ok(sources.packPages.includes('cardlist_BP7.html'));
  assert.ok(sources.productPages.includes('products_TD4.html'));
  assert.ok(sources.productPages.includes('products_30.html'));
  assert.equal(packPrefixFromPage('products_TD4.html'), 'TD4');
  assert.equal(productPackName('<h1>構築済みトライアルデッキ 「新しいデッキ」</h1>', 'TD4'), 'TD4 新しいデッキ');
});

test('商品リンクは同一サイトに限定し、表記違い・重複を正規化する', () => {
  assert.deepEqual(parseProductLinks(`
    <a href="./products_TD1.html#cards">狼</a>
    <a href="https://acgtcg.com/products_TD1.html?v=2">狼</a>
    <a href="/products_TD2.html">狸</a>
    <a href="https://example.com/products_TD3.html">外部</a>
    <a href="products.html">一覧</a>
  `), ['products_TD1.html', 'products_TD2.html']);
});

test('一覧の取得失敗でも既知の先行公開セットを失わない', async () => {
  const sources = await discoverSources(async () => { throw new Error('offline'); }, { log: () => {} });
  assert.deepEqual(sources.productPages, FALLBACK_PRODUCT_PAGES);
  assert.ok(sources.packPages.includes('cardlist_SD1.html'));
});

test('新規通常版のみ取得し、再録・加工版・PR版・箱絵を除外する', () => {
  for (const num of Object.keys(trialCardDetails)) {
    assert.ok(isPlayableCardImage(`${num}.png`), num);
    assert.ok(isDownloadableCardImage(`${num}.png`), num);
  }
  for (const num of Object.keys(cardReprints)) {
    for (const suffix of ['', '_T']) {
      assert.equal(isPlayableCardImage(`${num}${suffix}.png`), false, num);
      assert.equal(isDownloadableCardImage(`${num}${suffix}.png`), false, num);
    }
  }
  for (const file of ['TD-001F.png', 'TD-PR01.png', 'ACG_box_TD1.jpg']) {
    assert.equal(isDownloadableCardImage(file), false, file);
  }
  assert.deepEqual(cardImageRefs(`
    <img src="./img/TD-001.png">
    <img src="https://acgtcg.com/img/TD-001.png">
    <img src="/img/TD-023.png?v=2">
    <img src="./img/TD-008.png">
    <img src="./img/TD-001F.png">
    <img src="./img/TD-PR01.png">
    <img src="https://example.com/img/TD-046.png">
  `, 'products_TD1.html').map(ref => ref.name), ['TD-001.png', 'TD-023.png']);
});

test('全弾の生成データに同名重複がなく、BP6再録・領土再録も残らない', () => {
  const names = new Map();
  for (const card of cardData) {
    const name = normalizedCardName(card.name);
    assert.equal(names.has(name), false, `${card.cardNumber} と ${names.get(name)}: ${name}`);
    names.set(name, card.cardNumber);
    assert.equal(Object.hasOwn(cardReprints, card.kindKey), false, card.cardNumber);
  }
  assert.equal(cardData.some(card => card.name === '間猿'), false);
  assert.equal(cardData.filter(card => card.name === '聞猿').length, 1);
});

test('未知のBP再録も同名照合で除外し、保存デッキ用の対応先を記録する', () => {
  const reprints = new Map();
  const cards = mergeCardSources([
    { cardNumber: 'BP7-090', name: '熱烈な再演', effect: '本文' },
    { cardNumber: 'BP2-025', name: '熱烈な再演', effect: '本文' },
  ], [], placeholder, { reprints });
  assert.deepEqual([...cards.keys()], ['BP2-025']);
  assert.equal(reprints.get('BP7-090'), 'BP2-025');
});

test('生成データに新規21種が正しい収録デッキで入り、再録47種は入らない', () => {
  const byKind = new Map(cardData.map(card => [kindKeyOf(card.cardNumber), card]));
  for (const [num, details] of Object.entries(trialCardDetails)) {
    const card = byKind.get(num);
    assert.ok(card, num);
    const n = Number(num.slice(3));
    const prefix = n < 23 ? 'TD1' : n < 46 ? 'TD2' : 'TD3';
    assert.ok(card.pack.startsWith(prefix + ' '), `${num}: ${card.pack}`);
    assert.ok(packOrder.includes(card.pack));
    for (const [key, value] of Object.entries(details)) assert.equal(card[key], value, `${num}.${key}`);
    assert.equal(card.maxDeckCount, 4);
    assert.equal(card.maxTokenDeckCount, 0);
  }
  assert.equal(Object.keys(trialCardDetails).length, 21);
  assert.equal(Object.keys(trialReprints).length, 47);
  for (const [num, original] of Object.entries(trialReprints)) {
    assert.equal(byKind.has(num), false, num);
    assert.ok(byKind.has(original), `元のカードを残す: ${original}`);
  }
});
