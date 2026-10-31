/**
 * DeckSubmitModal.jsx
 * デッキを「みんなのデッキ」に公開するためのフォーム + プレビューモーダル。
 *
 * ベースレイアウトは src/components/DeckDetailView.jsx と共通だが、
 * 上部に公開情報フォーム、下部に「キャンセル / このデッキを公開」ボタンを持つ。
 *
 * 動作:
 *   - 開いた時、deck.description / deck.tags があれば初期値として読み込む
 *     さらに localStorage の下書き (deckSubmitDraft_v1_<name>) があればそちらで上書き
 *   - フォーム入力は debounced で localStorage に下書き保存
 *   - 公開成功時に下書きを削除
 *   - キャンセル時は下書きを残す（再開可能）
 *   - プレビューカード (公式未公開) を含むデッキは公開不可（X リーク防止）
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { toAbsPath } from '../utils/deckUtils';
import { isPreviewCardId } from '../utils/usePreviewCards';
import { upsertCloudDeck } from '../useDeckCloud.js';
import DeckDetailView from './DeckDetailView';

const DRAFT_KEY_PREFIX = 'deckSubmitDraft_v1_';
const DRAFT_DEBOUNCE_MS = 500;
const MAX_TITLE_LEN = 60;
const MAX_DESCRIPTION_LEN = 500;
const MAX_TAGS = 5;

/** デッキ内にプレビューカードが含まれているか (EventsPage と同等の判定) */
function deckContainsPreview(deck) {
  if (!deck) return false;
  if (Array.isArray(deck.cards) && deck.cards.some(c => (c.count || 0) > 0 && isPreviewCardId(c.id))) {
    return true;
  }
  const td = deck.tokenDeck;
  if (Array.isArray(td) && td.some(t => (t.count || 0) > 0 && isPreviewCardId(t.id))) return true;
  if (td && typeof td === 'object' && !Array.isArray(td)) {
    if (Object.entries(td).some(([id, count]) => (Number(count) || 0) > 0 && isPreviewCardId(id))) return true;
  }
  return false;
}

/**
 * @param {Object} props
 * @param {Object} props.deck            - 公開対象のデッキ (savedDecks の要素を hydrate したもの)
 * @param {string} props.userId          - Supabase ユーザーID
 * @param {Function} props.onClose       - キャンセル/閉じる時のコールバック
 * @param {Function} props.onSubmitted   - 公開成功時のコールバック (引数: 更新済みデッキ)
 * @param {Function} [props.onCardClick] - カードクリック時のコールバック (CardDetailModal を開く用)
 */
