/**
 * deckIdMigration.js
 *
 * 新弾追加で「ずれてしまった」保存済みデッキのカード ID を復元する。
 *
 * 【背景】
 * 以前のカードデータ生成 (scripts/build-card-data.mjs) は、カード ID を
 * 「弾順 → カード番号順に並べたときの通し番号 (index + 1)」で振っていた。
 * 領土カード (RYO-###) は常に最後尾に並ぶため、新弾が出るたびに領土カードの ID が
 * 新弾の枚数ぶん後ろへずれ、ID で保存されているデッキ (localStorage / Supabase /
 * 共有 URL / イベント登録) の領土デッキが丸ごと別カードにすり替わっていた。
 *
 * 例) BP3 まで存在した時点で保存した領土デッキの RYO-001 は id=405。
 *     BP4 (80 枚) が出ると id=405 は BP4-001 になり、RYO-001 は id=485 へ移動する。
 *
 * ID は card-id-map.json で固定になったので今後ずれることは無いが、
 * 既に保存されているデッキは古い世代の ID を持ったままなので、読み込み時に補正する。
 *
 * 【補正のしかた】
 * 旧方式では「領土カードより前に並ぶカードの総数」= 領土 ID の起点 (base) だった。
 * base は弾が増えるたびに 164 → 244 → 324 → 404 → 484 と増えてきた (LEGACY_TERRITORY_BASES)。
 * 領土デッキの ID を各 base で解釈してみて、全てが実在する領土カードになる base を
 * 新しい順に探す。見つかればそのデッキは「その世代で保存されたもの」なので、
 * base より大きい ID (= その世代では領土カードだった ID) だけを現行 ID へ読み替える。
 *
 * 現行世代で正しいデッキは必ず最新 base で一致するため、壊れていないデッキには一切
 * 手を加えない (誤補正しない) のがこの方式の要点。
 */
// 画像URLは不要なので、バージョン付与前の生データを直接読む
// (これにより Node からもそのままテストできる)
import { cardData, cardNumberAliases } from '../cardData.generated.js';
import { migrateReprintDeck, migrateReprintPairs } from './cardReprints.js';

// 旧方式での「領土カード ID の起点」候補 (新しい世代から順に並べる)。
// = その時点で存在した領土以外のカードの累計枚数
//   164 : SD1+SD2 / 244: +BP1 / 324: +BP2 / 404: +BP3 / 484: +BP4 (= 固定IDの現行領土起点)
//   564 : BP5 公開後、ID固定化前に一時的に発生した世代
// ID は card-id-map.json で固定されたので、今後この配列を増やす必要は無い
// (新弾が出ても領土カードの ID はもう動かない)。
const LEGACY_TERRITORY_BASES = [564, 484, 404, 324, 244, 164];
// 現行データでの領土起点。ここに一致する = ずれていない。
// 564 は旧生成方式の一時世代なので、配列先頭からは導出しない。
const CURRENT_TERRITORY_BASE = 484;

// BP5 は ID 固定化前に旧連番 485-564 として保存されたデッキがある。
// 固定化後は新規カード扱いなので formulaCardId と同じ BP5-### => 6000+### へ読む。
const LEGACY_BP5_BASE = CURRENT_TERRITORY_BASE;
const LEGACY_BP5_TERRITORY_BASE = 564;
const LEGACY_BP5_COUNT = LEGACY_BP5_TERRITORY_BASE - LEGACY_BP5_BASE;

// RYO-### の ### → 現行の ID
const territoryIdByNumber = (() => {
  const m = new Map();
  for (const c of cardData) {
    const mm = String(c.cardNumber || '').match(/^RYO-(\d+)$/);
    if (mm) m.set(parseInt(mm[1], 10), c.id);
  }
  return m;
})();

const currentIdByKindKey = (() => {
  const m = new Map();
  for (const c of cardData) {
    const key = String(c.kindKey || c.cardNumber || '').replace(/_T$/, '');
    if (key) m.set(key, c.id);
  }
  for (const [alias, original] of Object.entries(cardNumberAliases)) {
    if (m.has(original)) m.set(alias, m.get(original));
  }
  return m;
})();

function formulaBpId(packNumber, cardNumber) {
  return (packNumber + 1) * 1000 + cardNumber;
}

function formulaIdForKindKey(kindKey) {
  const bp = kindKey.match(/^BP(\d{1,2})-(\d{1,3})$/);
  if (bp) {
    const packNumber = parseInt(bp[1], 10);
    const cardNumber = parseInt(bp[2], 10);
    if (packNumber >= 1 && packNumber <= 57 && cardNumber >= 1 && cardNumber <= 999) {
      return formulaBpId(packNumber, cardNumber);
    }
  }
  return null;
}

