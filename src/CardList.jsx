import React from 'react';
import { FixedSizeList as List, FixedSizeGrid as Grid } from 'react-window';
import cardData from './cardData';
import './CardList.css';

const CARD_WIDTH = 260;
const CARD_HEIGHT = 220;
const GRID_COLUMNS = 4;

// スタイル定数化
const gridImgWrapStyle = {
  width: '100%',
  aspectRatio: '3/4',
  background: '#fff',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  boxShadow: '0 1px 4px #bbb',
};
const gridImgStyle = {
  width: '92%',
  height: '92%',
  objectFit: 'contain',
  borderRadius: 10,
  background: '#fff',
  boxShadow: 'none',
  cursor: 'pointer',
};
const badgeStyle = {
  position: 'absolute',
  top: 4,
  right: 6,
  background: '#1976d2',
  color: '#fff',
  borderRadius: '50%',
  width: '1.7em',
  height: '1.7em',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.1em',
  fontWeight: 'bold',
  boxShadow: '0 1px 4px #bbb',
  zIndex: 3,
  pointerEvents: 'none',
};
const gridBtnWrapStyle = {
  position: 'absolute',
  left: '50%',
  bottom: 4,
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: '0.3em',
  zIndex: 2,
};
const minusBtnStyle = {
  width: '2em', height: '2em', borderRadius: '50%', background: '#fff', border: '2px solid #1976d2', color: '#1976d2', fontSize: '1.2em', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px #bbb', cursor: 'pointer'
};
const plusBtnStyle = {
  width: '2em', height: '2em', borderRadius: '50%', background: '#1976d2', border: '2px solid #1976d2', color: '#fff', fontSize: '1.2em', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px #bbb', cursor: 'pointer'
};

// コールバック定数化
const handleMinus = (onDecrease, cardId) => e => { e.stopPropagation(); onDecrease && onDecrease(cardId); };
const handlePlus = (onIncrease, cardId) => e => { e.stopPropagation(); onIncrease && onIncrease(cardId); };

// CardItemをmemo化し、cards配列から取得
const CardItem = React.memo(function CardItem({ index, style, data }) {
  const { cards, getCardCountInDeck, onIncrease, onDecrease } = data;
  const card = cards[index];
  if (!card) return null;
  const countInDeck = getCardCountInDeck ? getCardCountInDeck(card.id) : 0;
  const maxCount = card.maxDeckCount ?? 4;
  if (maxCount === 0) return null; // 上限0なら非表示
  return (
    <div className="card-item" style={style}>
      <div className="card-grid-img-wrap" style={{ width: 48, height: 64, marginRight: 8, position: 'relative' }}>
        {card.image && card.name && (
          <img src={card.image} alt={card.name} className="card-image" style={{ width: '100%', height: '100%' }} loading="lazy" />
        )}
      </div>
      <div className="card-info">
        <h3><b>{card.name === 'HMX-12マ○チ' ? (<><span style={{ textDecoration: 'line-through' }}>HMX-12</span>マ○チ</>) : card.name}</b></h3>
        <p><b>コスト:</b> {card.cost} / <b>属性:</b> {card.color && card.color.join(', ')}</p>
        <p><b>タイプ:</b> {card.type} / <b>部族:</b> {card.tribe}</p>
        <p><b>レアリティ:</b> {card.rarity} / <b>パック:</b> {card.pack}</p>
        <p><b>効果:</b> <span className="card-effect">{card.effect && card.effect.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}</span></p>
        {card.levels && (
          <div className="card-levels">
            {card.levels.map((lv, i) => (
              <span key={i} className="card-level"><b>{lv.level}:</b> BP{lv.bp}</span>
            ))}
            {card.ocBoost && (
              <span className="card-oc"><b>{card.ocBoost.levelLabel}:</b> BP{card.ocBoost.bp}</span>
            )}
          </div>
        )}
      </div>
      <div className="card-controls">
        <button onClick={() => onDecrease && onDecrease(card.id)} className="minusBtn" disabled={countInDeck <= 0}>-</button>
        <span>{countInDeck} / {maxCount}</span>
        <button onClick={() => onIncrease && onIncrease(card.id)} className="plusBtn" disabled={countInDeck >= maxCount}>+</button>
      </div>
    </div>
  );
});

