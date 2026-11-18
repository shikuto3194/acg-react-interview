/**
 * DeckDetailView.jsx
 * デッキの内容（基礎/領土/予備）をリスト or グリッドで描画する純粋プレゼンテーション部品。
 * 元は App.jsx のインライン JSX（detailDeck 表示部）を切り出したもの。
 *
 * モーダルのラッパー（背景・閉じるボタン）や上部ヘッダー（PDF/JSON/PNG ボタン群 等）は
 * 含めない。呼び出し側が自由に組み立てる前提。
 */
import { useMemo } from 'react';
import cardData from '../cardData';
import { sortDeckCards } from '../utils/deckUtils';

/**
 * @param {Object} props
 * @param {Object} props.deck                  - { cards, tokenDeck, sideDeck, relatedTokens, ... }
 * @param {'list'|'grid'} props.viewMode       - 表示モード
 * @param {(mode: 'list'|'grid') => void} [props.onViewModeChange] - showMainHeader=true の時に必須
 * @param {(card: Object) => void} props.onCardClick - カードクリック時のコールバック
 * @param {boolean} [props.showMainHeader=false] - 「基礎デッキ: N枚 [≡][■]」見出し行を描画するか
 * @param {number|null} [props.listMaxHeight=null] - list view のスクロール領域 max-height (px)
 */
