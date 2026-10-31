-- ============================================
-- Supabase: preview_cards テーブル + Storage バケット
-- 用途: 公式X (@ACG_TCG) から取り込んだ未公開カードの管理
-- 作成日: 2026-05-21
-- ============================================
-- 実行手順:
--   1. Supabase Dashboard → SQL Editor に貼り付けて実行
--   2. Storage → New bucket → 名前 "preview-card-images" / Public: ON
--      （または下部の DO ブロックを使用して自動作成）
-- 前提:
--   - supabase_rls_policies.sql の is_admin() 関数が既に存在すること
-- ============================================


-- ============================================
-- 1. preview_cards テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS public.preview_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ゲーム種別 (decks/events と同じ慣習。ACG 専用機能だが将来用に列を持つ)
  game text NOT NULL DEFAULT 'acg',

  -- 入力経路の記録 (パイプライン改善の材料)
  source_type text NOT NULL CHECK (source_type IN ('x_url', 'x_upload', 'x_paste')),

  -- 元画像の出所 (pbs.twimg.com URL など、URL 経由時のみ。ファイル直接の場合は NULL)
  source_url text,

  -- Supabase Storage に再ホストした永続URL (X CDN の長期保持が保証されないため再ホスト)
  permanent_image_url text NOT NULL,

  -- LLM 抽出結果 (cardData.generated.js のカードスキーマに合わせた JSON)
  card_data jsonb NOT NULL,

  -- フィールド別 confidence (例: {"name": "high", "cost": "high", "effect": "medium"})
  confidence jsonb,

  -- 承認ステータス
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('auto_approved', 'pending', 'rejected', 'superseded')),

  -- レビュー実施者と時刻
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,

  -- 公式反映後にどのカード番号で上書きされたか (reconciliation 時に記録)
  superseded_by_card_number text,

  -- 取り込み元のXポストURL (運営者が手動で記録するメモ、任意)
  source_post_url text,

  -- 自由メモ (LLM の判定理由や運営者のコメント)
  notes text
);

CREATE INDEX IF NOT EXISTS idx_preview_cards_game_status
  ON public.preview_cards (game, status, created_at DESC);


-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS preview_cards_set_updated_at ON public.preview_cards;
CREATE TRIGGER preview_cards_set_updated_at
  BEFORE UPDATE ON public.preview_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ============================================
-- 2. RLS ポリシー
-- ============================================
ALTER TABLE public.preview_cards ENABLE ROW LEVEL SECURITY;

-- 全ユーザー (匿名含む) は auto_approved な preview を読み取り可能
-- (フロントで「公式未公開」バッジ付きで表示するため)
CREATE POLICY "preview_cards_select_approved"
  ON public.preview_cards FOR SELECT
  USING (status = 'auto_approved');

-- 管理者は全ステータスを読み取り可能 (pending レビュー画面用)
CREATE POLICY "preview_cards_select_admin"
  ON public.preview_cards FOR SELECT
  USING (public.is_admin());

-- 管理者のみ INSERT 可能 (Netlify Function 経由でも実質これを使う)
-- Netlify Function が service_role key で書き込む場合は RLS を bypass するので
-- このポリシーは admin UI 直接書き込み用のフォールバック
CREATE POLICY "preview_cards_insert_admin"
  ON public.preview_cards FOR INSERT
  WITH CHECK (public.is_admin());

-- 管理者のみ UPDATE 可能 (status 変更、編集)
CREATE POLICY "preview_cards_update_admin"
  ON public.preview_cards FOR UPDATE
  USING (public.is_admin());

-- 管理者のみ DELETE 可能 (reconciliation 時の物理削除も含む)
CREATE POLICY "preview_cards_delete_admin"
  ON public.preview_cards FOR DELETE
  USING (public.is_admin());


-- ============================================
-- 3. Storage バケット: preview-card-images
-- ============================================
-- 手動で Dashboard → Storage → New bucket でも可。
-- Public バケットとして作成 (フロントから直接画像URLで参照するため)
INSERT INTO storage.buckets (id, name, public)
VALUES ('preview-card-images', 'preview-card-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: バケット内オブジェクトのアクセスポリシー
-- 全員が読み取り可能 (Public bucket だが念のため明示)
CREATE POLICY "preview_card_images_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'preview-card-images');

-- 管理者のみアップロード可能
CREATE POLICY "preview_card_images_insert_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'preview-card-images' AND public.is_admin());

-- 管理者のみ削除可能 (reconciliation で公式版に置き換わったときの掃除用)
CREATE POLICY "preview_card_images_delete_admin"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'preview-card-images' AND public.is_admin());


-- ============================================
-- 4. 動作確認用クエリ (実行不要、参考)
-- ============================================
-- 自分が admin かどうか
--   SELECT public.is_admin();
--
-- preview_cards テーブルの内容を確認
--   SELECT id, source_type, status, card_data->'name' AS name, created_at
--     FROM public.preview_cards
--     WHERE game = 'acg'
--     ORDER BY created_at DESC;
--
-- Storage バケット一覧
--   SELECT id, name, public FROM storage.buckets;
