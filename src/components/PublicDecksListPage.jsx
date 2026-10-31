/**
 * PublicDecksListPage.jsx
 * ホームタブ内のサブページ。「投稿されたデッキ一覧」全件ビュー。
 *
 * - HomePublicDecks の行レイアウトを踏襲（サムネ + 名前 + by + tags + description）
 * - 上部に「戻る」ボタン
 * - v1: 並び順は新着のみ、フィルター/ページネーション無し（最大 100 件取得）
 */
import { useEffect, useState } from 'react';
import baseCardData from '../cardData';
import { fetchPublicDecks } from '../useDeckCloud.js';
import { rehydrateCards, collectRelatedTokensFromCards } from '../utils/deckUtils';

const FULL_LIST_LIMIT = 100;
const cardLookup = new Map(baseCardData.map(c => [Number(c.id), c]));

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
 * @param {() => void} props.onBack             - 「戻る」ボタン押下
 * @param {(deck: Object) => void} props.onDeckClick - 行クリック → 詳細モーダル
 * @param {number} [props.refreshKey=0]
 */
export default function PublicDecksListPage({ onBack, onDeckClick, refreshKey = 0 }) {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPublicDecks({ limit: FULL_LIST_LIMIT }).then((result) => {
      if (!alive) return;
      setDecks(result);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  return (
    <div style={{ padding: '0.4em 0' }}>
      {/* ヘッダー: 戻る + タイトル */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: '0.8em' }}>
        <button
          onClick={onBack}
          style={{
            background: '#fff', border: '1px solid #bbb', borderRadius: 6,
            padding: '0.3em 0.7em', fontSize: '0.9em', cursor: 'pointer',
            color: '#333',
          }}
        >
          ← 戻る
        </button>
        <h2 style={{ margin: 0, fontSize: '1.15em', color: '#f57c00' }}>
          みんなのデッキ
        </h2>
        {!loading && (
          <span style={{ fontSize: '0.8em', color: '#666' }}>
            {decks.length} 件
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '1em', textAlign: 'center', color: '#888' }}>
          読み込み中…
        </div>
      ) : decks.length === 0 ? (
        <div style={{ padding: '1em', textAlign: 'center', color: '#888' }}>
          公開中のデッキはまだありません
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
          {decks.map(deck => {
            const thumb = resolveThumbnail(deck);
            return (
              <div
                key={deck._cloudId}
                onClick={() => {
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
      )}
    </div>
  );
}
