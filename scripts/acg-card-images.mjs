import { readFile } from 'node:fs/promises';
import { BASE } from './acg-cardlists.mjs';
import { kindKeyOf } from './card-ids.mjs';

const trial = JSON.parse(await readFile(new URL('./trial-decks.json', import.meta.url), 'utf8'));
export const trialCardDetails = trial.cards;
export const trialReprints = trial.reprints;
const known = JSON.parse(await readFile(new URL('./card-reprints.json', import.meta.url), 'utf8'));
export const cardReprints = { ...known.reprints, ...trialReprints };

export const normalizedCardName = name => String(name || '').normalize('NFKC').replace(/\s+/g, '');

export function isReprint(cardNumber) {
  return Object.hasOwn(cardReprints, kindKeyOf(String(cardNumber).toUpperCase()));
}

// 通常版だけをカードデータへ登録する。TD の F 加工版・PR版・再録は除外。
export function isPlayableCardImage(name) {
  return /^(ACG-\d{3}(?:_T)?|BP\d+-\d{3}(?:_T)?|TD-\d{3}(?:_T)?|RYO-\d{3}(?:_T)?)\.(?:png|jpe?g|webp)$/i.test(name)
    && !isReprint(name.replace(/\.[^.]+$/, ''));
}

export function isDownloadableCardImage(name) {
  // 従来のプロモ画像は引き続き取得する。トライアルは新規通常版のみ。
  return isPlayableCardImage(name)
    || /^(BP\d+-(?:PR|SEC)\d+|PR-\d{3}(?:_DS|_YS|_T)?|GP2025-\d+|JUDGE\d{2}|TokenDS-\d{3})\.png$/i.test(name);
}

// 画像の URL 解決を生成・ダウンロードで共通化。絶対URL、クエリにも対応。
export function cardImageRefs(html, page = BASE) {
  const refs = new Map();
  for (const match of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), new URL(page, BASE));
      if (url.origin !== new URL(BASE).origin || !/^\/img\/[^/]+\.(png|jpe?g|webp)$/i.test(url.pathname)) continue;
      const name = decodeURIComponent(url.pathname.split('/').pop());
      if (isDownloadableCardImage(name)) refs.set(name, { name, url: url.href });
    } catch { /* 不正な画像参照は無視 */ }
  }
  return [...refs.values()];
}

// 同じ番号を複数ページで見つけても1枚に統合する。
// カードリストの詳細 > 商品画像の補完情報。_T は元番号と同じ kindKey。
export function mergeCardSources(detailCards, imageNames, makePlaceholder, {
  reprints = new Map(), previousCards = [], requireName = false, onDeferred = () => {},
} = {}) {
  const previousKinds = new Set(previousCards.map(card => kindKeyOf(card.cardNumber)));
  const excluded = num => isReprint(num) || reprints.has(kindKeyOf(num));
  const cards = new Map();
  for (const card of detailCards) {
    if (!isPlayableCardImage(`${card.cardNumber}.png`)) continue;
    if (!excluded(card.cardNumber)) cards.set(card.cardNumber, card);
  }
  // 通常版を先に補完し、掲載順にかかわらず _T が情報を継承できるようにする。
  const names = [...new Set(imageNames)].filter(isPlayableCardImage)
    .sort((a, b) => Number(/_T\./i.test(a)) - Number(/_T\./i.test(b)));
  for (const name of names) {
    const num = name.replace(/\.[^.]+$/, '').toUpperCase();
    if (cards.has(num) || excluded(num)) continue;
    const base = cards.get(kindKeyOf(num));
    cards.set(num, base ? { ...base, cardNumber: num } : makePlaceholder(num));
  }
  const byKind = new Map();
  for (const card of cards.values()) {
    const key = kindKeyOf(card.cardNumber);
    if (!byKind.has(key) || /_T$/.test(card.cardNumber)) byKind.set(key, card);
  }
  // 既存の採用番号を維持し、新しい再録の訂正版・詳細公開で ID を切り替えない。
  // 初回の同名照合は訂正版、詳細テキスト、古い番号の順に優先する。
  // 名前未判明の画像は番号が名前なので、別カードを誤ってまとめない。
  const ordered = [...byKind.values()].sort((a, b) =>
    Number(previousKinds.has(kindKeyOf(b.cardNumber))) - Number(previousKinds.has(kindKeyOf(a.cardNumber)))
    || Number(/_T$/.test(b.cardNumber)) - Number(/_T$/.test(a.cardNumber))
    || Number(!!a.effectPending) - Number(!!b.effectPending)
    || a.cardNumber.localeCompare(b.cardNumber, 'en', { numeric: true }));
  const byName = new Map();
  const unique = new Map();
  for (const card of ordered) {
    const name = normalizedCardName(card.name);
    const named = name && name !== normalizedCardName(card.cardNumber)
      && name !== normalizedCardName(kindKeyOf(card.cardNumber));
    if (!named && requireName) {
      onDeferred(card.cardNumber);
      continue;
    }
    const original = named && byName.get(name);
    if (original) {
      reprints.set(kindKeyOf(card.cardNumber), kindKeyOf(original.cardNumber));
    } else {
      unique.set(card.cardNumber, card);
      if (named) byName.set(name, card);
    }
  }
  return unique;
}
