/**
 * EventsPage.jsx
 * イベント一覧 + イベント詳細（参加・デッキ登録・対戦結果表示・勝敗報告）
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase, APP_GAME_ID } from './supabaseClient';
import { useNavigate, useParams, Routes, Route } from 'react-router-dom';
import cardData from './cardData';
import DeckViewModal from './DeckViewModal';
import { isPreviewCardId } from './utils/usePreviewCards';
import { calculateStandings } from './utils/calculateStandings';
import { migrateParticipantDecks, migrateSavedDeck } from './utils/deckIdMigration';
import { containerStyle, cardStyle, btnPrimary, btnDanger, btnSecondary } from './styles/commonStyles';
const statusLabel = { recruiting: '📢 募集中', in_progress: '⚔️ 開催中', finished: '🏁 終了' };
const formatLabel = { swiss: 'スイスドロー', round_robin: '総当たり', single_elimination: 'トーナメント' };
const matchTypeLabel = { bo1: '1本先取', bo3: '2本先取(BO3)' };

// ========== デッキバリデーション ==========
const cardMap = {};
cardData.forEach(c => { cardMap[c.id] = c; });

/** デッキのメイン枚数を計算 */
function getMainDeckCount(cards) {
  if (!Array.isArray(cards)) return 0;
  return cards.reduce((sum, c) => sum + (c.count || 0), 0);
}

/** 2デッキ間のカード一致枚数を計算（同じカードIDのmin枚数の合計） */
function getOverlapCount(cards1, cards2) {
  if (!Array.isArray(cards1) || !Array.isArray(cards2)) return 0;
  const map2 = {};
  cards2.forEach(c => { if ((c.count || 0) > 0) map2[c.id] = c.count; });
  let overlap = 0;
  cards1.forEach(c => {
    if ((c.count || 0) > 0 && map2[c.id]) {
      overlap += Math.min(c.count, map2[c.id]);
    }
  });
  return overlap;
}

