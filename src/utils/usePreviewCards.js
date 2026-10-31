/**
 * usePreviewCards.js
 * Supabase の preview_cards テーブルから「公式未公開のプレビューカード」を取得し、
 * 通常の cardData と同じスキーマに正規化して返すフック。
 *
 * 仕様:
 *   - type='プレビュー' で正規化（フィルタ・表示の特別扱いはこの type で行う）
 *   - 効果テキスト・コスト・色・ATK/DEF 等の構造化データは持たない（画像のみ）
 *   - id は通常カードと衝突しないよう PREVIEW_ID_BASE 以降。行の uuid から決定的に導出する
 *   - status='superseded' (公式反映後に reconcile で退役済み) は除外
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// プレビューカードの id 起点 (通常カードの id 1-502 と衝突しないよう確保)。
// デッキ内のカードが PREVIEW_ID_BASE 以上なら preview と判定できる (イベント登録チェック等で使用)。
export const PREVIEW_ID_BASE = 1_000_000;
const PREVIEW_ID_SPAN = 1_000_000; // 1,000,000 - 1,999,999

export function isPreviewCardId(id) {
  return Number(id) >= PREVIEW_ID_BASE;
}

/**
 * preview_cards.id (uuid) から ID を決定的に導出する。
 *
 * 以前は取得順の連番 (PREVIEW_ID_BASE + i) だったため、1 枚でも退役 (superseded) すると
 * それ以降のプレビューカードの ID が全てずれ、保存済みデッキのカードが別カードに
 * すり替わっていた。uuid から導出すれば他の行の増減に影響されない。
 *
 * @param {string} uuid
 * @param {Set<number>} taken 既に使用済みの ID (衝突時のみ 1 ずつずらす)
 */
export function previewIdFromUuid(uuid, taken = new Set()) {
  let h = 0x811c9dc5;
  const s = String(uuid);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  for (let probe = 0; probe < PREVIEW_ID_SPAN; probe++) {
    const id = PREVIEW_ID_BASE + ((h + probe) % PREVIEW_ID_SPAN);
    if (!taken.has(id)) return id;
  }
  return PREVIEW_ID_BASE;
}

export function usePreviewCards() {
  const [previewCards, setPreviewCards] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('preview_cards')
        .select('id, tentative_card_number, display_label, permanent_image_url, status, created_at')
        .eq('game', 'acg')
        .in('status', ['pending', 'auto_approved'])
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error || !data) {
        console.warn('preview_cards 取得失敗:', error);
        return;
      }
      const takenIds = new Set();
      const normalized = data.map((row) => {
        const id = previewIdFromUuid(row.id, takenIds);
        takenIds.add(id);
        return {
          id,
          previewId: row.id,
          name: row.display_label || row.tentative_card_number || 'プレビュー',
          ruby: '',
          cardNumber: row.tentative_card_number || '',
          kindKey: row.tentative_card_number || `PREVIEW-${row.id}`,
          cost: '',
          color: [],
          reduction: [],
          conditionRaw: '',
          type: 'プレビュー',
          tribe: '',
          symbol: [],
          rarity: '',
          pack: 'プレビュー',
          atk: undefined,
          def: undefined,
          effect: '',
          image: row.permanent_image_url,
          maxDeckCount: 4,
          maxTokenDeckCount: 0,
          isPreview: true,
        };
      });
      setPreviewCards(normalized);
    })();
    return () => { cancelled = true; };
  }, []);

  return previewCards;
}