// CardGridItemもmemo化
const CardGridItem = React.memo(function CardGridItem({ columnIndex, rowIndex, style, data }) {
  const { cards, columns, getCardCountInDeck, onIncrease, onDecrease } = data;
  const index = rowIndex * columns + columnIndex;
  if (index >= cards.length) return null;
  const card = cards[index];
  const countInDeck = getCardCountInDeck ? getCardCountInDeck(card.id) : 0;
  const maxCount = card.maxDeckCount ?? 4;
  if (maxCount === 0) return null;
  // ダブルフェイスカード対応（表面優先）
  const isDoubleSided = card.isDoubleSided && card.front && card.back;
  const displayCard = isDoubleSided ? card.front : card;
  return (
    <div style={{ ...style, padding: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
      <div className="card-grid-img-wrap" style={gridImgWrapStyle}>
        <img src={displayCard.image} alt={displayCard.name} className="card-image" style={gridImgStyle} loading="lazy" />
        {countInDeck > 0 && (
          <span className="card-badge" style={badgeStyle}>{'①②③'[countInDeck - 1]}</span>
        )}
        <div style={gridBtnWrapStyle}>
          <button className="minusBtn" style={minusBtnStyle} onClick={handleMinus(onDecrease, card.id)} disabled={countInDeck <= 0}>-</button>
          <button className="plusBtn" style={plusBtnStyle} onClick={handlePlus(onIncrease, card.id)} disabled={countInDeck >= maxCount}>+</button>
        </div>
      </div>
    </div>
  );
});

const CardList = ({
  cards = cardData,
  getCardCountInDeck = () => 0,
  onIncrease,
  onDecrease,
  listSize = { width: Math.min(window.innerWidth, 600) - 72, height: 600 },
  view = 'list',
  onSwipeStart,
  onSwipeEnd,
}) => {
  const rowCount = Math.ceil(cards.length / GRID_COLUMNS);
  // List用のitemData
  const itemData = React.useMemo(() => ({ cards, getCardCountInDeck, onIncrease, onDecrease }), [cards, getCardCountInDeck, onIncrease, onDecrease]);
  const gridItemData = React.useMemo(() => ({ cards, columns: GRID_COLUMNS, getCardCountInDeck, onIncrease, onDecrease }), [cards, getCardCountInDeck, onIncrease, onDecrease]);
  return (
    <div
      className="card-list-container"
      style={{ width: listSize.width, maxWidth: 600 }}
      onTouchStart={onSwipeStart}
      onTouchEnd={onSwipeEnd}
      onPointerDown={onSwipeStart}
      onPointerUp={onSwipeEnd}
    >
      <div style={{ textAlign: 'right', marginBottom: 8 }}>
        <button onClick={() => view !== 'list' && onIncrease && onIncrease('list')} disabled={view === 'list'}>リスト表示</button>
        <button onClick={() => view !== 'grid' && onIncrease && onIncrease('grid')} disabled={view === 'grid'} style={{ marginLeft: 8 }}>グリッド表示</button>
      </div>
      {view === 'list' ? (
        <List
          height={listSize.height}
          itemCount={cards.length}
          itemSize={72}
          width={listSize.width}
          itemData={itemData}
          itemKey={index => cards[index]?.id || index}
          overscanCount={3}
        >
          {CardItem}
        </List>
      ) : (
        <Grid
          height={listSize.height}
          columnCount={GRID_COLUMNS}
          columnWidth={Math.floor(listSize.width / GRID_COLUMNS)}
          rowCount={rowCount}
          rowHeight={160}
          width={listSize.width}
          itemData={gridItemData}
        >
          {CardGridItem}
        </Grid>
      )}
    </div>
  );
};

export default CardList;