export default function DeckSubmitModal({ deck, userId, onClose, onSubmitted, onCardClick }) {
  const draftKey = useMemo(
    () => DRAFT_KEY_PREFIX + (deck?.name || ''),
    [deck?.name]
  );

  // ---- フォーム状態 ----
  // 初期値: 下書きがあれば下書き、なければ deck の既存値、なければ空
  const initial = useMemo(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        return {
          title: draft.title ?? deck?.name ?? '',
          description: draft.description ?? '',
          tags: Array.isArray(draft.tags) ? draft.tags : [],
        };
      }
    } catch {
      // 下書きの parse 失敗時は無視して既存値を使う
    }
    return {
      title: deck?.name ?? '',
      description: deck?.description ?? '',
      tags: Array.isArray(deck?.tags) ? deck.tags : [],
    };
  }, [draftKey, deck?.name, deck?.description, deck?.tags]);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [tags, setTags] = useState(initial.tags);
  const [tagInput, setTagInput] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // ---- 下書きの debounced 保存 ----
  const draftTimerRef = useRef(null);
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          title, description, tags,
          savedAt: new Date().toISOString(),
        }));
      } catch {
        // localStorage 失敗は無視（容量超過時など）
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [draftKey, title, description, tags]);

  // ---- サムネ画像取得 ----
  const thumbImage = useMemo(() => {
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];
    const card = cards.find(c => c.isDeckThumbnail) || cards[0];
    if (!card) return null;
    const isDoubleSided = card.isDoubleSided && card.front && card.back;
    const displayCard = isDoubleSided ? card.front : card;
    return displayCard?.image ?? null;
  }, [deck?.cards]);

  // ---- タグ追加 ----
  const addTag = () => {
    const t = tagInput.trim().replace(/^[#＃]/, '');
    if (!t) return;
    if (tags.length >= MAX_TAGS) {
      setErrorMsg(`タグは最大 ${MAX_TAGS} 個までです`);
      return;
    }
    if (tags.includes(t)) {
      setTagInput('');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
    setErrorMsg('');
  };
  const removeTag = (t) => setTags(tags.filter(x => x !== t));

  // ---- バリデーション + 送信 ----
  const handleSubmit = async () => {
    setErrorMsg('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg('タイトルを入力してください');
      return;
    }
    if (trimmedTitle.length > MAX_TITLE_LEN) {
      setErrorMsg(`タイトルは ${MAX_TITLE_LEN} 文字以内にしてください`);
      return;
    }
    if (description.length > MAX_DESCRIPTION_LEN) {
      setErrorMsg(`説明は ${MAX_DESCRIPTION_LEN} 文字以内にしてください`);
      return;
    }
    if (deckContainsPreview(deck)) {
      setErrorMsg('プレビューカード (公式未公開) を含むデッキは公開できません');
      return;
    }
    if (!userId) {
      setErrorMsg('ログインが必要です');
      return;
    }

    setSubmitting(true);
    // 既存の name を保ったまま公開フィールドを書き込む。
    // タイトル変更時は deck.name は変えず、description 等のみ更新する想定（v1）。
    // ※ name 変更を許可すると同名衝突や履歴消失の処理が複雑なので別途検討。
    const result = await upsertCloudDeck(userId, {
      ...deck,
      description: description.trim(),
      tags,
      isPublic: true,
    });
    setSubmitting(false);

    if (result.error) {
      setErrorMsg(`公開に失敗しました: ${result.error.message || result.error}`);
      return;
    }

    // 成功 → 下書きクリア
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }

    onSubmitted?.({
      ...deck,
      description: description.trim(),
      tags,
      isPublic: true,
    });
  };

  if (!deck) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, padding: '1.2em 1em 1em 1em', maxWidth: 540, width: '95vw', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          style={{ position: 'absolute', top: 8, right: 12, fontSize: '1.3em', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={onClose}
        >
          ×
        </button>

        {/* ---- サムネ単独表示 ---- */}
        <div style={{ marginBottom: '0.8em' }}>
          {thumbImage ? (
            <img
              src={toAbsPath(thumbImage)}
              alt="サムネイル"
              style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid #1976d2' }}
            />
          ) : (
            <div style={{ width: 48, height: 64, borderRadius: 8, background: '#eee' }} />
          )}
        </div>

        {/* ---- 公開情報フォーム ---- */}
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '0.8em', marginBottom: '0.8em' }}>
          <div style={{ fontWeight: 'bold', color: '#1976d2', marginBottom: '0.5em' }}>公開情報</div>

          <label style={{ display: 'block', marginBottom: '0.6em' }}>
            <span style={{ display: 'block', fontSize: '0.85em', color: '#555', marginBottom: 2 }}>タイトル <span style={{ color: '#d32f2f' }}>*</span></span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LEN}
              placeholder="このデッキのタイトル"
              style={{ width: '100%', padding: '0.4em 0.6em', border: '1px solid #bbb', borderRadius: 6, fontSize: '0.95em' }}
            />
          </label>

          <label style={{ display: 'block', marginBottom: '0.6em' }}>
            <span style={{ display: 'block', fontSize: '0.85em', color: '#555', marginBottom: 2 }}>説明・コンセプト</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={MAX_DESCRIPTION_LEN}
              placeholder="使い方／キーカード／対面相性 など"
              style={{ width: '100%', padding: '0.4em 0.6em', border: '1px solid #bbb', borderRadius: 6, fontSize: '0.95em', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ textAlign: 'right', fontSize: '0.75em', color: '#888' }}>
              {description.length} / {MAX_DESCRIPTION_LEN}
            </div>
          </label>

          <div style={{ marginBottom: '0.6em' }}>
            <span style={{ display: 'block', fontSize: '0.85em', color: '#555', marginBottom: 4 }}>タグ（最大 {MAX_TAGS} 個）</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4em', alignItems: 'center' }}>
              {tags.map(t => (
                <span
                  key={t}
                  style={{ background: '#e3f2fd', color: '#1976d2', borderRadius: 999, padding: '0.15em 0.6em', fontSize: '0.85em', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  #{t}
                  <button
                    onClick={() => removeTag(t)}
                    style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '1.1em' }}
                    aria-label={`タグ ${t} を削除`}
                  >×</button>
                </span>
              ))}
              {tags.length < MAX_TAGS && (
                <>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="+ 追加"
                    style={{ flex: '0 1 8em', padding: '0.2em 0.5em', border: '1px solid #bbb', borderRadius: 6, fontSize: '0.85em' }}
                  />
                  <button
                    onClick={addTag}
                    style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6, padding: '0.25em 0.7em', fontSize: '0.8em', cursor: 'pointer' }}
                  >追加</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---- デッキ内容プレビュー (基礎見出し付き) ---- */}
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '0.8em' }}>
          <DeckDetailView
            deck={deck}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onCardClick={onCardClick || (() => {})}
            showMainHeader={true}
          />
        </div>

        {/* ---- エラー表示 ---- */}
        {errorMsg && (
          <div
            style={{ background: '#ffebee', color: '#c62828', padding: '0.5em 0.8em', borderRadius: 6, marginTop: '0.6em', fontSize: '0.9em' }}
            role="alert"
          >
            {errorMsg}
          </div>
        )}

        {/* ---- アクションボタン ---- */}
        <div
          style={{ borderTop: '1px solid #ddd', marginTop: '0.8em', paddingTop: '0.8em', display: 'flex', justifyContent: 'space-between', gap: '0.6em' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ background: '#e0e0e0', color: '#333', border: 'none', borderRadius: 6, padding: '0.6em 1.2em', fontSize: '0.95em', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ background: '#f57c00', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6em 1.4em', fontSize: '0.95em', fontWeight: 'bold', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? '公開中…' : (deck.isPublic ? '更新を公開' : 'このデッキを公開')}
          </button>
        </div>
      </div>
    </div>
  );
}
