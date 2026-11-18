/**
 * useDeckCloud.js
 * ログイン中のユーザーのデッキを Supabase と同期するためのフック
 *
 * 【仕組み】
 * - ログイン済み → Supabase からデッキを読み込み、保存・削除も Supabase に反映
 * - 未ログイン → 従来通り localStorage のみ（このフックは何もしない）
 *
 * 【BS との分離】
 * decks テーブルは BS 版オリカツールと共有しているため、全てのクエリで game = APP_GAME_ID
 * をフィルタ／挿入する。これにより別ドメインで動作する BS アプリのデッキを誤って表示・上書きしない。
 */
import { supabase, APP_GAME_ID } from './supabaseClient';
import { migrateSavedDeck } from './utils/deckIdMigration';

/**
 * Supabase からログインユーザーの全デッキを取得
 * @returns {Array} savedDecks 形式の配列
 */
export async function fetchCloudDecks(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('decks')
    .select('*')
    .eq('user_id', userId)
    .eq('game', APP_GAME_ID)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('デッキ取得エラー:', error.message);
    return [];
  }

  // Supabase の行 → アプリ内のデッキ形式に変換
  const decks = (data || []).map(row => ({
    _cloudId: row.id, // Supabase の行ID（内部管理用）
    name: row.name,
    cards: row.cards || [],
    tokenDeck: row.token_deck || [],
    sideDeck: row.side_deck || [],
    thumbnailCardId: row.thumbnail_card_id ?? null,
    // --- 公開機能用フィールド (supabase_decks_public.sql 参照) ---
    isPublic: row.is_public ?? false,
    description: row.description ?? '',
    tags: row.tags || [],
    postedAt: row.posted_at ?? null,
    contentUpdatedAt: row.content_updated_at ?? null,
  }));

  // 新弾追加でずれた旧世代の ID を補正し、直ったぶんはクラウドにも書き戻す
  // (書き戻しは cards/token_deck/side_deck のみ。公開日時などの並び順用フィールドは触らない)
  return decks.map(deck => {
    const migrated = migrateSavedDeck(deck);
    if (migrated === deck) return deck;
    supabase
      .from('decks')
      .update({
        cards: migrated.cards,
        token_deck: migrated.tokenDeck,
        side_deck: migrated.sideDeck,
        thumbnail_card_id: migrated.thumbnailCardId ?? null,
      })
      .eq('id', migrated._cloudId)
      .then(({ error: e }) => {
        if (e) console.warn('[fetchCloudDecks] ID 補正の書き戻しに失敗:', e.message);
      });
    return migrated;
  });
}

/**
 * デッキを1件 Supabase に保存（新規 or 上書き）
 *
 * 公開フィールド (isPublic/description/tags) は呼び出し側が供給した時のみ更新。
 * 公開中デッキの内容変更時は content_updated_at が自動で now() に更新される（並び順用）。
 *
 * @returns {{ error: Error|null, action: 'insert'|'update'|null }}
 */
export async function upsertCloudDeck(userId, deck) {
  if (!userId) return { error: new Error('userId が空です'), action: null };

  // 既存デッキを名前で検索（同名デッキでも BS 側のものは別レコード扱い）
  const { data: existing, error: selectError } = await supabase
    .from('decks')
    .select('id, is_public, posted_at')
    .eq('user_id', userId)
    .eq('game', APP_GAME_ID)
    .eq('name', deck.name)
    .maybeSingle();

  if (selectError) {
    console.error('[upsertCloudDeck] 既存検索エラー:', selectError);
    return { error: selectError, action: null };
  }

  const nowIso = new Date().toISOString();

  const row = {
    user_id: userId,
    game: APP_GAME_ID,
    name: deck.name,
    cards: deck.cards || [],
    token_deck: deck.tokenDeck || [],
    side_deck: deck.sideDeck || [],
    thumbnail_card_id: deck.thumbnailCardId ?? null,
    updated_at: nowIso,
  };

  // --- 公開機能用フィールド (供給された場合のみ書き込む。
  //     通常の保存時は触らないことで既存フィールドを保護する) ---
  if (deck.isPublic !== undefined) {
    row.is_public = !!deck.isPublic;
  }
  if (deck.description !== undefined) {
    row.description = deck.description ?? null;
  }
  if (deck.tags !== undefined) {
    row.tags = Array.isArray(deck.tags) ? deck.tags : [];
  }

  // 保存後に公開状態となるか（明示指定 / 暗黙的に既存値を保持）
  const willBePublic = deck.isPublic === true
    || (deck.isPublic === undefined && !!existing?.is_public);

  // posted_at: 初回公開時のみ書き込む（以後不変）
  if (deck.isPublic === true && !existing?.is_public && !existing?.posted_at) {
    row.posted_at = nowIso;
  }

  // content_updated_at: 公開中デッキの保存時に更新（みんなのデッキの並び順用）
  // 通常の autosave でも公開デッキの編集は「内容更新」とみなして反映する。
  if (willBePublic) {
    row.content_updated_at = nowIso;
  }

  if (existing) {
    const { data, error } = await supabase
      .from('decks')
      .update(row)
      .eq('id', existing.id)
      .select();
    if (error) {
      console.error('[upsertCloudDeck] 上書きエラー:', error);
      return { error, action: 'update' };
    }
    console.log('[upsertCloudDeck] 上書き成功:', deck.name, 'rows:', data?.length ?? 0);
    return { error: null, action: 'update' };
  } else {
    const { data, error } = await supabase
      .from('decks')
      .insert(row)
      .select();
    if (error) {
      console.error('[upsertCloudDeck] 新規保存エラー:', error);
      return { error, action: 'insert' };
    }
    console.log('[upsertCloudDeck] 新規保存成功:', deck.name, 'rows:', data?.length ?? 0);
    return { error: null, action: 'insert' };
  }
}

