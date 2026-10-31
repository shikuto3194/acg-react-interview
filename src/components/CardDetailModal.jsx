import React, { useState } from 'react';
import cardData from '../cardData';
import { toAbsPath } from '../utils/deckUtils';
import { getSameNameLimit, getSideDeckLimit } from '../utils/deckLimits';
import '../styles/modal.css';

/**
 * カード詳細モーダル（共通コンポーネント）
 *
 * hideDeckActions=true でデッキ操作ボタンを非表示にする（閲覧専用モード）。
 * useAbsPath=true で画像パスを絶対パスに変換する（/events/:id 等のネスト配下で使用）。
 */
export default function CardDetailModal({
  card,
  show = true,
  onClose,
  onSetDeckThumbnail,
  inDeck,
  countInDeck,
  onIncrease,
  onDecrease,
  getTokenCountInDeck,
  onTokenIncrease,
  onTokenDecrease,
  getSideCountInDeck,
  onSideIncrease,
  onSideDecrease,
  showFront: showFrontProp,
  setShowFront: setShowFrontProp,
  hideDeckActions = false,
  useAbsPath = false,
  zIndex = 1000,
}) {
  // 閲覧専用モード用の内部 showFront state
  const [internalShowFront, setInternalShowFront] = useState(true);
  const showFront = showFrontProp !== undefined ? showFrontProp : internalShowFront;
  const setShowFront = setShowFrontProp || setInternalShowFront;
  // トークン表示用のstate（フックは早期 return より前で必ず呼ぶ）
  const [tokenIndex, setTokenIndex] = useState(null);

  if (show === false || !card) return null;

  // ダブルフェイス対応
  const isDoubleSided = card.isDoubleSided && card.front && card.back;
  const hasRelatedTokens = card.relatedTokens && card.relatedTokens.length > 0;
  const showToken = tokenIndex !== null;

  const getTokenCard = (tokenName) => cardData.find(c => c.name === tokenName);

  let activeSide;
  if (showToken && hasRelatedTokens) {
    const resolved = getTokenCard(card.relatedTokens[tokenIndex]);
    activeSide = resolved || (isDoubleSided ? (showFront ? card.front : card.back) : card);
  } else {
    activeSide = isDoubleSided ? (showFront ? card.front : card.back) : card;
  }

  const handleTokenToggle = () => {
    if (!showToken && hasRelatedTokens) setTokenIndex(0);
    else setTokenIndex(null);
  };

  // ACG: 領土カードは「領土デッキ」 (既存の tokenDeck 機構) で扱う。
  const isTokenCard = (c) => {
    if (!c) return false;
    if (c.isDoubleSided && c.front && c.back) {
      const ft = c.front.type || '';
      const bt = c.back.type || '';
      return ft === '領土' || bt === '領土' || ft.includes('トークン') || bt.includes('トークン');
    }
    const t = c.type || '';
    return t === '領土' || t.includes('トークン');
  };

  const activeIsToken = isTokenCard(activeSide);
  const mainMaxCount = isTokenCard(card) ? 0 : (card?.maxDeckCount ?? 4);
  const tokenMaxCount = activeSide?.maxTokenDeckCount ?? 4;
  const maxCount = activeIsToken ? tokenMaxCount : mainMaxCount;
  const currentCount = activeIsToken
    ? (typeof getTokenCountInDeck === 'function' ? (Number(getTokenCountInDeck(activeSide.id)) || 0) : 0)
    : countInDeck;

  // 予備デッキ: 同名カードは通常4枚まで。カード記載の枚数例外を優先する。
  // 種属「基礎」の領土カード (平野/山岳/水生/森林) は基礎側無制限・予備のみ4枚制限。
  const sideTargetId = activeIsToken ? activeSide?.id : card?.id;
  const sideCount = typeof getSideCountInDeck === 'function'
    ? (Number(getSideCountInDeck(sideTargetId)) || 0)
    : 0;
  const isBasicTerritory = activeSide?.type === '領土' && activeSide?.tribe === '基礎';
  const combinedLimit = getSameNameLimit(activeIsToken ? activeSide : card);
  const sideMax = getSideDeckLimit(activeIsToken ? activeSide : card);
  const sideIncDisabled = sideCount >= sideMax || (currentCount + sideCount) >= combinedLimit;
  // 予備行を表示する条件: バンされておらず、基礎または領土のどちらかに入れられる種類のカード (= 純トークンは除外)
  const canHaveSide = !card?.isBanned
    && typeof onSideIncrease === 'function'
    && (mainMaxCount > 0 || tokenMaxCount > 0);

  const handleIncrease = () => {
    if (activeIsToken) {
      if (typeof onTokenIncrease === 'function') onTokenIncrease(activeSide.id);
      return;
    }
    if (typeof onIncrease === 'function') onIncrease(card.id);
  };
  const handleDecrease = () => {
    if (activeIsToken) {
      if (typeof onTokenDecrease === 'function') onTokenDecrease(activeSide.id);
      return;
    }
    if (typeof onDecrease === 'function') onDecrease(card.id);
  };
  const handleSideIncrease = () => {
    if (typeof onSideIncrease === 'function') onSideIncrease(sideTargetId);
  };
  const handleSideDecrease = () => {
    if (typeof onSideDecrease === 'function') onSideDecrease(sideTargetId);
  };
  // 基礎/領土 + ボタンの追加 disabled 条件: 合算 cap
  const primaryIncDisabled = currentCount >= maxCount || (currentCount + sideCount) >= combinedLimit;

  const imgSrc = useAbsPath ? toAbsPath(activeSide.image) : activeSide.image;

  return (
    <div className="cdm-overlay" style={zIndex !== 1000 ? { zIndex } : undefined} onClick={onClose}>
      <div className="cdm-content" onClick={e => e.stopPropagation()}>
        <button className="cdm-close" onClick={onClose}>×</button>
        <div style={{ textAlign: 'center' }}>
          <img src={imgSrc} alt={activeSide.name} className="cdm-card-img" />
        </div>
        {/* ダブルフェイス切り替え */}
        {isDoubleSided && !showToken && (
          <button className="cdm-toggle-btn" onClick={() => setShowFront(f => !f)}>
            {showFront ? '裏面を見る' : '表面に戻す'}
          </button>
        )}
        {/* トークン切り替え（ダブルフェイスでない場合） */}
        {hasRelatedTokens && !isDoubleSided && (
          <div style={{ textAlign: 'center', marginBottom: '1em' }}>
            <button className="cdm-token-toggle" onClick={handleTokenToggle}>
              {showToken ? '元のカードに戻る' : 'トークンを見る'}
            </button>
            {showToken && card.relatedTokens.length > 1 && (
              <div className="cdm-token-nav">
                <button onClick={() => setTokenIndex(i => Math.max(0, i - 1))} disabled={tokenIndex === 0}>◀</button>
                <span>{activeSide.name}（{tokenIndex + 1}/{card.relatedTokens.length}）</span>
                <button onClick={() => setTokenIndex(i => Math.min(card.relatedTokens.length - 1, i + 1))} disabled={tokenIndex === card.relatedTokens.length - 1}>▶</button>
              </div>
            )}
          </div>
        )}
        {/* ダブルフェイス＋トークン両方持ち */}
        {isDoubleSided && hasRelatedTokens && (
          <div style={{ textAlign: 'center', marginBottom: '1em' }}>
            <div style={{ display: 'flex', gap: '0.5em', justifyContent: 'center' }}>
              {!showToken && (
                <button className="cdm-toggle-btn" onClick={() => setShowFront(f => !f)}>
                  {showFront ? '裏面を見る' : '表面に戻す'}
                </button>
              )}
              <button className="cdm-token-toggle" onClick={handleTokenToggle}>
                {showToken ? '元のカードに戻る' : 'トークンを見る'}
              </button>
            </div>
            {showToken && card.relatedTokens.length > 1 && (
              <div className="cdm-token-nav">
                <button onClick={() => setTokenIndex(i => Math.max(0, i - 1))} disabled={tokenIndex === 0}>◀</button>
                <span>{activeSide.name}（{tokenIndex + 1}/{card.relatedTokens.length}）</span>
                <button onClick={() => setTokenIndex(i => Math.min(card.relatedTokens.length - 1, i + 1))} disabled={tokenIndex === card.relatedTokens.length - 1}>▶</button>
              </div>
            )}
          </div>
        )}
        {/* デッキ操作ボタン群 */}
        {!hideDeckActions && (
          <>
            <div style={{ minHeight: '2.5em', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1em' }}>
              {onSetDeckThumbnail && !card.isBanned && (activeIsToken ? (currentCount > 0) : inDeck) && (activeIsToken ? tokenMaxCount > 0 : mainMaxCount > 0) ? (
                <button className="cdm-thumbnail-btn" onClick={() => { onSetDeckThumbnail(activeIsToken ? activeSide.id : card.id); onClose(); }}>
                  デッキ画像に指定
                </button>
              ) : (
                <span style={{ display: 'inline-block', width: '8.5em', height: '2.2em' }}></span>
              )}
            </div>
            <div className="cdm-deck-controls">
              {maxCount > 0 ? (
                <>
                  <span className="cdm-row-label">{activeIsToken ? '領土' : '基礎'}</span>
                  <button
                    onClick={handleDecrease}
                    className={`cdm-btn-minus${activeIsToken ? ' token' : ''}`}
                    disabled={currentCount <= 0}
                  >-</button>
                  <span>{currentCount}{isBasicTerritory ? ' / ∞' : ` / ${maxCount}`}</span>
                  <button
                    onClick={handleIncrease}
                    className={`cdm-btn-plus${activeIsToken ? ' token' : ''}`}
                    disabled={primaryIncDisabled}
                  >+</button>
                </>
              ) : !activeIsToken ? (
                <span className="cdm-cannot-add">このカードはデッキに入れられません。</span>
              ) : null}
            </div>
            {canHaveSide && (
              <div className="cdm-deck-controls side">
                <span className="cdm-row-label side">予備</span>
                <button
                  onClick={handleSideDecrease}
                  className="cdm-btn-minus side"
                  disabled={sideCount <= 0}
                >-</button>
                <span>{sideCount} / {sideMax}</span>
                <button
                  onClick={handleSideIncrease}
                  className="cdm-btn-plus side"
                  disabled={sideIncDisabled}
                >+</button>
              </div>
            )}
          </>
        )}
        {/* プレビューカードはカードデータ未抽出のため、画像とボタン以外は表示しない */}
        {activeSide.type === 'プレビュー' || activeSide.isPreview ? (
          <div style={{ textAlign: 'center', padding: '0.5em 0', color: '#666', fontSize: '0.9em' }}>
            プレビュー (公式未公開)
            <div style={{ fontSize: '0.75em', color: '#999', marginTop: 4 }}>
              カード情報は公式サイトでの公開後に反映されます
            </div>
          </div>
        ) : (
          <>
            <h2 className="cdm-card-name">{activeSide.name}</h2>
            <div className="cdm-meta">
              <span>属性: {(activeSide.color || []).join('・') || '-'}</span>
              <span>コスト: {activeSide.cost}</span>
              <span>{formatCondition(activeSide.conditionRaw, activeSide.reduction)}</span>
              <span>カード種類: {activeSide.type}</span>
              <span>種族: {activeSide.tribe || '-'}</span>
              {activeSide.symbol && activeSide.symbol.length > 0 && (
                <span>シンボル: {activeSide.symbol.join('・')}</span>
              )}
            </div>
            <div className="cdm-meta">
              <span>レアリティ: {activeSide.rarity || '-'}</span>
              <span>収録弾: {activeSide.pack || '-'}</span>
              <span>カード番号: {activeSide.cardNumber || '-'}</span>
            </div>
            {activeSide.atk !== undefined && activeSide.def !== undefined && (
              <table className="cdm-level-table">
                <thead>
                  <tr>
                    <th>ATK</th>
                    <th>DEF</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{activeSide.atk}</td>
                    <td>{activeSide.def}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <div className="cdm-effect">
              {activeSide.effectPending
                ? '効果はカード画像をご確認ください。公式のテキスト公開後に反映します。'
                : renderEffect(activeSide.effect)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 条件表記の整形: 「山山／夜」→「山・山 / 夜」 (シンボル間に ・、OR ブランチは / で結合)
// conditionRaw が無いカード (旧データ等) は reduction 配列をフォールバックとして使う
function formatCondition(raw, reduction) {
  if (raw && raw.trim()) {
    const branches = raw
      .split(/[／/]/)
      .map((b) => b.trim().split('').join('・'))
      .filter(Boolean);
    if (branches.length) return `条件: ${branches.join(' / ')}`;
  }
  if (reduction && reduction.length) return `条件: ${reduction.join('・')}`;
  return '';
}

// エフェクトテキストのレンダリング (改行 → <br/>)
function renderEffect(effect) {
  if (!effect) return 'テキストなし';
  const lines = effect.split(/\r?\n/);
  return lines.map((line, i) => (
    <span key={i}>{line}{i < lines.length - 1 ? <br /> : null}</span>
  ));
}