export default function DeckDetailView({
  deck,
  viewMode,
  onViewModeChange,
  onCardClick,
  showMainHeader = false,
  listMaxHeight = null,
}) {
  // ---- メインデッキ ----
  const mainCards = useMemo(() => sortDeckCards(deck?.cards || []), [deck?.cards]);
  const mainTotal = useMemo(
    () => mainCards.reduce((sum, c) => sum + (c.count || 0), 0),
    [mainCards]
  );

  // ---- 領土デッキ ----
  const tokenInfo = useMemo(() => {
    const related = Array.isArray(deck?.relatedTokens) ? deck.relatedTokens : [];
    const tokenDeckArr = Array.isArray(deck?.tokenDeck) ? deck.tokenDeck : [];
    const tokenCountMap = new Map(tokenDeckArr.map(t => [Number(t.id), Number(t.count) || 0]));
    const relatedIdSet = new Set(related.map(t => Number(t.id)));
    const extraTokenIds = tokenDeckArr
      .filter(t => (Number(t.count) || 0) > 0)
      .map(t => Number(t.id))
      .filter(id => !relatedIdSet.has(id));
    const extra = extraTokenIds
      .map(id => cardData.find(c => Number(c.id) === id))
      .filter(Boolean);
    const tokenCards = [...related, ...extra].filter(
      tc => (tokenCountMap.get(Number(tc.id)) || 0) > 0
    );
    const tokenTotal = tokenCards.reduce(
      (sum, tc) => sum + (tokenCountMap.get(Number(tc.id)) || 0),
      0
    );
    return { tokenCards, tokenCountMap, tokenTotal };
  }, [deck?.relatedTokens, deck?.tokenDeck]);

  // ---- 予備デッキ ----
  const sideInfo = useMemo(() => {
    const sideArr = Array.isArray(deck?.sideDeck) ? deck.sideDeck : [];
    const sideCountMap = new Map(sideArr.map(s => [Number(s.id), Number(s.count) || 0]));
    const sideCardsResolved = sortDeckCards(
      sideArr
        .filter(s => (Number(s.count) || 0) > 0)
        .map(s => cardData.find(c => Number(c.id) === Number(s.id)))
        .filter(Boolean)
    );
    const sideTotal = sideCardsResolved.reduce(
      (sum, c) => sum + (sideCountMap.get(Number(c.id)) || 0),
      0
    );
    return { sideCards: sideCardsResolved, sideCountMap, sideTotal };
  }, [deck?.sideDeck]);

  const { tokenCards, tokenCountMap, tokenTotal } = tokenInfo;
  const { sideCards, sideCountMap, sideTotal } = sideInfo;

  // ---- メイン見出し行（オプション） ----
  // 「基礎デッキ: N枚 [≡][■]」を showMainHeader=true で描画する
  const mainHeader = showMainHeader ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '0.5em',
        gap: '0.5em',
      }}
    >
      <span style={{ fontWeight: 'bold', color: '#1976d2', flex: 1 }}>
        基礎デッキ: {mainTotal}枚
      </span>
      <button
        className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
        onClick={() => onViewModeChange?.('list')}
      >
        ≡
      </button>
      <button
        className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
        onClick={() => onViewModeChange?.('grid')}
      >
        ■
      </button>
    </div>
  ) : null;

  // ---- list view ----
  if (viewMode === 'list') {
    const listStyle = listMaxHeight != null
      ? { maxHeight: listMaxHeight, overflowY: 'auto', marginBottom: '0.7em' }
      : { marginBottom: '0.7em' };

    return (
      <>
        {mainHeader}
        <div style={listStyle}>
          {mainCards.map(card => {
            const isDoubleSided = card.isDoubleSided && card.front && card.back;
            const displayCard = isDoubleSided ? card.front : card;
            const typeText = isDoubleSided
              ? `${card.front.type} / ${card.back.type}`
              : card.type;
            return (
              <div
                key={card.id}
                style={{ display: 'flex', alignItems: 'center', gap: '0.7em', marginBottom: '4px', cursor: 'pointer' }}
                onClick={() => onCardClick(card)}
              >
                <img src={displayCard.image} alt={displayCard.name} style={{ width: 32, height: 44, objectFit: 'cover', borderRadius: 5 }} loading="lazy" decoding="async" />
                <span style={{ flex: 1 }}>
                  <b>{card.name}</b>{' '}
                  <span style={{ fontSize: '0.97em', color: '#666' }}>({typeText})</span>
                </span>
                <span style={{ color: '#1976d2', fontWeight: 'bold' }}>{card.count}枚</span>
              </div>
            );
          })}

          {tokenCards.length > 0 && (
            <div style={{ marginTop: '0.8em' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 'bold', marginBottom: '0.5em', color: '#ff9800' }}>
                領土デッキ: {tokenTotal}枚
              </div>
              {tokenCards.map(tokenCard => {
                const cnt = tokenCountMap.get(Number(tokenCard.id)) || 0;
                return (
                  <div
                    key={tokenCard.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.7em', marginBottom: '4px', cursor: 'pointer' }}
                    onClick={() => onCardClick(tokenCard)}
                  >
                    <img src={tokenCard.image} alt={tokenCard.name} style={{ width: 32, height: 44, objectFit: 'cover', borderRadius: 5 }} loading="lazy" decoding="async" />
                    <span style={{ flex: 1 }}>
                      <b>{tokenCard.name}</b>{' '}
                      <span style={{ fontSize: '0.97em', color: '#666' }}>({tokenCard.type})</span>
                    </span>
                    <span style={{ color: '#ff9800', fontWeight: 'bold' }}>{cnt}枚</span>
                  </div>
                );
              })}
            </div>
          )}

          {sideCards.length > 0 && (
            <div style={{ marginTop: '0.8em' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 'bold', marginBottom: '0.5em', color: '#43a047' }}>
                予備デッキ: {sideTotal}枚
              </div>
              {sideCards.map(sideCard => {
                const cnt = sideCountMap.get(Number(sideCard.id)) || 0;
                const isDouble = sideCard.isDoubleSided && sideCard.front && sideCard.back;
                const display = isDouble ? sideCard.front : sideCard;
                const typeText = isDouble
                  ? `${sideCard.front.type} / ${sideCard.back.type}`
                  : sideCard.type;
                return (
                  <div
                    key={sideCard.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.7em', marginBottom: '4px', cursor: 'pointer' }}
                    onClick={() => onCardClick(sideCard)}
                  >
                    <img src={display.image} alt={display.name} style={{ width: 32, height: 44, objectFit: 'cover', borderRadius: 5 }} loading="lazy" decoding="async" />
                    <span style={{ flex: 1 }}>
                      <b>{sideCard.name}</b>{' '}
                      <span style={{ fontSize: '0.97em', color: '#666' }}>({typeText})</span>
                    </span>
                    <span style={{ color: '#43a047', fontWeight: 'bold' }}>{cnt}枚</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  // ---- grid view ----
  return (
    <>
      {mainHeader}
      <div
        className="card-grid"
        style={{ width: '100%', maxWidth: 500, margin: '0 auto', marginBottom: '0.7em', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5em' }}
      >
        {mainCards.map(card => {
          const isDoubleSided = card.isDoubleSided && card.front && card.back;
          const displayCard = isDoubleSided ? card.front : card;
          return (
            <div
              key={card.id}
              style={{ position: 'relative', width: '100%', aspectRatio: '385/561', background: '#fff', borderRadius: 5, boxShadow: '0 1px 4px #bbb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={() => onCardClick(card)}
            >
              <img src={displayCard.image} alt={displayCard.name} style={{ width: '98%', height: '98%', objectFit: 'cover', borderRadius: 5, background: '#fff', display: 'block' }} loading="lazy" decoding="async" />
              <span style={{ position: 'absolute', top: 0, right: 0, background: '#1976d2', color: '#fff', borderRadius: '50%', width: '1.25em', height: '1.25em', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1em', fontWeight: 'bold', boxShadow: '0 1px 4px #bbb', zIndex: 3, pointerEvents: 'none' }}>
                {card.count}
              </span>
            </div>
          );
        })}
      </div>

      {tokenCards.length > 0 && (
        <div style={{ marginTop: '1.5em' }}>
          <h3 style={{ fontSize: '1.1em', fontWeight: 'bold', marginBottom: '0.7em', color: '#ff9800' }}>
            領土デッキ: {tokenTotal}枚
          </h3>
          <div
            className="card-grid"
            style={{ width: '100%', maxWidth: 500, margin: '0 auto', marginBottom: '0.7em', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5em' }}
          >
            {tokenCards.map(tokenCard => {
              const cnt = tokenCountMap.get(Number(tokenCard.id)) || 0;
              return (
                <div
                  key={tokenCard.id}
                  style={{ position: 'relative', width: '100%', aspectRatio: '385/561', background: '#fff', borderRadius: 5, boxShadow: '0 1px 4px #bbb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={() => onCardClick(tokenCard)}
                >
                  <img src={tokenCard.image} alt={tokenCard.name} style={{ width: '98%', height: '98%', objectFit: 'cover', borderRadius: 5, background: '#fff', display: 'block' }} loading="lazy" decoding="async" />
                  {cnt > 0 && (
                    <span style={{ position: 'absolute', top: 0, right: 0, background: '#ff9800', color: '#fff', borderRadius: '50%', width: '1.25em', height: '1.25em', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1em', fontWeight: 'bold', boxShadow: '0 1px 4px #bbb', zIndex: 3, pointerEvents: 'none' }}>
                      {cnt}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sideCards.length > 0 && (
        <div style={{ marginTop: '1.5em' }}>
          <h3 style={{ fontSize: '1.1em', fontWeight: 'bold', marginBottom: '0.7em', color: '#43a047' }}>
            予備デッキ: {sideTotal}枚
          </h3>
          <div
            className="card-grid"
            style={{ width: '100%', maxWidth: 500, margin: '0 auto', marginBottom: '0.7em', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5em' }}
          >
            {sideCards.map(sideCard => {
              const isDouble = sideCard.isDoubleSided && sideCard.front && sideCard.back;
              const display = isDouble ? sideCard.front : sideCard;
              const cnt = sideCountMap.get(Number(sideCard.id)) || 0;
              return (
                <div
                  key={sideCard.id}
                  style={{ position: 'relative', width: '100%', aspectRatio: '385/561', background: '#fff', borderRadius: 5, boxShadow: '0 1px 4px #bbb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={() => onCardClick(sideCard)}
                >
                  <img src={display.image} alt={display.name} style={{ width: '98%', height: '98%', objectFit: 'cover', borderRadius: 5, background: '#fff', display: 'block' }} loading="lazy" decoding="async" />
                  {cnt > 0 && (
                    <span style={{ position: 'absolute', top: 0, right: 0, background: '#43a047', color: '#fff', borderRadius: '50%', width: '1.25em', height: '1.25em', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1em', fontWeight: 'bold', boxShadow: '0 1px 4px #bbb', zIndex: 3, pointerEvents: 'none' }}>
                      {cnt}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
