-- ============================================
-- Supabase: acg_pack_seen テーブル
-- 用途: 公式の「弾 (パック) プレフィックス」の初出日を記録する。
--       reconcile-preview-cards.mjs の時間ベース自動退役で
--       「そのプレビュー追加より後に新弾が出たか」を判定するために使う。
-- 作成日: 2026-06-27
-- ============================================
-- 実行手順: Supabase Dashboard → SQL Editor に貼り付けて実行 (1回のみ)
-- アクセス: service role (Netlify build) のみ。RLS 有効・公開ポリシーは作らない
--           (service role は RLS をバイパスするため読み書き可能)。
--
-- 動作メモ:
--   - reconcile が毎回 public/images から現在の弾プレフィックスを集計し、
--     未登録のものだけ first_seen_at=now() で INSERT する (既存は保持)。
--   - 初回実行時は既存の全弾が now() で登録される。その結果、初回は
--     「2か月以上前の保留プレビュー」が一括退役される (= 現行バックログの掃除)。
--     2回目以降は新規に出現した弾だけが新しい first_seen_at を持つため、
--     「プレビュー追加より後に出た弾」だけが退役条件を満たす (各カード基準)。
-- ============================================

CREATE TABLE IF NOT EXISTS public.acg_pack_seen (
  prefix text PRIMARY KEY,                       -- 例: 'BP5', 'SD2', 'RYO'
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acg_pack_seen ENABLE ROW LEVEL SECURITY;
-- 公開ポリシーは意図的に作らない。service role (ビルド) のみがアクセスする。