function currentIdForEmbeddedIdentity(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const rawKey = entry.kindKey || entry.cardNumber;
  if (!rawKey) return null;
  const kindKey = String(rawKey).replace(/_T$/, '');
  return currentIdByKindKey.get(kindKey) ?? formulaIdForKindKey(kindKey);
}

function collectEmbeddedIdRemaps(list) {
  const remaps = new Map();
  if (!Array.isArray(list)) return remaps;
  for (const entry of list) {
    const currentId = currentIdForEmbeddedIdentity(entry);
    const oldId = Number(entry?.id);
    if (currentId != null && Number.isFinite(oldId) && currentId !== oldId) {
      remaps.set(oldId, currentId);
    }
  }
  return remaps;
}

// { id: count } / [{ id, count }] / [id] のいずれからも ID 配列を取り出す
function extractIds(list) {
  if (!list) return [];
  if (Array.isArray(list)) {
    return list
      .map(entry => (entry && typeof entry === 'object' ? entry.id : entry))
      .map(Number)
      .filter(Number.isFinite);
  }
  if (typeof list === 'object') {
    return Object.entries(list)
      .filter(([, count]) => (Number(count) || 0) > 0)
      .map(([id]) => Number(id))
      .filter(Number.isFinite);
  }
  return [];
}

/**
 * 領土デッキの ID からデッキの「世代」を判定する。
 * @returns {number|null} 旧方式の base。null = 判定不能 (領土デッキが空 or 未知の ID)
 */
export function detectLegacyBase(tokenDeck) {
  const ids = extractIds(tokenDeck).filter(id => id > 0);
  if (ids.length === 0) return null;
  for (const base of LEGACY_TERRITORY_BASES) {
    const ok = ids.every(id => id > base && territoryIdByNumber.has(id - base));
    if (ok) return base;
  }
  return null;
}

/** 旧 ID → 現行 ID (領土カードに該当しない ID はそのまま) */
function remapId(id, base) {
  const n = Number(id);
  if (!Number.isFinite(n)) return n;
  if (!Number.isFinite(base)) return n;
  if (base === LEGACY_BP5_TERRITORY_BASE && n > LEGACY_BP5_BASE && n <= LEGACY_BP5_TERRITORY_BASE) {
    const bp5Number = n - LEGACY_BP5_BASE;
    if (bp5Number >= 1 && bp5Number <= LEGACY_BP5_COUNT) {
      const kindKey = `BP5-${String(bp5Number).padStart(3, '0')}`;
      return currentIdByKindKey.get(kindKey) ?? formulaBpId(5, bp5Number);
    }
  }
  if (n <= base) return n;
  const current = territoryIdByNumber.get(n - base);
  return current ?? n;
}

/** { id: count } / [{ id, count }] の形を保ったまま ID を読み替える */
function remapIdList(list, base, options = {}) {
  if (!list) return list;
  const knownRemaps = options.knownRemaps ?? new Map();
  const remapEntryId = (entry) => {
    const oldId = entry && typeof entry === 'object' ? entry.id : entry;
    const oldNumber = Number(oldId);
    if (Number.isFinite(oldNumber) && knownRemaps.has(oldNumber)) return knownRemaps.get(oldNumber);
    const identityId = options.useEmbeddedIdentity ? currentIdForEmbeddedIdentity(entry) : null;
    if (identityId != null) return identityId;
    return remapId(oldId, base);
  };
  if (Array.isArray(list)) {
    return list.map(entry => (
      entry && typeof entry === 'object'
        ? { ...entry, id: remapEntryId(entry) }
        : remapEntryId(entry)
    ));
  }
  if (typeof list === 'object') {
    const out = {};
    for (const [id, count] of Object.entries(list)) out[remapEntryId(id)] = count;
    return out;
  }
  return list;
}

/**
 * 保存デッキ 1 件を補正する (アプリ内形式 / Supabase 行形式の両方に対応)。
 * 補正不要なら渡されたオブジェクトをそのまま返す。
 *
 * @param {Object} deck  cards / tokenDeck(token_deck) / sideDeck(side_deck) /
 *                       thumbnailCardId(thumbnail_card_id) を持つオブジェクト
 */