/** 領土デッキの合計枚数を計算 (tokenDeck は {id: count} の連想配列) */
function getTerritoryDeckCount(tokenDeck) {
  if (!tokenDeck) return 0;
  if (Array.isArray(tokenDeck)) {
    return tokenDeck.reduce((sum, t) => sum + (Number(t.count) || 0), 0);
  }
  return Object.values(tokenDeck).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/** デッキ内にプレビューカードが含まれているか判定 (基礎・領土の両方をチェック) */
function deckContainsPreview(deck) {
  if (!deck) return false;
  if (Array.isArray(deck.cards)) {
    if (deck.cards.some(c => (c.count || 0) > 0 && isPreviewCardId(c.id))) return true;
  }
  const td = deck.tokenDeck;
  if (Array.isArray(td)) {
    if (td.some(t => (t.count || 0) > 0 && isPreviewCardId(t.id))) return true;
  } else if (td && typeof td === 'object') {
    if (Object.entries(td).some(([id, count]) => (Number(count) || 0) > 0 && isPreviewCardId(id))) return true;
  }
  return false;
}

/**
 * デッキ登録バリデーション (ACG 総合ルール 502/503)
 *   基礎デッキ: 40 枚以上
 *   領土デッキ: 10 枚ちょうど (空デッキは旧データ互換のため許容)
 * @returns {string|null} エラーメッセージ or null(正常)
 */
function validateDecks(deck1, deck2, is2deck) {
  // deck1 / deck2 は savedDecks 要素そのもの。.cards (基礎) と .tokenDeck (領土) を見る。

  // プレビューカードを含むデッキはイベント登録不可 (公式未公開のカードはイベント使用不可)
  if (deckContainsPreview(deck1)) {
    return 'デッキ1にプレビューカードが含まれています。プレビューカード (公式未公開) を含むデッキはイベント登録できません。';
  }

  const count1 = getMainDeckCount(deck1?.cards);
  if (count1 < 40) return `デッキ1の基礎デッキが${count1}枚です。40枚以上必要です。`;
  const terr1 = getTerritoryDeckCount(deck1?.tokenDeck);
  if (terr1 > 0 && terr1 !== 10) return `デッキ1の領土デッキが${terr1}枚です。ちょうど10枚必要です。`;

  if (is2deck) {
    if (deckContainsPreview(deck2)) {
      return 'デッキ2にプレビューカードが含まれています。プレビューカード (公式未公開) を含むデッキはイベント登録できません。';
    }
    const count2 = getMainDeckCount(deck2?.cards);
    if (count2 < 40) return `デッキ2の基礎デッキが${count2}枚です。40枚以上必要です。`;
    const terr2 = getTerritoryDeckCount(deck2?.tokenDeck);
    if (terr2 > 0 && terr2 !== 10) return `デッキ2の領土デッキが${terr2}枚です。ちょうど10枚必要です。`;

    // カード一致枚数チェック（11枚以上はNG）
    const overlap = getOverlapCount(deck1?.cards, deck2?.cards);
    if (overlap >= 11) {
      return `2つのデッキ間で${overlap}枚のカードが一致しています。10枚以下にしてください。`;
    }
  }

  return null; // OK
}

// ========== イベント一覧 ==========
function EventList() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('game', APP_GAME_ID)
        .order('date', { ascending: false });
      setEvents(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ marginBottom: '1em' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
            <button onClick={() => navigate('/mypage')} style={{ ...btnSecondary, fontSize: '0.85em' }}>マイページ</button>
            <button onClick={() => navigate('/')} style={{ ...btnSecondary, fontSize: '0.85em' }}>トップ</button>
          </div>
          <h2 style={{ margin: 0 }}>対戦イベント</h2>
        </div>
        {loading ? <p>読み込み中...</p> : events.length === 0 ? (
          <p style={{ color: '#999' }}>現在開催中のイベントはありません。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {events.map(ev => (
              <div key={ev.id} onClick={() => navigate(`/events/${ev.id}`)}
                style={{ border: '1px solid #ddd', borderRadius: 8, padding: '1em', cursor: 'pointer', transition: 'box-shadow 0.2s', ':hover': { boxShadow: '0 2px 8px #ccc' } }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '1.1em' }}>{ev.name}</strong>
                  <span style={{ fontSize: '0.85em' }}>{statusLabel[ev.status] || ev.status}</span>
                </div>
                <div style={{ fontSize: '0.85em', color: '#666', marginTop: 4 }}>
                  {ev.date} ・ {formatLabel[ev.format] || ev.format} ・ {matchTypeLabel[ev.match_type] || ev.match_type} ・ 最大{ev.max_rounds}回戦
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ========== イベント詳細 ==========
function EventDetail() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [matches, setMatches] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [myParticipation, setMyParticipation] = useState(null);

  // デッキ登録用
  const [savedDecks, setSavedDecks] = useState([]);
  const [selectedDeckName, setSelectedDeckName] = useState('');
  const [selectedDeckName2, setSelectedDeckName2] = useState('');
  const [editingDeck, setEditingDeck] = useState(false);

  // デッキ閲覧モーダル用
  const [viewDeck, setViewDeck] = useState(null); // { deckName, deckCards, tokenCards }

  // BO3 デッキ選択用
  const [selectedGameDeck, setSelectedGameDeck] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const autoConfirmRef = useRef(false);

  // データ取得
  const fetchAll = useCallback(async () => {
    const [evRes, partRes, roundRes, matchRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).eq('game', APP_GAME_ID).single(),
      supabase.from('event_participants').select('*').eq('event_id', eventId),
      supabase.from('event_rounds').select('*').eq('event_id', eventId).order('round_number'),
      supabase.from('round_matches').select('*').eq('event_id', eventId),
    ]);
    // 登録済みデッキは登録時点の ID スナップショット。新弾追加でずれた旧世代の ID を表示前に補正する。
    const parts = (partRes.data || []).map(migrateParticipantDecks);

    setEvent(evRes.data);
    setParticipants(parts);
    setRounds(roundRes.data || []);
    setMatches(matchRes.data || []);

    if (user) {
      setMyParticipation(parts.find(p => p.user_id === user.id) || null);
    }

    // 参加者のプロフィール取得
    const userIds = [...new Set(parts.map(p => p.user_id))];
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
      const map = {};
      (profs || []).forEach(p => { map[p.user_id] = p.display_name || '名無し'; });
      setProfiles(map);
    }

    // 保存デッキ取得（ログイン済みの場合）
    if (user) {
      const { data: decks } = await supabase.from('decks').select('name, cards, token_deck').eq('user_id', user.id).eq('game', APP_GAME_ID);
      setSavedDecks((decks || []).map(migrateSavedDeck));
    }

    setLoading(false);
  }, [eventId, user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // プロフィールのみ再取得（ニックネーム変更反映用）
  const refreshProfiles = useCallback(async () => {
    const userIds = [...new Set(participants.map(p => p.user_id))];
    if (userIds.length === 0) return;
    const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
    const map = {};
    (profs || []).forEach(p => { map[p.user_id] = p.display_name || '名無し'; });
    setProfiles(map);
  }, [participants]);

  // タブ復帰時にプロフィールをリフレッシュ（60 秒未満の連続復帰はスキップ）
  const lastProfileRefreshRef = useRef(0);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || participants.length === 0) return;
      const now = Date.now();
      if (now - lastProfileRefreshRef.current < 60_000) return;
      lastProfileRefreshRef.current = now;
      refreshProfiles();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [participants, refreshProfiles]);

  // イベント参加
  const handleJoin = async () => {
    if (!user) { navigate('/login'); return; }
    const { error } = await supabase.from('event_participants').insert({
      event_id: eventId,
      user_id: user.id,
    });
    if (error) { alert('参加に失敗しました: ' + error.message); return; }
    await fetchAll();
  };

  // デッキ登録
  const handleRegisterDeck = async () => {
    const is2deck = event.deck_count === 2;
    if (!selectedDeckName) { alert('デッキ1を選択してください'); return; }
    if (is2deck && !selectedDeckName2) { alert('デッキ2を選択してください'); return; }
    if (is2deck && selectedDeckName === selectedDeckName2) { alert('デッキ1とデッキ2は異なるデッキを選択してください'); return; }
    const deck1 = savedDecks.find(d => d.name === selectedDeckName);
    if (!deck1) return;

    // バリデーション
    const deck2 = is2deck ? savedDecks.find(d => d.name === selectedDeckName2) : null;
    const validationError = validateDecks(deck1, deck2, is2deck);
    if (validationError) { alert('デッキ登録エラー\n\n' + validationError); return; }

    const updateData = {
      deck_name: deck1.name,
      deck_data: deck1.cards,
      token_deck: deck1.token_deck || [],
    };
    if (is2deck) {
      updateData.deck_name_2 = deck2.name;
      updateData.deck_data_2 = deck2.cards;
      updateData.token_deck_2 = deck2.token_deck || [];
    }
    const { error } = await supabase.from('event_participants')
      .update(updateData)
      .eq('event_id', eventId)
      .eq('user_id', user.id);
    if (error) { alert('デッキ登録失敗: ' + error.message); return; }
    alert('デッキを登録しました');
    setEditingDeck(false);
    await fetchAll();
  };

  // 参加辞退（未確定のマッチがある場合は不可）
  const handleLeave = async () => {
    const activeMatch = matches.find(m =>
      (m.player1_id === user.id || m.player2_id === user.id) && m.status !== 'confirmed'
    );
    if (activeMatch) {
      alert('未確定の対戦があるため、参加を取り消せません。');
      return;
    }
    if (!window.confirm('参加を取り消しますか？')) return;
    const { error } = await supabase.from('event_participants').delete().eq('event_id', eventId).eq('user_id', user.id);
    if (error) { alert('参加取り消しに失敗しました: ' + error.message); return; }
    await fetchAll();
  };

  // デッキ登録解除（募集中のみ）
  const handleUnregisterDeck = async () => {
    if (!window.confirm('デッキの登録を解除しますか？\n解除後、デッキの編集・削除が可能になります。')) return;
    const clearData = {
      deck_name: null,
      deck_data: null,
      token_deck: null,
    };
    if (event.deck_count === 2) {
      clearData.deck_name_2 = null;
      clearData.deck_data_2 = null;
      clearData.token_deck_2 = null;
    }
    const { error } = await supabase.from('event_participants')
      .update(clearData)
      .eq('event_id', eventId)
      .eq('user_id', user.id);
    if (error) { alert('デッキ登録解除に失敗しました: ' + error.message); return; }
    alert('デッキの登録を解除しました。');
    await fetchAll();
  };

  // 勝敗報告（最初の報告者が結果を登録、相手が承認して確定）
  const handleReport = async (matchId, winnerId, isDraw) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    // 最新データを取得（相手の報告を見落とさないため）
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const myReport = isDraw ? 'draw' : winnerId;
    const otherReport = isP1 ? match.player2_reported : match.player1_reported;
    const update = {};
    if (isP1) update.player1_reported = myReport;
    else update.player2_reported = myReport;

    // 結果もセット
    if (isDraw) {
      update.is_draw = true;
      update.winner_id = null;
    } else {
      update.winner_id = winnerId;
      update.is_draw = false;
    }

    // 相手が既に報告済みなら結果を判定
    if (otherReport && otherReport === myReport) {
      update.status = 'confirmed'; // 同じ報告 → 自動確定
    } else if (otherReport) {
      update.status = 'disputed'; // 異なる報告 → 異議扱い
    } else {
      update.status = 'reported';
    }

    await supabase.from('round_matches').update(update).eq('id', matchId);
    await fetchAll();
    } finally { setSubmitting(false); }
  };

  // 相手の報告を承認して確定
  const handleApprove = useCallback(async (matchId) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const update = { status: 'confirmed' };
    // 承認側も同じ報告値をセット
    const otherReport = isP1 ? match.player2_reported : match.player1_reported;
    if (isP1) update.player1_reported = otherReport;
    else update.player2_reported = otherReport;
    // 相手の報告に合わせて結果もセット
    if (otherReport === 'draw') {
      update.is_draw = true;
      update.winner_id = null;
    } else {
      update.winner_id = otherReport;
      update.is_draw = false;
    }
    await supabase.from('round_matches').update(update).eq('id', matchId);
    await fetchAll();
    } finally { setSubmitting(false); }
  }, [submitting, user, fetchAll]);

  // 相手の報告に異議がある場合、自分の報告で上書き
  const handleDispute = async (matchId, winnerId, isDraw) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const myReport = isDraw ? 'draw' : winnerId;
    const update = {};
    if (isP1) update.player1_reported = myReport;
    else update.player2_reported = myReport;
    if (isDraw) {
      update.is_draw = true;
      update.winner_id = null;
    } else {
      update.winner_id = winnerId;
      update.is_draw = false;
    }
    update.status = 'disputed';
    await supabase.from('round_matches').update(update).eq('id', matchId);
    await fetchAll();
    } finally { setSubmitting(false); }
  };

  // BO3: 個別試合の結果報告
  const handleReportGame = async (matchId, winnerId, isDraw, myDeck) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const games = JSON.parse(JSON.stringify(match.games || []));
    let currentGame = games.find(g => g.status !== 'confirmed');
    if (!currentGame) {
      currentGame = {
        game_number: games.filter(g => g.status === 'confirmed').length + 1,
        player1_reported: null, player2_reported: null,
        winner_id: null, is_draw: false, status: 'pending',
        player1_deck: null, player2_deck: null,
      };
      games.push(currentGame);
    }
    const myReport = isDraw ? 'draw' : winnerId;
    if (isP1) {
      currentGame.player1_reported = myReport;
      if (myDeck) currentGame.player1_deck = myDeck;
    } else {
      currentGame.player2_reported = myReport;
      if (myDeck) currentGame.player2_deck = myDeck;
    }
    if (isDraw) { currentGame.is_draw = true; currentGame.winner_id = null; }
    else { currentGame.winner_id = winnerId; currentGame.is_draw = false; }

    // 相手が既に報告済みか確認
    const otherGameReport = isP1 ? currentGame.player2_reported : currentGame.player1_reported;
    if (otherGameReport && otherGameReport === myReport) {
      // 同じ報告 → 試合自動確定
      currentGame.status = 'confirmed';
      const confirmedGames = games.filter(g => g.status === 'confirmed');
      let p1w = 0, p2w = 0;
      confirmedGames.forEach(g => {
        if (g.winner_id === match.player1_id) p1w++;
        else if (g.winner_id === match.player2_id) p2w++;
      });
      const update = { games };
      if (p1w >= 2 || p2w >= 2) {
        update.status = 'confirmed';
        update.winner_id = p1w >= 2 ? match.player1_id : match.player2_id;
        update.is_draw = false;
      } else if (confirmedGames.length >= 3) {
        update.status = 'confirmed';
        if (p1w > p2w) { update.winner_id = match.player1_id; update.is_draw = false; }
        else if (p2w > p1w) { update.winner_id = match.player2_id; update.is_draw = false; }
        else { update.winner_id = null; update.is_draw = true; }
      } else {
        update.status = 'pending';
      }
      await supabase.from('round_matches').update(update).eq('id', matchId);
    } else if (otherGameReport) {
      // 異なる報告 → 異議扱い
      currentGame.status = 'disputed';
      await supabase.from('round_matches').update({ games, status: 'disputed' }).eq('id', matchId);
    } else {
      currentGame.status = 'reported';
      await supabase.from('round_matches').update({ games, status: 'reported' }).eq('id', matchId);
    }
    setSelectedGameDeck('');
    await fetchAll();
    } finally { setSubmitting(false); }
  };

  // BO3: 個別試合の承認
  const handleApproveGame = useCallback(async (matchId, myDeck) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const games = JSON.parse(JSON.stringify(match.games || []));
    const currentGame = games.find(g => g.status === 'reported' || g.status === 'disputed');
    if (!currentGame) return;
    const otherReport = isP1 ? currentGame.player2_reported : currentGame.player1_reported;
    if (isP1) {
      currentGame.player1_reported = otherReport;
      if (myDeck) currentGame.player1_deck = myDeck;
    } else {
      currentGame.player2_reported = otherReport;
      if (myDeck) currentGame.player2_deck = myDeck;
    }
    currentGame.status = 'confirmed';
    const confirmedGames = games.filter(g => g.status === 'confirmed');
    let p1w = 0, p2w = 0;
    confirmedGames.forEach(g => {
      if (g.winner_id === match.player1_id) p1w++;
      else if (g.winner_id === match.player2_id) p2w++;
    });
    const update = { games };
    if (p1w >= 2 || p2w >= 2) {
      update.status = 'confirmed';
      update.winner_id = p1w >= 2 ? match.player1_id : match.player2_id;
      update.is_draw = false;
    } else if (confirmedGames.length >= 3) {
      // 3ゲーム終了。2勝先取決着せず→勝利数比較、同数ならマッチ引分
      update.status = 'confirmed';
      if (p1w > p2w) {
        update.winner_id = match.player1_id;
        update.is_draw = false;
      } else if (p2w > p1w) {
        update.winner_id = match.player2_id;
        update.is_draw = false;
      } else {
        update.winner_id = null;
        update.is_draw = true;
      }
    } else {
      update.status = 'pending';
    }
    await supabase.from('round_matches').update(update).eq('id', matchId);
    setSelectedGameDeck('');
    await fetchAll();
    } finally { setSubmitting(false); }
  }, [submitting, user, fetchAll]);

  // BO3: 個別試合の異議
  const handleDisputeGame = async (matchId, winnerId, isDraw, myDeck) => {
    if (submitting) return;
    setSubmitting(true);
    try {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const isP1 = user.id === match.player1_id;
    const games = JSON.parse(JSON.stringify(match.games || []));
    const currentGame = games.find(g => g.status === 'reported' || g.status === 'disputed');
    if (!currentGame) return;
    const myReport = isDraw ? 'draw' : winnerId;
    if (isP1) {
      currentGame.player1_reported = myReport;
      if (myDeck) currentGame.player1_deck = myDeck;
    } else {
      currentGame.player2_reported = myReport;
      if (myDeck) currentGame.player2_deck = myDeck;
    }
    if (isDraw) { currentGame.is_draw = true; currentGame.winner_id = null; }
    else { currentGame.winner_id = winnerId; currentGame.is_draw = false; }
    currentGame.status = 'disputed';
    await supabase.from('round_matches').update({ games, status: 'disputed' }).eq('id', matchId);
    setSelectedGameDeck('');
    await fetchAll();
    } finally { setSubmitting(false); }
  };

  const getName = (userId) => profiles[userId] || '名無し';

  // 早期リターン前に計算（useEffectより前に必要）
  const isJoined = !!myParticipation;
  const hasDeck = myParticipation?.deck_name;
  const hasDeck2 = myParticipation?.deck_name_2;
  const needsDeck2 = event?.deck_count === 2;
  const allDecksRegistered = hasDeck && (!needsDeck2 || hasDeck2);
  const currentRound = rounds.find(r => r.round_number === event?.current_round);
  const currentMatches = currentRound ? matches.filter(m => m.round_id === currentRound.id) : [];
  const myCurrentMatch = currentMatches.find(m => m.player1_id === user?.id || m.player2_id === user?.id);

  // 両者報告一致時の自動確定（レースコンディション対策）
  useEffect(() => {
    if (!myCurrentMatch || !user || !event || submitting || autoConfirmRef.current) return;
    const isP1 = user.id === myCurrentMatch.player1_id;
    const isBo3 = event.match_type === 'bo3';

    if (isBo3) {
      const games = myCurrentMatch.games || [];
      const currentGame = games.find(g => g.status !== 'confirmed');
      if (!currentGame) return;
      const myR = isP1 ? currentGame.player1_reported : currentGame.player2_reported;
      const otherR = isP1 ? currentGame.player2_reported : currentGame.player1_reported;
      if (myR && otherR && myR === otherR && currentGame.status !== 'confirmed') {
        autoConfirmRef.current = true;
        handleApproveGame(myCurrentMatch.id, null).finally(() => { autoConfirmRef.current = false; });
      }
    } else {
      const myR = isP1 ? myCurrentMatch.player1_reported : myCurrentMatch.player2_reported;
      const otherR = isP1 ? myCurrentMatch.player2_reported : myCurrentMatch.player1_reported;
      if (myR && otherR && myR === otherR && myCurrentMatch.status !== 'confirmed') {
        autoConfirmRef.current = true;
        handleApprove(myCurrentMatch.id).finally(() => { autoConfirmRef.current = false; });
      }
    }
  }, [myCurrentMatch, submitting, user, event, handleApprove, handleApproveGame]);

  // 成績集計（共通 utility に集約。matches/participants が変わらない限り再計算しない）
  // ※ Rules of Hooks に従い、早期 return より前に必ず実行する。
  const { sortedStandings, getRank } = useMemo(
    () => calculateStandings(matches, participants),
    [matches, participants]
  );

  if (loading) return <div style={containerStyle}><div style={cardStyle}><p>読み込み中...</p></div></div>;
  if (!event) return <div style={containerStyle}><div style={cardStyle}><p>イベントが見つかりません</p></div></div>;

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* ヘッダー */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
            <button onClick={() => navigate('/events')} style={{ ...btnSecondary, fontSize: '0.85em' }}>一覧</button>
            <button onClick={() => navigate('/mypage')} style={{ ...btnSecondary, fontSize: '0.85em' }}>マイページ</button>
            <button onClick={() => navigate('/')} style={{ ...btnSecondary, fontSize: '0.85em' }}>トップ</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{event.name}</h2>
            <span style={{ fontSize: '0.85em', flexShrink: 0, marginLeft: 8 }}>{statusLabel[event.status]}</span>
          </div>
        </div>
        <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '1em' }}>
          {event.date} ・ {formatLabel[event.format]} ・ {matchTypeLabel[event.match_type]} ・ {event.deck_count === 2 ? '2デッキ制' : '1デッキ制'} ・ 最大{event.max_rounds}回戦
          {event.current_round > 0 && ` ・ 現在第${event.current_round}回戦`}
        </div>

        {/* 参加セクション */}
        {event.status === 'recruiting' && (
          <section style={{ marginBottom: '1.5em', padding: '1em', background: '#f9f9f9', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1em' }}>参加登録</h3>
            {!user ? (
              <button onClick={() => navigate('/login')} style={btnPrimary}>ログインして参加</button>
            ) : !isJoined ? (
              <button onClick={handleJoin} style={btnPrimary}>このイベントに参加する</button>
            ) : (
              <div>
                <p style={{ color: '#2e7d32', margin: '0 0 8px' }}>✅ 参加登録済み</p>
                {(!allDecksRegistered || editingDeck) ? (
                  <div>
                    <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 8px' }}>
                      使用デッキを{editingDeck ? '変更' : '登録'}してください{needsDeck2 ? '（2デッキ制）' : ''}：
                    </p>
                    <label style={{ fontSize: '0.85em', color: '#555' }}>デッキ1</label>
                    <select value={selectedDeckName} onChange={e => setSelectedDeckName(e.target.value)}
                      style={{ width: '100%', padding: '0.5em', borderRadius: 6, border: '1px solid #bbb', marginBottom: 8 }}>
                      <option value="">-- デッキを選択 --</option>
                      {savedDecks.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                    </select>
                    {needsDeck2 && (
                      <>
                        <label style={{ fontSize: '0.85em', color: '#555' }}>デッキ2</label>
                        <select value={selectedDeckName2} onChange={e => setSelectedDeckName2(e.target.value)}
                          style={{ width: '100%', padding: '0.5em', borderRadius: 6, border: '1px solid #bbb', marginBottom: 8 }}>
                          <option value="">-- デッキを選択 --</option>
                          {savedDecks.filter(d => d.name !== selectedDeckName).map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                        </select>
                      </>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleRegisterDeck} style={btnPrimary}>デッキを{editingDeck ? '変更' : '登録'}</button>
                      {editingDeck && (
                        <button onClick={() => setEditingDeck(false)} style={btnSecondary}>キャンセル</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.9em', color: '#555' }}>
                    <p style={{ margin: '0 0 4px' }}>登録デッキ1: <strong
                      style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => setViewDeck({ deckName: hasDeck, deckCards: myParticipation.deck_data, tokenCards: myParticipation.token_deck })}
                    >{hasDeck}</strong></p>
                    {needsDeck2 && <p style={{ margin: '0 0 8px' }}>登録デッキ2: <strong
                      style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => setViewDeck({ deckName: hasDeck2, deckCards: myParticipation.deck_data_2, tokenCards: myParticipation.token_deck_2 })}
                    >{hasDeck2}</strong></p>}
                    <button onClick={() => {
                      setSelectedDeckName(hasDeck || '');
                      setSelectedDeckName2(hasDeck2 || '');
                      setEditingDeck(true);
                    }} style={{ ...btnSecondary, fontSize: '0.85em' }}>デッキを変更する</button>
                    <button onClick={handleUnregisterDeck}
                      style={{ ...btnSecondary, fontSize: '0.85em', marginLeft: 8, background: '#fff3e0', color: '#e65100', border: '1px solid #ffb74d' }}>登録解除</button>
                  </div>
                )}
                <button onClick={handleLeave} style={{ ...btnSecondary, marginTop: 8, fontSize: '0.85em' }}>参加を取り消す</button>
              </div>
            )}
          </section>
        )}

        {/* 自分の現在の対戦 */}
        {event.status === 'in_progress' && isJoined && allDecksRegistered && (
          <section style={{ marginBottom: '1em', padding: '0.7em 1em', background: '#fff8e1', borderRadius: 8, fontSize: '0.85em', color: '#795548' }}>
            🔒 登録デッキ: <strong
              style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setViewDeck({ deckName: hasDeck, deckCards: myParticipation.deck_data, tokenCards: myParticipation.token_deck })}
            >{hasDeck}</strong>{needsDeck2 && hasDeck2 && <> / <strong
              style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setViewDeck({ deckName: hasDeck2, deckCards: myParticipation.deck_data_2, tokenCards: myParticipation.token_deck_2 })}
            >{hasDeck2}</strong></>}
            <span style={{ display: 'block', fontSize: '0.8em', color: '#999', marginTop: 2 }}>イベント終了まで変更・削除できません</span>
          </section>
        )}
        {event.status === 'finished' && isJoined && allDecksRegistered && (
          <section style={{ marginBottom: '1em', padding: '0.7em 1em', background: '#f5f5f5', borderRadius: 8, fontSize: '0.85em', color: '#555' }}>
            📋 登録デッキ: <strong
              style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setViewDeck({ deckName: hasDeck, deckCards: myParticipation.deck_data, tokenCards: myParticipation.token_deck })}
            >{hasDeck}</strong>{needsDeck2 && hasDeck2 && <> / <strong
              style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setViewDeck({ deckName: hasDeck2, deckCards: myParticipation.deck_data_2, tokenCards: myParticipation.token_deck_2 })}
            >{hasDeck2}</strong></>}
          </section>
        )}
        {myCurrentMatch && event.status === 'in_progress' && (
          <fieldset disabled={submitting} style={{ border: 'none', padding: 0, margin: 0, opacity: submitting ? 0.6 : 1 }}>
          <section style={{ marginBottom: '1.5em', padding: '1em', background: '#e3f2fd', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1em' }}>🎮 第{event.current_round}回戦 あなたの対戦{myCurrentMatch.table_number && <span style={{ marginLeft: 8, background: '#1565c0', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: '0.85em' }}>卓 {myCurrentMatch.table_number}</span>}</h3>
            {!myCurrentMatch.player2_id ? (
              <p style={{ color: '#2e7d32' }}>不戦勝です</p>
            ) : event.match_type === 'bo3' ? (() => {
              const isP1 = user.id === myCurrentMatch.player1_id;
              const opponentId = isP1 ? myCurrentMatch.player2_id : myCurrentMatch.player1_id;
              const opponentName = getName(opponentId);
              const games = myCurrentMatch.games || [];
              const confirmedGames = games.filter(g => g.status === 'confirmed');
              const p1Wins = confirmedGames.filter(g => g.winner_id === myCurrentMatch.player1_id).length;
              const p2Wins = confirmedGames.filter(g => g.winner_id === myCurrentMatch.player2_id).length;
              const myWins = isP1 ? p1Wins : p2Wins;
              const oppWins = isP1 ? p2Wins : p1Wins;
              const matchDecided = myWins >= 2 || oppWins >= 2 || confirmedGames.length >= 3;
              const currentGame = games.find(g => g.status !== 'confirmed');
              const nextGameNum = confirmedGames.length + 1;
              const myReported = currentGame ? (isP1 ? currentGame.player1_reported : currentGame.player2_reported) : null;
              const otherReported = currentGame ? (isP1 ? currentGame.player2_reported : currentGame.player1_reported) : null;
              const is2Deck = event.deck_count === 2;
              const myDeckNames = is2Deck && myParticipation ? [myParticipation.deck_name, myParticipation.deck_name_2].filter(Boolean) : [];
              const wonDecks = confirmedGames.filter(g => g.winner_id === user.id).map(g => isP1 ? g.player1_deck : g.player2_deck).filter(Boolean);
              const availableDecks = myDeckNames.filter(n => !wonDecks.includes(n));
              const needsDeckSelect = is2Deck && availableDecks.length > 1;
              const autoSelectedDeck = is2Deck && availableDecks.length === 1 ? availableDecks[0] : null;
              const effectiveDeck = needsDeckSelect ? selectedGameDeck : (autoSelectedDeck || null);
              const checkDeck = () => { if (is2Deck && needsDeckSelect && !selectedGameDeck) { alert('使用デッキを選択してください'); return false; } return true; };
              const fmtReport = (r) => r === 'draw' ? '引き分け' : r === user.id ? 'あなたの勝ち' : `${getName(r)}の勝ち`;
              return (
                <div>
                  <p style={{ margin: '0 0 8px' }}>対戦相手: <strong>{opponentName}</strong></p>
                  <div style={{ textAlign: 'center', margin: '8px 0 12px', padding: '6px', background: '#fff', borderRadius: 6, fontSize: '1.1em' }}>
                    <strong>{myWins}</strong> - <strong>{oppWins}</strong>
                  </div>
                  {confirmedGames.map(g => (
                    <div key={g.game_number} style={{ fontSize: '0.85em', padding: '4px 8px', marginBottom: 2, background: '#f5f5f5', borderRadius: 4 }}>
                      第{g.game_number}試合: {g.is_draw ? '引分' : g.winner_id === user.id ? '⭕ 勝ち' : '❌ 負け'}
                      {is2Deck && (isP1 ? g.player1_deck : g.player2_deck) && (
                        <span style={{ color: '#888', marginLeft: 6 }}>[{isP1 ? g.player1_deck : g.player2_deck}]</span>
                      )}
                    </div>
                  ))}
                  {matchDecided || myCurrentMatch.status === 'confirmed' ? (
                    <p style={{ color: myCurrentMatch.is_draw ? '#616161' : myCurrentMatch.winner_id === user.id ? '#2e7d32' : '#d32f2f', fontWeight: 'bold', marginTop: 12 }}>
                      {myCurrentMatch.is_draw ? '🤝 マッチ引き分け' : myCurrentMatch.winner_id === user.id ? '🏆 マッチ勝利！' : '😢 マッチ敗北'}
                      <span style={{ fontSize: '0.85em', color: '#777', fontWeight: 'normal', marginLeft: 6 }}>({myWins}-{oppWins})</span>
                    </p>
                  ) : (
                    <div style={{ marginTop: 12, padding: '0.8em', background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: '0.95em', color: '#1976d2' }}>第{nextGameNum}試合</h4>
                      {is2Deck && (needsDeckSelect ? (
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: '0.85em', color: '#555' }}>使用デッキ: </label>
                          <select value={selectedGameDeck} onChange={e => setSelectedGameDeck(e.target.value)}
                            style={{ padding: '0.3em 0.5em', borderRadius: 4, border: '1px solid #bbb', fontSize: '0.9em' }}>
                            <option value="">-- 選択 --</option>
                            {availableDecks.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      ) : autoSelectedDeck && (
                        <p style={{ fontSize: '0.85em', color: '#555', margin: '0 0 8px' }}>使用デッキ: <strong>{autoSelectedDeck}</strong></p>
                      ))}
                      {otherReported && !myReported ? (
                        <div>
                          <div style={{ background: '#fff3e0', padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
                            <p style={{ margin: 0, fontSize: '0.9em' }}>📋 {opponentName} が結果を報告しました：</p>
                            <p style={{ margin: '4px 0 0', fontWeight: 'bold' }}>{fmtReport(otherReported)}</p>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={() => { if (!checkDeck()) return; handleApproveGame(myCurrentMatch.id, effectiveDeck); }}
                              style={{ ...btnPrimary, background: '#2e7d32' }}>✔ 承認</button>
                            <button onClick={() => { if (!checkDeck()) return; handleDisputeGame(myCurrentMatch.id, user.id, false, effectiveDeck); }}
                              style={{ ...btnPrimary, background: '#f57c00', fontSize: '0.85em' }}>⚠ 異議（勝ち）</button>
                            <button onClick={() => { if (!checkDeck()) return; handleDisputeGame(myCurrentMatch.id, opponentId, false, effectiveDeck); }}
                              style={{ ...btnDanger, fontSize: '0.85em' }}>⚠ 異議（負け）</button>
                            <button onClick={() => { if (!checkDeck()) return; handleDisputeGame(myCurrentMatch.id, null, true, effectiveDeck); }}
                              style={{ ...btnSecondary, fontSize: '0.85em' }}>⚠ 異議（引分）</button>
                          </div>
                        </div>
                      ) : myReported && otherReported && myReported === otherReported && currentGame?.status !== 'confirmed' ? (
                        <div>
                          <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{fmtReport(myReported)}</strong></p>
                          <p style={{ fontSize: '0.85em', color: '#2e7d32', marginTop: 8 }}>✅ 双方の報告が一致しました。確定中...</p>
                        </div>
                      ) : myReported && otherReported ? (
                        <div>
                          <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{fmtReport(myReported)}</strong></p>
                          {currentGame?.status === 'disputed' ? (
                            <p style={{ fontSize: '0.85em', color: '#d32f2f', marginTop: 8 }}>⚠ 報告が一致しません。運営が確認中です。</p>
                          ) : (
                            <div>
                              <div style={{ background: '#fff3e0', padding: '8px 12px', borderRadius: 6, marginBottom: 8, marginTop: 8 }}>
                                <p style={{ margin: '0 0 4px', fontSize: '0.95em', fontWeight: 'bold' }}>💬 報告内容の確認をお願いします</p>
                                <p style={{ margin: 0, fontSize: '0.85em', color: '#795548' }}>報告内容に食い違いがあるようです。お手数ですが、結果をご確認ください。</p>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button onClick={() => { if (!checkDeck()) return; handleApproveGame(myCurrentMatch.id, effectiveDeck); }}
                                  style={{ ...btnPrimary, background: '#2e7d32' }}>✔ 結果を修正する</button>
                                <button onClick={() => { if (!checkDeck()) return; handleDisputeGame(myCurrentMatch.id, myReported === 'draw' ? null : myReported, myReported === 'draw', effectiveDeck); }}
                                  style={{ ...btnPrimary, background: '#f57c00', fontSize: '0.85em' }}>📩 運営に確認をお願いする</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : myReported ? (
                        <div>
                          <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{fmtReport(myReported)}</strong></p>
                          {currentGame?.status === 'disputed' ? (
                            <p style={{ fontSize: '0.85em', color: '#d32f2f', marginTop: 8 }}>⚠ 運営が確認中です。</p>
                          ) : (
                            <p style={{ fontSize: '0.85em', color: '#f57c00', marginTop: 8 }}>⏳ 相手の承認を待っています...</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 8px' }}>勝敗を報告してください：</p>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={() => { if (!checkDeck()) return; handleReportGame(myCurrentMatch.id, user.id, false, effectiveDeck); }}
                              style={{ ...btnPrimary, background: '#2e7d32' }}>勝ち</button>
                            <button onClick={() => { if (!checkDeck()) return; handleReportGame(myCurrentMatch.id, opponentId, false, effectiveDeck); }}
                              style={btnDanger}>負け</button>
                            <button onClick={() => { if (!checkDeck()) return; handleReportGame(myCurrentMatch.id, null, true, effectiveDeck); }}
                              style={btnSecondary}>引き分け</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })() : (
              <div>
                <p style={{ margin: '0 0 8px' }}>
                  対戦相手: <strong>{getName(myCurrentMatch.player1_id === user.id ? myCurrentMatch.player2_id : myCurrentMatch.player1_id)}</strong>
                </p>
                {myCurrentMatch.status === 'confirmed' ? (
                  <p style={{ color: '#2e7d32' }}>
                    結果確定: {myCurrentMatch.is_draw ? '引き分け' : myCurrentMatch.winner_id === user.id ? '🏆 勝ち' : '😢 負け'}
                  </p>
                ) : (() => {
                  const isP1 = user.id === myCurrentMatch.player1_id;
                  const myReported = isP1 ? myCurrentMatch.player1_reported : myCurrentMatch.player2_reported;
                  const otherReported = isP1 ? myCurrentMatch.player2_reported : myCurrentMatch.player1_reported;
                  const opponentName = getName(isP1 ? myCurrentMatch.player2_id : myCurrentMatch.player1_id);

                  // 相手の報告内容を表示用テキストに変換
                  const formatReport = (report) => {
                    if (report === 'draw') return '引き分け';
                    if (report === user.id) return 'あなたの勝ち';
                    return `${getName(report)}の勝ち`;
                  };

                  // 相手が報告済み & 自分は未報告 → 承認UI
                  if (otherReported && !myReported) {
                    return (
                      <div>
                        <div style={{ background: '#fff3e0', padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
                          <p style={{ margin: 0, fontSize: '0.9em' }}>📋 {opponentName} が結果を報告しました：</p>
                          <p style={{ margin: '4px 0 0', fontWeight: 'bold', fontSize: '1em' }}>{formatReport(otherReported)}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => handleApprove(myCurrentMatch.id)}
                            style={{ ...btnPrimary, background: '#2e7d32' }}>✔ 承認して確定</button>
                          <button onClick={() => handleDispute(myCurrentMatch.id, user.id, false)}
                            style={{ ...btnPrimary, background: '#f57c00', fontSize: '0.85em' }}>⚠ 異議あり（勝ち）</button>
                          <button onClick={() => handleDispute(myCurrentMatch.id, isP1 ? myCurrentMatch.player2_id : myCurrentMatch.player1_id, false)}
                            style={{ ...btnDanger, fontSize: '0.85em' }}>⚠ 異議あり（負け）</button>
                          <button onClick={() => handleDispute(myCurrentMatch.id, null, true)}
                            style={{ ...btnSecondary, fontSize: '0.85em' }}>⚠ 異議あり（引分）</button>
                        </div>
                      </div>
                    );
                  }

                  // 両者報告済み & 一致 & 未確定 → useEffectで自動確定中
                  if (myReported && otherReported && myReported === otherReported && myCurrentMatch.status !== 'confirmed') {
                    return (
                      <div>
                        <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{formatReport(myReported)}</strong></p>
                        <p style={{ fontSize: '0.85em', color: '#2e7d32', marginTop: 8 }}>✅ 双方の報告が一致しました。確定中...</p>
                      </div>
                    );
                  }

                  // 両者報告済み & 不一致
                  if (myReported && otherReported) {
                    return (
                      <div>
                        <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{formatReport(myReported)}</strong></p>
                        {myCurrentMatch.status === 'disputed' ? (
                          <p style={{ fontSize: '0.85em', color: '#d32f2f', marginTop: 8 }}>⚠ 報告が一致しません。運営が確認中です。</p>
                        ) : (
                          <div>
                            <div style={{ background: '#fff3e0', padding: '8px 12px', borderRadius: 6, marginBottom: 8, marginTop: 8 }}>
                              <p style={{ margin: '0 0 4px', fontSize: '0.95em', fontWeight: 'bold' }}>💬 報告内容の確認をお願いします</p>
                              <p style={{ margin: 0, fontSize: '0.85em', color: '#795548' }}>報告内容に食い違いがあるようです。お手数ですが、結果をご確認ください。</p>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button onClick={() => handleApprove(myCurrentMatch.id)}
                                style={{ ...btnPrimary, background: '#2e7d32' }}>✔ 結果を修正する</button>
                              <button onClick={() => handleDispute(myCurrentMatch.id, myReported === 'draw' ? null : myReported, myReported === 'draw')}
                                style={{ ...btnPrimary, background: '#f57c00', fontSize: '0.85em' }}>📩 運営に確認をお願いする</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // 自分だけ報告済み → 承認待ち
                  if (myReported) {
                    return (
                      <div>
                        <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 4px' }}>あなたの報告: <strong>{formatReport(myReported)}</strong></p>
                        {myCurrentMatch.status === 'disputed' ? (
                          <p style={{ fontSize: '0.85em', color: '#d32f2f', marginTop: 8 }}>⚠ 運営が確認中です。</p>
                        ) : (
                          <p style={{ fontSize: '0.85em', color: '#f57c00', marginTop: 8 }}>⏳ 相手の承認を待っています...</p>
                        )}
                      </div>
                    );
                  }

                  // どちらも未報告 → 通常の報告UI
                  return (
                    <div>
                      <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 8px' }}>勝敗を報告してください：</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => handleReport(myCurrentMatch.id, user.id, false)}
                          style={{ ...btnPrimary, background: '#2e7d32' }}>勝ち</button>
                        <button onClick={() => handleReport(myCurrentMatch.id, isP1 ? myCurrentMatch.player2_id : myCurrentMatch.player1_id, false)}
                          style={btnDanger}>負け</button>
                        <button onClick={() => handleReport(myCurrentMatch.id, null, true)}
                          style={btnSecondary}>引き分け</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
          </fieldset>
        )}

        {/* 成績・順位表 */}
        {participants.length > 0 && (
          <section style={{ marginBottom: '1.5em' }}>
            <h3 style={{ fontSize: '1em', borderBottom: '1px solid #eee', paddingBottom: 6 }}>
              {event.status === 'finished' ? '🏆 最終順位' : '📊 現在の順位'}
            </h3>
            <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>プレイヤー</th>
                  <th style={thStyle}>勝</th>
                  <th style={thStyle}>敗</th>
                  <th style={thStyle}>分</th>
                  <th style={thStyle}>Pts</th>
                  <th style={thStyle}>OMW%</th>
                </tr>
              </thead>
              <tbody>
                {sortedStandings.map((s, i) => {
                  const isMe = s.uid === user?.id;
                  const isFirst = getRank(i) === 1 && event.status === 'finished';
                  return (
                    <tr key={s.uid} style={{ background: isFirst ? '#fff9c4' : isMe ? '#e3f2fd' : 'transparent' }}>
                      <td style={tdStyle}><strong>{getRank(i)}</strong></td>
                      <td style={tdStyle}>{getName(s.uid)}</td>
                      <td style={tdStyle}>{s.wins}</td>
                      <td style={tdStyle}>{s.losses}</td>
                      <td style={tdStyle}>{s.draws}</td>
                      <td style={tdStyle}><strong>{s.points}</strong></td>
                      <td style={tdStyle}>{(s.omw * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* 全ラウンドの対戦表 */}
        {rounds.length > 0 && (
          <section style={{ marginBottom: '1.5em' }}>
            <h3 style={{ fontSize: '1em', borderBottom: '1px solid #eee', paddingBottom: 6 }}>対戦結果</h3>
            {rounds.map(r => {
              const roundMatches = matches.filter(m => m.round_id === r.id).sort((a, b) => (a.table_number || 999) - (b.table_number || 999));
              return (
                <div key={r.id} style={{ marginBottom: 12 }}>
                  <h4 style={{ margin: '8px 0 4px', fontSize: '0.95em' }}>第{r.round_number}回戦</h4>
                  {roundMatches.length === 0 ? <p style={{ fontSize: '0.85em', color: '#999' }}>マッチングなし</p> : (
                    <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f5f5f5' }}>
                          <th style={thStyle}>卓</th>
                          <th style={thStyle}>プレイヤー1</th>
                          <th style={thStyle}>vs</th>
                          <th style={thStyle}>プレイヤー2</th>
                          <th style={thStyle}>結果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roundMatches.map(m => {
                          const swap = user?.id && user.id === m.player2_id;
                          const leftId = swap ? m.player2_id : m.player1_id;
                          const rightId = swap ? m.player1_id : m.player2_id;
                          return (
                          <tr key={m.id}>
                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{m.table_number || '—'}</td>
                            <td style={tdStyle}>{getName(leftId)}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>vs</td>
                            <td style={tdStyle}>{rightId ? getName(rightId) : '（不戦勝）'}</td>
                            <td style={tdStyle}>
                              {m.status === 'confirmed'
                                ? m.is_draw ? '引分'
                                  : (() => {
                                      const name = getName(m.winner_id);
                                      if (event.match_type === 'bo3' && Array.isArray(m.games)) {
                                        const cGames = m.games.filter(g => g.status === 'confirmed');
                                        const sL = cGames.filter(g => g.winner_id === leftId).length;
                                        const sR = cGames.filter(g => g.winner_id === rightId).length;
                                        if (event.status === 'finished' && cGames.length > 0) {
                                          return (
                                            <div>
                                              <div>{name} ({sL}-{sR})</div>
                                              {cGames.map(g => (
                                                <div key={g.game_number} style={{ fontSize: '0.8em', color: '#888', marginTop: 2 }}>
                                                  G{g.game_number}: {g.is_draw ? '引分' : getName(g.winner_id) + '勝'}
                                                  {(g.player1_deck || g.player2_deck) && (
                                                    <span style={{ marginLeft: 4 }}>
                                                      [{(swap ? g.player2_deck : g.player1_deck) || '?'} vs {(swap ? g.player1_deck : g.player2_deck) || '?'}]
                                                    </span>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        }
                                        return `${name} (${sL}-${sR})`;
                                      }
                                      return `${name} 勝利`;
                                    })()
                                : m.status === 'disputed' ? '⚠ 確認中'
                                : m.status === 'reported' ? '承認待ち'
                                : event.match_type === 'bo3' && Array.isArray(m.games) && m.games.some(g => g.status === 'confirmed')
                                  ? (() => {
                                      const sL = m.games.filter(g => g.status === 'confirmed' && g.winner_id === leftId).length;
                                      const sR = m.games.filter(g => g.status === 'confirmed' && g.winner_id === rightId).length;
                                      return `対戦中 (${sL}-${sR})`;
                                    })()
                                  : '未報告'}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* 参加者一覧 */}
        <section style={{ marginTop: '1.5em' }}>
          <h3 style={{ fontSize: '1em', borderBottom: '1px solid #eee', paddingBottom: 6 }}>
            参加者（{participants.length}人）
          </h3>
          {participants.length === 0 ? <p style={{ color: '#999', fontSize: '0.9em' }}>まだ参加者がいません</p> : (
            <ul style={{ margin: 0, padding: '0 0 0 1.2em', fontSize: '0.9em' }}>
              {participants.map(p => (
                <li key={p.id} style={{ marginBottom: event.status === 'finished' && p.deck_name ? 6 : 0 }}>
                  {getName(p.user_id)}
                  {event.status === 'finished' && p.deck_name && (
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: 2 }}>
                      🃏 <span
                        style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => setViewDeck({ deckName: p.deck_name, deckCards: p.deck_data, tokenCards: p.token_deck })}
                      >{p.deck_name}</span>
                      {p.deck_name_2 && (
                        <> / <span
                          style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => setViewDeck({ deckName: p.deck_name_2, deckCards: p.deck_data_2, tokenCards: p.token_deck_2 })}
                        >{p.deck_name_2}</span></>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* デッキ閲覧モーダル */}
        {viewDeck && (
          <DeckViewModal
            deckName={viewDeck.deckName}
            deckCards={viewDeck.deckCards}
            tokenCards={viewDeck.tokenCards}
            onClose={() => setViewDeck(null)}
          />
        )}
      </div>
    </div>
  );
}

const thStyle = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' };
const tdStyle = { padding: '6px 8px', borderBottom: '1px solid #eee' };

// ========== ルーティング ==========
export default function EventsPage() {
  return (
    <Routes>
      <Route index element={<EventList />} />
      <Route path=":eventId" element={<EventDetail />} />
    </Routes>
  );
}