/**
 * デッキを1件 Supabase から削除（名前で特定）
 * @returns {{ error: Error|null }}
 */
export async function deleteCloudDeck(userId, deckName) {
  if (!userId) return { error: new Error('userId が空です') };
  const { error } = await supabase
    .from('decks')
    .delete()
    .eq('user_id', userId)
    .eq('game', APP_GAME_ID)
    .eq('name', deckName);
  if (error) {
    console.error('[deleteCloudDeck] 削除エラー:', error);
    return { error };
  }
  console.log('[deleteCloudDeck] 削除成功:', deckName);
  return { error: null };
}

/**
 * 公開中のデッキ一覧を取得（「みんなのデッキ」用）
 *
 * 並び順は SQL の COALESCE(content_updated_at, posted_at) DESC と等価:
 *   1. content_updated_at (NOT NULL 優先) DESC
 *   2. posted_at DESC
 *
 * 投稿者の表示名は profiles から user_id でルックアップして付与する。
 * (FK 定義が無い前提で 2 クエリに分けている)
 *
 * @param {Object} [options]
 * @param {number} [options.limit=10]
 * @returns {Promise<Array>} { _cloudId, userId, displayName, name, cards, tokenDeck, sideDeck, thumbnailCardId, description, tags, postedAt, contentUpdatedAt }[]
 */
export async function fetchPublicDecks({ limit = 10 } = {}) {
  const { data: decks, error: e1 } = await supabase
    .from('decks')
    .select('id, user_id, name, cards, token_deck, side_deck, thumbnail_card_id, description, tags, posted_at, content_updated_at')
    .eq('game', APP_GAME_ID)
    .eq('is_public', true)
    .order('content_updated_at', { ascending: false, nullsFirst: false })
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (e1) {
    console.error('[fetchPublicDecks] 取得エラー:', e1.message);
    return [];
  }
  if (!decks || decks.length === 0) return [];

  // 投稿者の表示名をまとめて取得
  const userIds = [...new Set(decks.map(d => d.user_id).filter(Boolean))];
  let nameMap = new Map();
  if (userIds.length > 0) {
    const { data: profiles, error: e2 } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);
    if (e2) {
      console.warn('[fetchPublicDecks] プロフィール取得エラー (表示名なしで継続):', e2.message);
    } else if (profiles) {
      nameMap = new Map(profiles.map(p => [p.user_id, p.display_name]));
    }
  }

  // 他ユーザーのデッキは書き戻せないので、表示用にだけ ID を補正する
  return decks.map(row => migrateSavedDeck({
    _cloudId: row.id,
    userId: row.user_id,
    displayName: nameMap.get(row.user_id) || '名無し',
    name: row.name,
    cards: row.cards || [],
    tokenDeck: row.token_deck || [],
    sideDeck: row.side_deck || [],
    thumbnailCardId: row.thumbnail_card_id ?? null,
    description: row.description ?? '',
    tags: row.tags || [],
    postedAt: row.posted_at,
    contentUpdatedAt: row.content_updated_at,
    isPublic: true,
  }));
}

/**
 * localStorage のデッキを全て Supabase にアップロード（初回同期用）
 */
export async function uploadAllDecksToCloud(userId, decks) {
  if (!userId || !Array.isArray(decks) || decks.length === 0) return;
  for (const deck of decks) {
    await upsertCloudDeck(userId, deck);
  }
}