function migrateLegacyDeck(deck) {
  if (!deck || typeof deck !== 'object') return deck;
  const tokenKey = 'tokenDeck' in deck ? 'tokenDeck' : ('token_deck' in deck ? 'token_deck' : null);

  const base = tokenKey ? detectLegacyBase(deck[tokenKey]) : null;
  const shouldRemapByLegacyBase = base !== null && base !== CURRENT_TERRITORY_BASE;

  const cardsKey = 'cards' in deck ? 'cards' : ('deck_data' in deck ? 'deck_data' : null);
  const embeddedIdRemaps = cardsKey ? collectEmbeddedIdRemaps(deck[cardsKey]) : new Map();

  // null = 判定不能 / 現行 base = ずれていない、かつ埋め込みカード情報の旧IDも無い → 触らない
  if (!shouldRemapByLegacyBase && embeddedIdRemaps.size === 0) return deck;

  const out = { ...deck };
  if (tokenKey && shouldRemapByLegacyBase) out[tokenKey] = remapIdList(deck[tokenKey], base);

  if (cardsKey) {
    out[cardsKey] = remapIdList(deck[cardsKey], shouldRemapByLegacyBase ? base : null, {
      useEmbeddedIdentity: true,
    });
  }

  const sideKey = 'sideDeck' in deck ? 'sideDeck' : ('side_deck' in deck ? 'side_deck' : null);
  if (sideKey && shouldRemapByLegacyBase) out[sideKey] = remapIdList(deck[sideKey], base);

  const thumbKey = 'thumbnailCardId' in deck ? 'thumbnailCardId' : ('thumbnail_card_id' in deck ? 'thumbnail_card_id' : null);
  if (thumbKey && deck[thumbKey] != null) {
    const thumbId = Number(deck[thumbKey]);
    out[thumbKey] = Number.isFinite(thumbId) && embeddedIdRemaps.has(thumbId)
      ? embeddedIdRemaps.get(thumbId)
      : remapId(deck[thumbKey], shouldRemapByLegacyBase ? base : null);
  }

  console.info(`[deckIdMigration] 旧世代のデッキ ID を補正しました (base ${base ?? 'embedded'} → ${CURRENT_TERRITORY_BASE}):`, deck.name ?? '(名称不明)');
  return out;
}

export function migrateSavedDeck(deck) {
  return migrateReprintDeck(migrateLegacyDeck(migrateReprintDeck(deck)));
}

/** 保存デッキの配列を補正する (1 件も変わらなければ元の配列をそのまま返す) */
export function migrateSavedDecks(decks) {
  if (!Array.isArray(decks) || decks.length === 0) return decks;
  let changed = false;
  const out = decks.map(d => {
    const migrated = migrateSavedDeck(d);
    if (migrated !== d) changed = true;
    return migrated;
  });
  return changed ? out : decks;
}

/**
 * イベント登録などの「カード配列 + 領土デッキ」だけのスナップショットを補正する。
 * @returns {{ cards: any, tokenDeck: any, sideDeck: any }}
 */
export function migrateDeckSnapshot(cards, tokenDeck, sideDeck) {
  const base = detectLegacyBase(tokenDeck);
  if (base === null || base === CURRENT_TERRITORY_BASE) return migrateReprintDeck({ cards, tokenDeck, sideDeck });
  return migrateReprintDeck({
    cards: remapIdList(cards, base),
    tokenDeck: remapIdList(tokenDeck, base),
    sideDeck: remapIdList(sideDeck, base),
  });
}

/**
 * イベント参加者レコード (event_participants) の登録デッキを補正する。
 * deck_data / token_deck (2 デッキ制なら _2 も) は登録時点の ID スナップショットなので、
 * 新弾追加でずれた領土カードの ID が残ったままになっている。
 */
export function migrateParticipantDecks(part) {
  if (!part) return part;
  const d1 = migrateDeckSnapshot(part.deck_data, part.token_deck);
  const d2 = migrateDeckSnapshot(part.deck_data_2, part.token_deck_2);
  if (d1.cards === part.deck_data && d2.cards === part.deck_data_2
    && d1.tokenDeck === part.token_deck && d2.tokenDeck === part.token_deck_2) return part;
  return {
    ...part,
    deck_data: d1.cards,
    token_deck: d1.tokenDeck,
    deck_data_2: d2.cards,
    token_deck_2: d2.tokenDeck,
  };
}

/** ID/枚数ペア配列 (共有 URL のデコード結果など) を補正する */
export function migrateIdCountPairs(mainPairs, tokenPairs, sidePairs) {
  const tokenIds = (tokenPairs || []).map(([id]) => Number(id));
  const base = detectLegacyBase(tokenIds.map(id => ({ id, count: 1 })));
  if (base === null || base === CURRENT_TERRITORY_BASE) {
    return {
      mainPairs: migrateReprintPairs(mainPairs),
      tokenPairs: migrateReprintPairs(tokenPairs),
      sidePairs: migrateReprintPairs(sidePairs),
    };
  }
  const remapPairs = (pairs) => migrateReprintPairs((pairs || []).map(([id, count]) => [remapId(id, base), count]));
  return {
    mainPairs: remapPairs(mainPairs),
    tokenPairs: remapPairs(tokenPairs),
    sidePairs: remapPairs(sidePairs),
  };
}
