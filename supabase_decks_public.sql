-- ============================================
-- Supabase: decks テーブルにデッキ公開機能用カラムを追加
-- 用途: ユーザーが自分のデッキをコミュニティに公開する仕組み
-- 作成日: 2026-05-23
-- ============================================
-- 実行手順:
--   1. Supabase Dashboard → SQL Editor に貼り付けて実行
-- 前提:
--   - supabase_rls_policies.sql の decks テーブル + decks_select_own 等が存在
-- ============================================


-- ============================================
-- 1. カラム追加
-- ============================================
-- is_public:           公開フラグ。デフォルト false（公開漏れ防止）
-- description:         デッキ説明（任意, 〜500字を想定だが DB 側では制限しない）
-- tags:                自由入力タグ配列（任意, 最大5を想定）
-- posted_at:           初回公開日時。is_public = false → true 遷移時にのみ書き込む
-- content_updated_at:  公開後の内容更新日時。並び順用に別管理
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS is_public           boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description         text,
  ADD COLUMN IF NOT EXISTS tags                text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS posted_at           timestamptz,
  ADD COLUMN IF NOT EXISTS content_updated_at  timestamptz;


-- ============================================
-- 2. インデックス
-- ============================================
-- 公開デッキ一覧の並び順用: COALESCE(content_updated_at, posted_at) DESC
-- 部分インデックスで公開中のもののみ。タグ検索用 GIN は将来のタグ機能で追加検討。
CREATE INDEX IF NOT EXISTS idx_decks_public_recent
  ON public.decks (game, COALESCE(content_updated_at, posted_at) DESC)
  WHERE is_public = true;


-- ============================================
-- 3. RLS ポリシー
-- ============================================
-- 既存の decks_select_own は「自分のデッキだけ閲覧」だが、
-- 公開デッキは認証済みユーザー全員が閲覧できる必要があるため別ポリシーを追加。
-- （未認証ユーザーには非公開。事前ログイン必須の運用想定。
--  匿名公開する場合は USING の auth.uid() IS NOT NULL 部分を外す）

CREATE POLICY "decks_select_public"
  ON public.decks FOR SELECT
  USING (is_public = true AND auth.uid() IS NOT NULL);


-- ============================================
-- 4. 動作確認用クエリ (実行不要、参考)
-- ============================================
-- 公開中デッキ一覧（新着順, ACG のみ）
--   SELECT id, name, description, tags, posted_at, content_updated_at, user_id
--     FROM public.decks
--     WHERE game = 'acg' AND is_public = true
--     ORDER BY COALESCE(content_updated_at, posted_at) DESC
--     LIMIT 10;
--
-- 自分のデッキの公開状態を確認
--   SELECT name, is_public, posted_at, content_updated_at
--     FROM public.decks
--     WHERE user_id = auth.uid() AND game = 'acg';
