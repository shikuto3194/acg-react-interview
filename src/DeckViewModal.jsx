/**
 * DeckViewModal.jsx
 * デッキ内容を閲覧するモーダル（閲覧専用）
 */
import { useState, useMemo } from 'react';
import cardData from './cardData';
import CardDetailModal from './components/CardDetailModal';
import { rehydrateCards, collectRelatedTokensFromCards, sortDeckCards, toAbsPath } from './utils/deckUtils';
import './styles/modal.css';

/**
 * @param {string} deckName - デッキ名
 * @param {Array} deckCards - [{id, count, ...}] メインデッキ（minimal形式）
 * @param {Array} tokenCards - [{id, count}] トークンデッキ
 * @param {Array} sideCards - [{id, count}] 予備デッキ (省略可)
 * @param {Function} onClose - 閉じるコールバック
 */
export default function DeckViewModal({ deckName, deckCards, tokenCards, sideCards, onClose }) {
  const [viewMode, setViewMode] = useState('grid');
  const [detailCard, setDetailCard] = useState(null);

  // minimal → full card data
  const hydratedCards = useMemo(() => rehydrateCards(deckCards || []), [deckCards]);
  const mainCards = useMemo(() => sortDeckCards(hydratedCards.filter(c => (c.count || 0) > 0)), [hydratedCards]);
  const relatedTokens = useMemo(() => collectRelatedTokensFromCards(hydratedCards), [hydratedCards]);

  // トークンデッキ処理
  const tokenDeckArr = useMemo(() => {
    if (!tokenCards) return [];
    if (Array.isArray(tokenCards)) {
      return tokenCards
        .map(t => ({ id: Number(t?.id), count: Number(t?.count) || 0 }))
        .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
    }
    if (typeof tokenCards === 'object') {
      return Object.entries(tokenCards)
        .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
        .filter(t => Number.isFinite(t.id) && t.id > 0 && t.count > 0);
    }
    return [];
  }, [tokenCards]);

  const tokenCountMap = useMemo(() => new Map(tokenDeckArr.map(t => [t.id, t.count])), [tokenDeckArr]);

  // 関連トークン + extra トークン
  const resolvedTokenCards = useMemo(() => {
    const relatedIdSet = new Set(relatedTokens.map(t => Number(t.id)));
    const extraTokenIds = tokenDeckArr
      .filter(t => t.count > 0)
      .map(t => t.id)
      .filter(id => !relatedIdSet.has(id));
    const extra = extraTokenIds
      .map(id => cardData.find(c => Number(c.id) === id))
      .filter(Boolean);
    return [...relatedTokens, ...extra].filter(tc => (tokenCountMap.get(Number(tc.id)) || 0) > 0);
  }, [relatedTokens, tokenDeckArr, tokenCountMap]);

  // 予備デッキ処理
  const sideDeckArr = useMemo(() => {
    if (!sideCards) return [];
    if (Array.isArray(sideCards)) {
      return sideCards
        .map(s => ({ id: Number(s?.id), count: Number(s?.count) || 0 }))
        .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
    }
    if (typeof sideCards === 'object') {
      return Object.entries(sideCards)
        .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
        .filter(s => Number.isFinite(s.id) && s.id > 0 && s.count > 0);
    }
    return [];
  }, [sideCards]);

  const sideCountMap = useMemo(() => new Map(sideDeckArr.map(s => [s.id, s.count])), [sideDeckArr]);
  const resolvedSideCards = useMemo(() => {
    const cards = sideDeckArr
      .map(s => cardData.find(c => Number(c.id) === s.id))
      .filter(Boolean);
    return sortDeckCards(cards);
  }, [sideDeckArr]);

  const totalMain = mainCards.reduce((sum, c) => sum + (c.count || 0), 0);
  const totalToken = resolvedTokenCards.reduce((sum, tc) => sum + (tokenCountMap.get(Number(tc.id)) || 0), 0);
  const totalSide = resolvedSideCards.reduce((sum, sc) => sum + (sideCountMap.get(Number(sc.id)) || 0), 0);

  // サムネイル取得
  const thumbCard = mainCards.find(c => c.isDeckThumbnail) || mainCards[0] || null;
  const thumbImage = thumbCard ? (thumbCard.isDoubleSided && thumbCard.front ? thumbCard.front.image : thumbCard.image) : null;

  return (
    <>
      <div className="dvm-overlay" onClick={onClose}>
        <div className="dvm-content" onClick={e => e.stopPropagation()}>
          <button className="dvm-close" onClick={onClose}>×</button>

          <h2 className="dvm-title">{deckName}</h2>

          {/* ヘッダー: サムネ + 枚数 + リスト/グリッド切替 */}
          <div className="dvm-header">
            {thumbImage && (
              <img src={toAbsPath(thumbImage)} alt="サムネイル" className="dvm-thumb" />
            )}
            <span className="dvm-main-count">基礎デッキ: {totalMain}枚</span>
            <div className="dvm-view-toggle">
              <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡</button>
              <button className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')}>■</button>
            </div>
          </div>

          {/* リストビュー */}
          {viewMode === 'list' ? (
            <div className="dvm-list-area">
              {mainCards.map(card => {
                const isDoubleSided = card.isDoubleSided && card.front && card.back;
                const displayCard = isDoubleSided ? card.front : card;
                const typeText = isDoubleSided ? `${card.front.type} / ${card.back.type}` : card.type;
                return (
                  <div key={card.id} className="dvm-list-row" onClick={() => setDetailCard(card)}>
                    <img src={toAbsPath(displayCard.image)} alt={displayCard.name} className="dvm-list-img" loading="lazy" decoding="async" />
                    <span className="dvm-list-name"><b>{card.name}</b> <span className="dvm-list-type">({typeText})</span></span>
                    <span className="dvm-list-count">{card.count}枚</span>
                  </div>
                );
              })}

              {resolvedTokenCards.length > 0 && (
                <div style={{ marginTop: '0.8em' }}>
                  <div className="dvm-token-header">領土デッキ: {totalToken}枚</div>
                  {resolvedTokenCards.map(tokenCard => {
                    const cnt = tokenCountMap.get(Number(tokenCard.id)) || 0;
                    return (
                      <div key={tokenCard.id} className="dvm-list-row" onClick={() => setDetailCard(tokenCard)}>
                        <img src={toAbsPath(tokenCard.image)} alt={tokenCard.name} className="dvm-list-img" loading="lazy" decoding="async" />
                        <span className="dvm-list-name"><b>{tokenCard.name}</b> <span className="dvm-list-type">({tokenCard.type})</span></span>
                        <span className="dvm-list-count-token">{cnt}枚</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {resolvedSideCards.length > 0 && (
                <div style={{ marginTop: '0.8em' }}>
                  <div className="dvm-side-header">予備デッキ: {totalSide}枚</div>
                  {resolvedSideCards.map(sideCard => {
                    const cnt = sideCountMap.get(Number(sideCard.id)) || 0;
                    const isDouble = sideCard.isDoubleSided && sideCard.front && sideCard.back;
                    const displaySide = isDouble ? sideCard.front : sideCard;
                    const typeText = isDouble ? `${sideCard.front.type} / ${sideCard.back.type}` : sideCard.type;
                    return (
                      <div key={sideCard.id} className="dvm-list-row" onClick={() => setDetailCard(sideCard)}>
                        <img src={toAbsPath(displaySide.image)} alt={displaySide.name} className="dvm-list-img" loading="lazy" decoding="async" />
                        <span className="dvm-list-name"><b>{sideCard.name}</b> <span className="dvm-list-type">({typeText})</span></span>
                        <span className="dvm-list-count-side">{cnt}枚</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* グリッドビュー */
            <>
              <div className="dvm-grid">
                {mainCards.map(card => {
                  const isDoubleSided = card.isDoubleSided && card.front && card.back;
                  const displayCard = isDoubleSided ? card.front : card;
                  return (
                    <div key={card.id} className="dvm-grid-cell" onClick={() => setDetailCard(card)}>
                      <img src={toAbsPath(displayCard.image)} alt={displayCard.name} className="dvm-grid-img" loading="lazy" decoding="async" />
                      <span className="dvm-grid-badge">{card.count}</span>
                    </div>
                  );
                })}
              </div>

              {/* トークンカードセクション（グリッド） */}
              {resolvedTokenCards.length > 0 && (
                <div style={{ marginTop: '1.5em' }}>
                  <h3 className="dvm-token-header">トークンデッキ: {totalToken}枚</h3>
                  <div className="dvm-grid">
                    {resolvedTokenCards.map(tokenCard => {
                      const cnt = tokenCountMap.get(Number(tokenCard.id)) || 0;
                      return (
                        <div key={tokenCard.id} className="dvm-grid-cell" onClick={() => setDetailCard(tokenCard)}>
                          <img src={toAbsPath(tokenCard.image)} alt={tokenCard.name} className="dvm-grid-img" loading="lazy" decoding="async" />
                          <span className="dvm-grid-badge token">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 予備デッキセクション (グリッド) */}
              {resolvedSideCards.length > 0 && (
                <div style={{ marginTop: '1.5em' }}>
                  <h3 className="dvm-side-header">予備デッキ: {totalSide}枚</h3>
                  <div className="dvm-grid">
                    {resolvedSideCards.map(sideCard => {
                      const cnt = sideCountMap.get(Number(sideCard.id)) || 0;
                      const isDouble = sideCard.isDoubleSided && sideCard.front && sideCard.back;
                      const displaySide = isDouble ? sideCard.front : sideCard;
                      return (
                        <div key={sideCard.id} className="dvm-grid-cell" onClick={() => setDetailCard(sideCard)}>
                          <img src={toAbsPath(displaySide.image)} alt={displaySide.name} className="dvm-grid-img" loading="lazy" decoding="async" />
                          <span className="dvm-grid-badge side">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* カード詳細モーダル（最前面） */}
      {detailCard && (
        <CardDetailModal card={detailCard} onClose={() => setDetailCard(null)} hideDeckActions useAbsPath zIndex={3000} />
      )}
    </>
  );
}
