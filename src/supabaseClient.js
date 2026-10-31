import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が必要です');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// このアプリ (ACG マネージャー) は BS 版オリカツールと同じ Supabase プロジェクトを共有しているため、
// decks テーブルの行を game 列で分離する。BS 側のクエリは default 'bs' により従来通り動作する。
export const APP_GAME_ID = 'acg';
