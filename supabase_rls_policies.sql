-- ============================================
-- Supabase RLS (Row-Level Security) ポリシー設定
-- プロジェクト: nnthvbizvqpufpfkzlho
-- 作成日: 2026-04-08
-- ============================================
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて実行
-- 注意: 既存のポリシーがある場合はエラーになるので、
--       その場合は該当ポリシーを削除してから再実行してください
-- ============================================

-- ============================================
-- ヘルパー関数: 管理者チェック
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================
-- 1. profiles テーブル
-- ============================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 自分のプロフィールを読み取り可能
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

-- 他ユーザーのプロフィールも読み取り可能（表示名の表示に必要）
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 自分のプロフィールを作成可能
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 自分のプロフィールを更新可能
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 注意: profiles の DELETE は不要（ユーザー削除はAuth側で管理）


-- ============================================
-- 2. decks テーブル
-- ============================================
-- 予備デッキ列追加 (既存スキーマに side_deck JSONB を追加。なければ無視される)
ALTER TABLE public.decks ADD COLUMN IF NOT EXISTS side_deck JSONB DEFAULT '[]'::jsonb;

-- ゲーム種別の分離: BS (バトスピ orika) と ACG (アニマルカードゲーム) で同じ decks テーブルを共有しており、
-- 両アプリは別ドメインにデプロイされる。誤って相手側のデッキを読み込むのを防ぐため game 列を追加する。
-- DEFAULT 'bs' により、既存行および BS 側からの INSERT は従来通り 'bs' 扱いとなる。
-- ACG 側からの保存・読み込みは明示的に game = 'acg' を指定する。
-- ACG として残したい既存デッキがあれば手動で UPDATE すること:
--   UPDATE public.decks SET game = 'acg' WHERE id = '...';
ALTER TABLE public.decks ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'bs';
CREATE INDEX IF NOT EXISTS idx_decks_user_game ON public.decks (user_id, game);

ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;

-- 自分のデッキのみ読み取り可能
CREATE POLICY "decks_select_own"
  ON public.decks FOR SELECT
  USING (auth.uid() = user_id);

-- 自分のデッキを作成可能
CREATE POLICY "decks_insert_own"
  ON public.decks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 自分のデッキを更新可能
CREATE POLICY "decks_update_own"
  ON public.decks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 自分のデッキを削除可能
CREATE POLICY "decks_delete_own"
  ON public.decks FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================
-- 3. events テーブル
-- ============================================
-- ゲーム種別の分離: decks 列と同様、events も BS と ACG で同じテーブルを共有しており、
-- 両アプリ側で一覧クエリに game フィルタを追加する。
-- DEFAULT 'bs' により既存行および BS 側からの INSERT は 'bs' 扱い。
-- ACG として残したい既存イベントは手動で UPDATE すること:
--   UPDATE public.events SET game = 'acg' WHERE id = '...';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'bs';
CREATE INDEX IF NOT EXISTS idx_events_game_date ON public.events (game, date DESC);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーはイベント一覧を閲覧可能
CREATE POLICY "events_select_authenticated"
  ON public.events FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 管理者のみイベント作成可能
CREATE POLICY "events_insert_admin"
  ON public.events FOR INSERT
  WITH CHECK (public.is_admin());

-- 管理者のみイベント更新可能
CREATE POLICY "events_update_admin"
  ON public.events FOR UPDATE
  USING (public.is_admin());

-- 管理者のみイベント削除可能
CREATE POLICY "events_delete_admin"
  ON public.events FOR DELETE
  USING (public.is_admin());


-- ============================================
-- 4. event_participants テーブル
-- ============================================
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーは参加者一覧を閲覧可能（対戦相手の確認に必要）
CREATE POLICY "event_participants_select_authenticated"
  ON public.event_participants FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 自分を参加者として登録可能
CREATE POLICY "event_participants_insert_own"
  ON public.event_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 自分の参加情報を更新可能（デッキ登録等）
CREATE POLICY "event_participants_update_own"
  ON public.event_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 管理者も参加者情報を更新可能（管理目的）
CREATE POLICY "event_participants_update_admin"
  ON public.event_participants FOR UPDATE
  USING (public.is_admin());

-- 自分の参加を取り消し可能
CREATE POLICY "event_participants_delete_own"
  ON public.event_participants FOR DELETE
  USING (auth.uid() = user_id);

-- 管理者も参加者を削除可能
CREATE POLICY "event_participants_delete_admin"
  ON public.event_participants FOR DELETE
  USING (public.is_admin());


-- ============================================
-- 5. event_rounds テーブル
-- ============================================
ALTER TABLE public.event_rounds ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーはラウンド情報を閲覧可能
CREATE POLICY "event_rounds_select_authenticated"
  ON public.event_rounds FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 管理者のみラウンド作成可能
CREATE POLICY "event_rounds_insert_admin"
  ON public.event_rounds FOR INSERT
  WITH CHECK (public.is_admin());

-- 管理者のみラウンド更新可能
CREATE POLICY "event_rounds_update_admin"
  ON public.event_rounds FOR UPDATE
  USING (public.is_admin());

-- 管理者のみラウンド削除可能（ロールバック用）
CREATE POLICY "event_rounds_delete_admin"
  ON public.event_rounds FOR DELETE
  USING (public.is_admin());


-- ============================================
-- 6. round_matches テーブル
-- ============================================
ALTER TABLE public.round_matches ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーはマッチ情報を閲覧可能
CREATE POLICY "round_matches_select_authenticated"
  ON public.round_matches FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 管理者のみマッチ作成可能
CREATE POLICY "round_matches_insert_admin"
  ON public.round_matches FOR INSERT
  WITH CHECK (public.is_admin());

-- 自分が参加しているマッチの結果を報告可能
CREATE POLICY "round_matches_update_player"
  ON public.round_matches FOR UPDATE
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- 管理者はすべてのマッチを更新可能（紛争解決等）
CREATE POLICY "round_matches_update_admin"
  ON public.round_matches FOR UPDATE
  USING (public.is_admin());

-- 管理者のみマッチ削除可能（ロールバック用）
CREATE POLICY "round_matches_delete_admin"
  ON public.round_matches FOR DELETE
  USING (public.is_admin());
