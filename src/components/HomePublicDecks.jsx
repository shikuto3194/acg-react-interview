/**
 * HomePublicDecks.jsx
 * 「みんなのデッキ」セクション。
 * - ホームタブの「最新情報」配下の最後に表示
 * - 公開中デッキの直近 10 件をリスト表示
 * - 0 件の場合はセクションごと非表示
 *
 * クリック時の挙動は親（App.jsx）に委ねる: onDeckClick(deck) → 詳細モーダルを開く
 */
import { useEffect, useState } from 'react';
import baseCardData from '../cardData';
import { fetchPublicDecks } from '../useDeckCloud.js';
import { rehydrateCards, collectRelatedTokensFromCards } from '../utils/deckUtils';

const HOME_DECK_LIMIT = 10;
const cardLookup = new Map(baseCardData.map(c => [Number(c.id), c]));

/**
 * デッキのサムネイル画像URLを取得（保存デッキ一覧と同じロジック）
 */
function resolveThumbnail(deck) {
  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  const thumbFromCards = cards.find(c => c.isDeckThumbnail)?.id ?? cards[0]?.id ?? null;
  const thumbFromTokens = (() => {
    const td = deck.tokenDeck;
    if (Array.isArray(td)) return td.find(t => (Number(t?.count) || 0) > 0)?.id ?? null;
    return null;
  })();
  const thumbId = deck.thumbnailCardId ?? thumbFromCards ?? thumbFromTokens;
  if (!thumbId) return null;
  const card = cardLookup.get(Number(thumbId));
  if (!card) return null;
  const isDoubleSided = card.isDoubleSided && card.front && card.back;
  const displayCard = isDoubleSided ? card.front : card;
  return displayCard?.image ?? null;
}

/**
 * @param {Object} props
 * @param {(deck: Object) => void} props.onDeckClick - デッキ行クリック時に呼ばれる
 * @param {() => void} [props.onShowAll] - 「投稿されたデッキ一覧へ↗」リンク押下時に呼ばれる
 * @param {number} [props.refreshKey=0] - 値を変えると再フェッチ（公開直後の反映用）
 */
export default function HomePublicDecks({ onDeckClick, onShowAll, refreshKey = 0 }) {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPublicDecks({ limit: HOME_DECK_LIMIT }).then((result) => {
      if (!alive) return;
      setDecks(result);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  // ローディング中も 0 件時もセクション非表示（チラつき防止）
  if (loading || decks.length === 0) return null;

  return (
    <div style={{ margin: '1.4em 0 1em 0' }}>
      {/* コミュニティの区切り線 */}
      <div style={{ borderTop: '2px dashed #bbb', paddingTop: '0.6em', marginTop: '0.6em' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6em', flexWrap: 'wrap', borderBottom: '2px solid #f57c00', paddingBottom: 4, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.05em', color: '#f57c00' }}>みんなのデッキ</h3>
          <span style={{ fontSize: '0.78em', color: '#666' }}>
            ユーザー投稿（直近 {decks.length} 件）
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
          {decks.map(deck => {
            const thumb = resolveThumbnail(deck);
            return (
              <div
                key={deck._cloudId}
                onClick={() => {
                  // 親に渡すために cards を再水和（rehydrateCards + relatedTokens を付与）
                  const hydratedCards = rehydrateCards(deck.cards);
                  const relatedTokens = collectRelatedTokensFromCards(hydratedCards);
                  onDeckClick?.({
                    ...deck,
                    cards: hydratedCards,
                    relatedTokens,
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.7em',
                  padding: '0.5em 0.6em', borderRadius: 8,
                  background: '#fafafa', border: '1px solid #eee', cursor: 'pointer',
                }}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt="サムネイル"
                    style={{ width: 40, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 40, height: 54, borderRadius: 6, background: '#eee', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {deck.name}
                  </div>
                  <div style={{ fontSize: '0.8em', color: '#666' }}>
                    by {deck.displayName}
                  </div>
                  {deck.tags && deck.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', marginTop: 2 }}>
                      {deck.tags.slice(0, 3).map(t => (
                        <span key={t} style={{ background: '#e3f2fd', color: '#1976d2', borderRadius: 999, padding: '0.05em 0.5em', fontSize: '0.72em' }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* 右半分: description (3行で「…」省略、縦幅拡大はしない) */}
                {deck.description && deck.description.trim() && (
                  <div style={{
                    flex: 1, minWidth: 0,
                    color: '#555', fontSize: '0.8em',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {deck.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 全件ページへ遷移 */}
        {onShowAll && (
          <div style={{ textAlign: 'right', marginTop: '0.6em' }}>
            <button
              onClick={onShowAll}
              style={{
                background: 'none', border: 'none',
                color: '#f57c00', fontSize: '0.88em', cursor: 'pointer',
                padding: '0.3em 0.2em',
              }}
            >
              投稿されたデッキ一覧へ ↗
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
