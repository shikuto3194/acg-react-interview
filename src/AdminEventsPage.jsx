/**
 * AdminEventsPage.jsx
 * 管理者専用ページ（イベント運営）
 * - イベント作成・編集・削除
 * - ラウンド開始・マッチング実行・ラウンド確定
 * - 参加者管理
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase, APP_GAME_ID } from './supabaseClient';
import { useNavigate } from 'react-router-dom';
import DeckViewModal from './DeckViewModal';
import { calculateStandings } from './utils/calculateStandings';
import { migrateParticipantDecks } from './utils/deckIdMigration';
import { containerStyle, btnPrimary, btnDanger, btnSecondary, btnSuccess, inputStyle, labelStyle } from './styles/commonStyles';

const adminCardStyle = { maxWidth: 640, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #bbb', padding: '1.5em' };

export default function AdminEventsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // イベント一覧
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // イベント作成フォーム
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newFormat, setNewFormat] = useState('swiss');
  const [newMatchType, setNewMatchType] = useState('bo1');
  const [newMaxRounds, setNewMaxRounds] = useState(3);
  const [newDeckCount, setNewDeckCount] = useState(1);

  // イベント詳細
  const [participants, setParticipants] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [matches, setMatches] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [showDeckNames, setShowDeckNames] = useState(false);

  // デッキ閲覧モーダル用
  const [viewDeck, setViewDeck] = useState(null); // { deckName, deckCards, tokenCards }

  // 順位計算（matches / participants が変わらない限りキャッシュ）
  const standingsResult = useMemo(
    () => calculateStandings(matches, participants),
    [matches, participants]
  );

  // 管理者チェック（認証ロード完了を待つ）
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/login'); return; }
    (async () => {
      const { data, error } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
      if (error) {
        console.error('Admin check error:', error);
        alert('プロフィール取得エラー: ' + error.message);
        navigate('/');
        setLoading(false);
        return;
      }
      if (data?.role === 'admin') {
        setIsAdmin(true);
      } else {
        alert('管理者権限がありません');
        navigate('/');
      }
      setLoading(false);
    })();
  }, [user, authLoading, navigate]);

  // イベント一覧取得
  const fetchEvents = async () => {
    const { data } = await supabase.from('events').select('*').eq('game', APP_GAME_ID).order('date', { ascending: false });
    setEvents(data || []);
  };

  useEffect(() => { if (isAdmin) fetchEvents(); }, [isAdmin]);

  // イベント作成
  const handleCreateEvent = async () => {
    if (!newName.trim()) { alert('イベント名を入力してください'); return; }
    const { error } = await supabase.from('events').insert({
      name: newName.trim(),
      date: newDate,
      format: newFormat,
      match_type: newMatchType,
      max_rounds: newMaxRounds,
      deck_count: newDeckCount,
      created_by: user.id,
      game: APP_GAME_ID,
    });
    if (error) { alert('作成失敗: ' + error.message); return; }
    setNewName('');
    setShowCreate(false);
    await fetchEvents();
  };

  // イベント削除
  const handleDeleteEvent = async (id) => {
    if (!window.confirm('このイベントを削除しますか？関連データも全て削除されます。')) return;
    const { error } = await supabase.from('events').delete().eq('id', id).eq('game', APP_GAME_ID);
    if (error) { alert('削除失敗: ' + error.message); return; }
    setSelectedEvent(null);
    await fetchEvents();
  };

  // イベント詳細取得
  const fetchEventDetail = async (eventId) => {
    const [partRes, roundRes, matchRes] = await Promise.all([
      supabase.from('event_participants').select('*').eq('event_id', eventId),
      supabase.from('event_rounds').select('*').eq('event_id', eventId).order('round_number'),
      supabase.from('round_matches').select('*').eq('event_id', eventId),
    ]);
    // 登録デッキは登録時点の ID スナップショット。新弾追加でずれた旧世代の ID を補正する。
    setParticipants((partRes.data || []).map(migrateParticipantDecks));
    setRounds(roundRes.data || []);
    setMatches(matchRes.data || []);

    const userIds = [...new Set((partRes.data || []).map(p => p.user_id))];
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
      const map = {};
      (profs || []).forEach(p => { map[p.user_id] = p.display_name || '名無し'; });
      setProfiles(map);
    }
  };

  const selectEvent = async (ev) => {
    setSelectedEvent(ev);
    setShowDeckNames(false);
    await fetchEventDetail(ev.id);
  };

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

  // ステータス変更
  const updateEventStatus = async (status) => {
    const { error } = await supabase.from('events').update({ status }).eq('id', selectedEvent.id).eq('game', APP_GAME_ID);
    if (error) { alert('ステータス変更失敗: ' + error.message); return; }
    const updated = { ...selectedEvent, status };
    setSelectedEvent(updated);
    await fetchEvents();
  };

  // --- マッチング（スイスドロー） ---
  const generateSwissMatching = (participantIds, previousMatches) => {
    // 成績を集計
    const stats = {};
    participantIds.forEach(id => { stats[id] = { wins: 0, losses: 0, draws: 0, points: 0, opponents: new Set() }; });

    previousMatches.filter(m => m.status === 'confirmed').forEach(m => {
      if (stats[m.player1_id]) stats[m.player1_id].opponents.add(m.player2_id);
      if (m.player2_id && stats[m.player2_id]) stats[m.player2_id].opponents.add(m.player1_id);
      if (m.is_draw) {
        if (stats[m.player1_id]) stats[m.player1_id].draws++;
        if (m.player2_id && stats[m.player2_id]) stats[m.player2_id].draws++;
      } else if (m.winner_id) {
        if (stats[m.winner_id]) stats[m.winner_id].wins++;
        const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
        if (loserId && stats[loserId]) stats[loserId].losses++;
      }
    });

    Object.values(stats).forEach(s => { s.points = s.wins * 3 + s.draws; });

    // ポイント順にソート（同ポイントはランダム）
    const sorted = [...participantIds].sort((a, b) => {
      const diff = (stats[b]?.points || 0) - (stats[a]?.points || 0);
      return diff !== 0 ? diff : Math.random() - 0.5;
    });

    // 同ポイントのグループ内でマッチング（既対戦を避ける）
    const paired = [];
    const used = new Set();

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i])) continue;
      let matched = false;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j])) continue;
        // 既対戦チェック
        if (stats[sorted[i]]?.opponents.has(sorted[j])) continue;
        paired.push([sorted[i], sorted[j]]);
        used.add(sorted[i]);
        used.add(sorted[j]);
        matched = true;
        break;
      }
      if (!matched && !used.has(sorted[i])) {
        // マッチできない場合は既対戦でも組む or 不戦勝
        let fallback = false;
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j])) continue;
          paired.push([sorted[i], sorted[j]]);
          used.add(sorted[i]);
          used.add(sorted[j]);
          fallback = true;
          break;
        }
        if (!fallback) {
          // 奇数人数 → 不戦勝
          paired.push([sorted[i], null]);
          used.add(sorted[i]);
        }
      }
    }

    return paired;
  };

  // ラウンド開始（マッチング生成）
  const startNextRound = async () => {
    const nextRound = (selectedEvent.current_round || 0) + 1;
    if (nextRound > selectedEvent.max_rounds) {
      alert(`最大ラウンド数(${selectedEvent.max_rounds})に達しています`);
      return;
    }

    // デッキ未登録チェック
    const is2deck = selectedEvent.deck_count === 2;
    const unregistered = participants.filter(p => {
      if (!p.deck_name) return true;
      if (is2deck && !p.deck_name_2) return true;
      return false;
    });
    if (unregistered.length > 0) {
      const names = unregistered.map(p => getName(p.user_id)).join('、');
      alert(`デッキ未登録の参加者がいます。\n${names}\n\n全員がデッキを登録してから開始してください。`);
      return;
    }

    const participantIds = participants.map(p => p.user_id);
    if (participantIds.length < 2) {
      alert('参加者が2人以上必要です');
      return;
    }

    // ラウンド作成
    const { data: roundData, error: roundError } = await supabase
      .from('event_rounds')
      .insert({ event_id: selectedEvent.id, round_number: nextRound, status: 'in_progress' })
      .select()
      .single();

    if (roundError) { alert('ラウンド作成失敗: ' + roundError.message); return; }

    // マッチング生成
    const allMatches = matches; // 全マッチ履歴
    const pairs = generateSwissMatching(participantIds, allMatches);

    // マッチ登録（不戦勝を末尾に回し、実対戦の上位ペアに若い卓番号を割り当て）
    const realPairs = pairs.filter(([, p2]) => p2 != null);
    const byePairs = pairs.filter(([, p2]) => p2 == null);
    const orderedPairs = [...realPairs, ...byePairs];
    const matchInserts = orderedPairs.map(([p1, p2], idx) => ({
      round_id: roundData.id,
      event_id: selectedEvent.id,
      player1_id: p1,
      player2_id: p2,
      status: p2 ? 'pending' : 'confirmed', // 不戦勝は即確定
      winner_id: p2 ? null : p1,
      games: [],
      table_number: idx + 1,
    }));

    const { error: matchError } = await supabase.from('round_matches').insert(matchInserts);
    if (matchError) {
      // マッチ挿入失敗 → 作成済みラウンドを削除（ロールバック）
      await supabase.from('event_rounds').delete().eq('id', roundData.id);
      alert('マッチング登録失敗: ' + matchError.message);
      return;
    }

    // イベント更新
    const { error: eventError } = await supabase.from('events').update({ current_round: nextRound, status: 'in_progress' }).eq('id', selectedEvent.id).eq('game', APP_GAME_ID);
    if (eventError) { alert('イベント更新失敗: ' + eventError.message); return; }
    setSelectedEvent({ ...selectedEvent, current_round: nextRound, status: 'in_progress' });

    await fetchEventDetail(selectedEvent.id);
    alert(`第${nextRound}回戦のマッチングを作成しました`);
  };

  // マッチ結果の強制確定（全マッチ対応、修正含む）
  const forceConfirmMatch = async (matchId, winnerId, isDraw) => {
    const update = {
      status: 'confirmed',
      is_draw: isDraw,
      winner_id: isDraw ? null : winnerId,
    };
    const { error } = await supabase.from('round_matches').update(update).eq('id', matchId);
    if (error) { alert('確定失敗: ' + error.message); return; }
    await fetchEventDetail(selectedEvent.id);
  };

  // BO3: 個別試合の強制確定
  const forceConfirmGame = async (matchId, gameNumber, winnerId, isDraw) => {
    const { data: match } = await supabase.from('round_matches').select('*').eq('id', matchId).single();
    if (!match) return;
    const games = JSON.parse(JSON.stringify(match.games || []));
    const game = games.find(g => g.game_number === gameNumber);
    if (!game) return;
    game.winner_id = isDraw ? null : winnerId;
    game.is_draw = isDraw;
    game.status = 'confirmed';
    game.player1_reported = isDraw ? 'draw' : winnerId;
    game.player2_reported = isDraw ? 'draw' : winnerId;
    const confirmedGames = games.filter(g => g.status === 'confirmed');
    let p1w = 0, p2w = 0;
    confirmedGames.forEach(g => {
      if (g.winner_id === match.player1_id) p1w++;
      else if (g.winner_id === match.player2_id) p2w++;
    });
    const upd = { games };
    if (p1w >= 2 || p2w >= 2) {
      upd.status = 'confirmed';
      upd.winner_id = p1w >= 2 ? match.player1_id : match.player2_id;
      upd.is_draw = false;
    } else if (confirmedGames.length >= 3) {
      upd.status = 'confirmed';
      if (p1w > p2w) {
        upd.winner_id = match.player1_id;
        upd.is_draw = false;
      } else if (p2w > p1w) {
        upd.winner_id = match.player2_id;
        upd.is_draw = false;
      } else {
        upd.winner_id = null;
        upd.is_draw = true;
      }
    } else {
      upd.status = 'pending';
    }
    const { error } = await supabase.from('round_matches').update(upd).eq('id', matchId);
    if (error) { alert('確定失敗: ' + error.message); return; }
    await fetchEventDetail(selectedEvent.id);
  };

  // 現在のラウンドを再マッチング（全マッチがpendingのときのみ）
  const rematchCurrentRound = async () => {
    if (!window.confirm('現在のラウンドのマッチングを削除し、成績に基づいて再マッチングしますか？')) return;

    const currentRound = rounds.find(r => r.round_number === selectedEvent.current_round);
    if (!currentRound) return;

    const currentRoundMatches = matches.filter(m => m.round_id === currentRound.id);
    // 全マッチがpendingか確認
    if (!currentRoundMatches.every(m => m.status === 'pending')) {
      alert('既に報告が始まっているマッチがあるため、再マッチングできません。');
      return;
    }

    // 現在ラウンドのマッチを削除
    const matchIds = currentRoundMatches.map(m => m.id);
    const { error: delError } = await supabase.from('round_matches').delete().in('id', matchIds);
    if (delError) { alert('マッチ削除失敗: ' + delError.message); return; }

    // 過去ラウンドの確定済みマッチを取得して再マッチング
    const { data: freshMatches } = await supabase.from('round_matches').select('*').eq('event_id', selectedEvent.id);
    const participantIds = participants.map(p => p.user_id);
    const pairs = generateSwissMatching(participantIds, freshMatches || []);

    const realPairs2 = pairs.filter(([, p2]) => p2 != null);
    const byePairs2 = pairs.filter(([, p2]) => p2 == null);
    const orderedPairs2 = [...realPairs2, ...byePairs2];
    const matchInserts = orderedPairs2.map(([p1, p2], idx) => ({
      round_id: currentRound.id,
      event_id: selectedEvent.id,
      player1_id: p1,
      player2_id: p2,
      status: p2 ? 'pending' : 'confirmed',
      winner_id: p2 ? null : p1,
      games: [],
      table_number: idx + 1,
    }));

    const { error } = await supabase.from('round_matches').insert(matchInserts);
    if (error) { alert('再マッチング失敗: ' + error.message); return; }

    await fetchEventDetail(selectedEvent.id);
    alert(`第${selectedEvent.current_round}回戦を再マッチングしました`);
  };

  // イベント終了
  const finishEvent = async () => {
    if (!window.confirm('このイベントを終了しますか？')) return;
    const { error } = await supabase.from('events').update({ status: 'finished' }).eq('id', selectedEvent.id).eq('game', APP_GAME_ID);
    if (error) { alert('イベント終了失敗: ' + error.message); return; }
    setSelectedEvent({ ...selectedEvent, status: 'finished' });
    await fetchEvents();
  };

  const getName = (userId) => profiles[userId] || '名無し';

  if (loading) return <div style={containerStyle}><div style={adminCardStyle}><p>読み込み中...</p></div></div>;
  if (!isAdmin) return null;

  // === イベント詳細画面 ===
  if (selectedEvent) {
    const currentRound = rounds.find(r => r.round_number === selectedEvent.current_round);
    const currentMatches = currentRound ? matches.filter(m => m.round_id === currentRound.id) : [];
    const allConfirmed = currentMatches.length > 0 && currentMatches.every(m => m.status === 'confirmed');
    const canStartNext = selectedEvent.status === 'in_progress' &&
      (selectedEvent.current_round === 0 || allConfirmed) &&
      selectedEvent.current_round < selectedEvent.max_rounds;

    // 全勝者判定（全ラウンド確定済みマッチから成績集計）
    const confirmedMatches = matches.filter(m => m.status === 'confirmed');
    const roundStats = {};
    participants.forEach(p => { roundStats[p.user_id] = { wins: 0, losses: 0 }; });
    confirmedMatches.forEach(m => {
      if (m.is_draw) return;
      if (m.winner_id && roundStats[m.winner_id]) roundStats[m.winner_id].wins++;
      const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
      if (loserId && roundStats[loserId]) roundStats[loserId].losses++;
    });
    const currentRoundNum = selectedEvent.current_round || 0;
    const undefeatedPlayers = Object.entries(roundStats).filter(([, s]) => s.losses === 0 && s.wins > 0);
    const hasUniquWinner = currentRoundNum > 0 && undefeatedPlayers.length <= 1;

    return (
      <div style={containerStyle}>
        <div style={adminCardStyle}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
              <button onClick={() => setSelectedEvent(null)} style={{ ...btnSecondary, fontSize: '0.85em' }}>一覧</button>
              <button onClick={() => navigate('/mypage')} style={{ ...btnSecondary, fontSize: '0.85em' }}>マイページ</button>
              <button onClick={() => navigate('/')} style={{ ...btnSecondary, fontSize: '0.85em' }}>トップ</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{selectedEvent.name}</h2>
              <span style={{ fontSize: '0.85em', color: '#888', flexShrink: 0, marginLeft: 8 }}>管理画面</span>
            </div>
          </div>
          <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '1em' }}>
            ステータス: <strong>{selectedEvent.status}</strong> ・ {selectedEvent.deck_count === 2 ? '2デッキ制' : '1デッキ制'} ・ 第{selectedEvent.current_round}/{selectedEvent.max_rounds}回戦
          </div>

          {/* 全勝者確定の案内 */}
          {hasUniquWinner && selectedEvent.status === 'in_progress' && allConfirmed && (
            <div style={{ background: '#e8f5e9', border: '1px solid #66bb6a', padding: '10px 14px', borderRadius: 8, marginBottom: '1em', fontSize: '0.9em' }}>
              🏆 全勝者が確定しました（{undefeatedPlayers.length === 1 ? getName(undefeatedPlayers[0][0]) : '該当なし'}）。イベントを終了することを推奨します。
            </div>
          )}

          {/* コントロールパネル */}
          <section style={{ marginBottom: '1.5em', padding: '1em', background: '#fff3e0', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1em' }}>⚙️ 運営コントロール</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedEvent.status === 'recruiting' && (
                <button onClick={() => {
                  const is2deck = selectedEvent.deck_count === 2;
                  const unreg = participants.filter(p => !p.deck_name || (is2deck && !p.deck_name_2));
                  if (unreg.length > 0) {
                    const names = unreg.map(p => getName(p.user_id)).join('、');
                    alert(`デッキ未登録の参加者がいます。\n${names}\n\n全員がデッキを登録してから締め切ってください。`);
                    return;
                  }
                  updateEventStatus('in_progress');
                }} style={btnPrimary}>募集を締め切る</button>
              )}
              {canStartNext && (
                <button onClick={startNextRound} style={btnSuccess}>
                  第{(selectedEvent.current_round || 0) + 1}回戦を開始
                </button>
              )}
              {selectedEvent.status === 'in_progress' && allConfirmed && selectedEvent.current_round >= selectedEvent.max_rounds && (
                <button onClick={finishEvent} style={{ ...btnPrimary, background: '#ff9800' }}>イベントを終了する</button>
              )}
              {selectedEvent.status !== 'finished' && (
                <button onClick={finishEvent} style={{ ...btnSecondary, fontSize: '0.85em' }}>強制終了</button>
              )}
              <button onClick={() => handleDeleteEvent(selectedEvent.id)} style={{ ...btnDanger, fontSize: '0.85em' }}>削除</button>
            </div>
          </section>

          {/* 参加者一覧 */}
          <section style={{ marginBottom: '1.5em' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 6 }}>
              <h3 style={{ fontSize: '1em', margin: 0 }}>
                参加者 ({participants.length}人)
              </h3>
              <button onClick={() => setShowDeckNames(v => !v)} style={{ fontSize: '0.8em', padding: '3px 10px', cursor: 'pointer', background: showDeckNames ? '#fff3e0' : '#f5f5f5', border: '1px solid #ccc', borderRadius: 4 }}>
                {showDeckNames ? '🙈 デッキ名を隠す' : '👁 デッキ名を表示'}
              </button>
            </div>
            {(() => {
              const is2deck = selectedEvent.deck_count === 2;
              const unregCount = participants.filter(p => !p.deck_name || (is2deck && !p.deck_name_2)).length;
              return unregCount > 0 ? (
                <div style={{ background: '#fff3e0', color: '#e65100', padding: '6px 10px', borderRadius: 6, fontSize: '0.85em', marginTop: 8 }}>
                  ⚠️ デッキ未登録: {unregCount}人 — 全員登録するまで対戦を開始できません
                </div>
              ) : null;
            })()}
            {participants.length === 0 ? <p style={{ color: '#999', fontSize: '0.9em' }}>なし</p> : (
              <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={thStyle}>名前</th>
                    <th style={thStyle}>デッキ1</th>
                    {selectedEvent.deck_count === 2 && <th style={thStyle}>デッキ2</th>}
                    <th style={thStyle}>登録日</th>
                    {selectedEvent.status === 'recruiting' && <th style={thStyle}>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id}>
                      <td style={tdStyle}>{getName(p.user_id)}</td>
                      <td style={tdStyle}>
                        {!p.deck_name
                          ? <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>⚠ 未登録</span>
                          : showDeckNames ? <span
                            style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}
                            onClick={() => setViewDeck({ deckName: p.deck_name, deckCards: p.deck_data, tokenCards: p.token_deck })}
                          >{p.deck_name}</span> : <span style={{ color: '#aaa' }}>●●●</span>}
                      </td>
                      {selectedEvent.deck_count === 2 && (
                        <td style={tdStyle}>
                          {!p.deck_name_2
                            ? <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>⚠ 未登録</span>
                            : showDeckNames ? <span
                              style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}
                              onClick={() => setViewDeck({ deckName: p.deck_name_2, deckCards: p.deck_data_2, tokenCards: p.token_deck_2 })}
                            >{p.deck_name_2}</span> : <span style={{ color: '#aaa' }}>●●●</span>}
                        </td>
                      )}
                      <td style={tdStyle}>{new Date(p.registered_at).toLocaleDateString()}</td>
                      {selectedEvent.status === 'recruiting' && (
                        <td style={tdStyle}>
                          <button onClick={async () => {
                            if (!window.confirm(`${getName(p.user_id)} の参加を取り消しますか？`)) return;
                            const { error } = await supabase.from('event_participants').delete().eq('id', p.id);
                            if (error) { alert('参加取り消し失敗: ' + error.message); return; }
                            await fetchEventDetail(selectedEvent.id);
                          }} style={{ fontSize: '0.75em', padding: '2px 8px', cursor: 'pointer', background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 4, color: '#d32f2f' }}>
                            取消
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* disputed通知バナー */}
          {(() => {
            const disputedMatches = matches.filter(m => m.status === 'disputed');
            if (disputedMatches.length === 0) return null;
            return (
              <div style={{ background: '#fff3e0', border: '2px solid #ff9800', borderRadius: 8, padding: '10px 14px', marginBottom: '1em' }}>
                <p style={{ margin: 0, fontWeight: 'bold', color: '#e65100' }}>⚠ 確認が必要な対戦が {disputedMatches.length} 件あります</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.85em', color: '#795548' }}>報告内容に食い違いがある対戦があります。下の対戦一覧から結果を確定してください。</p>
              </div>
            );
          })()}

          {/* 各ラウンドの対戦と管理 */}
          {rounds.map(r => {
            const roundMatches = matches.filter(m => m.round_id === r.id).sort((a, b) => (a.table_number || 999) - (b.table_number || 999));
            const isCurrentRound = r.round_number === selectedEvent.current_round;
            const allPending = roundMatches.length > 0 && roundMatches.every(m => m.status === 'pending' || (!m.player2_id && m.status === 'confirmed'));
            return (
              <section key={r.id} style={{ marginBottom: '1.5em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 6 }}>
                  <h3 style={{ fontSize: '1em', margin: 0 }}>
                    第{r.round_number}回戦
                  </h3>
                  {isCurrentRound && allPending && selectedEvent.status === 'in_progress' && (
                    <button onClick={rematchCurrentRound}
                      style={{ fontSize: '0.75em', padding: '3px 10px', cursor: 'pointer', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 4, color: '#e65100' }}>
                      🔄 再マッチング
                    </button>
                  )}
                </div>
                {roundMatches.length === 0 ? <p style={{ fontSize: '0.85em', color: '#999' }}>マッチなし</p> : (
                  <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5' }}>
                        <th style={thStyle}>卓</th>
                        <th style={thStyle}>P1</th>
                        <th style={thStyle}>P2</th>
                        <th style={thStyle}>結果</th>
                        {selectedEvent.status !== 'finished' && <th style={thStyle}>操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {roundMatches.map(m => {
                        const swap = user?.id && user.id === m.player2_id;
                        const leftId = swap ? m.player2_id : m.player1_id;
                        const rightId = swap ? m.player1_id : m.player2_id;
                        const leftName = getName(leftId);
                        const rightName = rightId ? getName(rightId) : null;
                        const isLeftWin = m.status === 'confirmed' && !m.is_draw && m.winner_id === leftId;
                        const isRightWin = m.status === 'confirmed' && !m.is_draw && m.winner_id === rightId;
                        const isDraw = m.status === 'confirmed' && m.is_draw;
                        const statusBg = m.status === 'disputed' ? '#fff3e0' : m.status === 'reported' ? '#e8f5e9' : 'transparent';
                        return (
                          <tr key={m.id} style={{ background: statusBg }}>
                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{m.table_number || '—'}</td>
                            <td style={tdStyle}>{leftName}</td>
                            <td style={tdStyle}>{rightName || '(不戦勝)'}</td>
                            <td style={tdStyle}>
                              {m.status === 'confirmed'
                                ? m.is_draw ? '✅ 引分'
                                  : (() => {
                                      const name = getName(m.winner_id);
                                      if (selectedEvent.match_type === 'bo3' && Array.isArray(m.games)) {
                                        const sL = m.games.filter(g => g.status === 'confirmed' && g.winner_id === leftId).length;
                                        const sR = m.games.filter(g => g.status === 'confirmed' && g.winner_id === rightId).length;
                                        return `✅ ${name} (${sL}-${sR})`;
                                      }
                                      return `✅ ${name} 勝利`;
                                    })()
                                : m.status === 'disputed' ? '⚠️ 確認中'
                                : m.status === 'reported' ? '📋 承認待ち'
                                : selectedEvent.match_type === 'bo3' && Array.isArray(m.games) && m.games.some(g => g.status === 'confirmed')
                                  ? (() => {
                                      const sL = m.games.filter(g => g.status === 'confirmed' && g.winner_id === leftId).length;
                                      const sR = m.games.filter(g => g.status === 'confirmed' && g.winner_id === rightId).length;
                                      return `対戦中 (${sL}-${sR})`;
                                    })()
                                  : '— 未報告'}
                            </td>
                            {selectedEvent.status !== 'finished' && <td style={tdStyle}>
                              {rightName && (() => {
                                const isBo3 = selectedEvent.match_type === 'bo3';
                                const currentGame = isBo3 && Array.isArray(m.games) ? m.games.find(g => g.status === 'reported' || g.status === 'disputed') : null;
                                if (currentGame) {
                                  return (
                                    <div>
                                      <div style={{ fontSize: '0.75em', color: '#999', marginBottom: 4 }}>第{currentGame.game_number}試合を確定:</div>
                                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        <button onClick={() => forceConfirmGame(m.id, currentGame.game_number, leftId, false)}
                                          style={{ fontSize: '0.8em', padding: '3px 8px', cursor: 'pointer', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: 4 }}>
                                          {leftName}勝</button>
                                        <button onClick={() => forceConfirmGame(m.id, currentGame.game_number, rightId, false)}
                                          style={{ fontSize: '0.8em', padding: '3px 8px', cursor: 'pointer', background: '#fce4ec', color: '#c62828', border: '1px solid #ef9a9a', borderRadius: 4 }}>
                                          {rightName}勝</button>
                                        <button onClick={() => forceConfirmGame(m.id, currentGame.game_number, null, true)}
                                          style={{ fontSize: '0.8em', padding: '3px 8px', cursor: 'pointer', background: '#f5f5f5', color: '#616161', border: '1px solid #bbb', borderRadius: 4 }}>
                                          引分</button>
                                      </div>
                                      <div style={{ borderTop: '1px dashed #ddd', marginTop: 6, paddingTop: 4, fontSize: '0.7em', color: '#999' }}>マッチ全体:</div>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              {rightName && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button onClick={() => forceConfirmMatch(m.id, leftId, false)}
                                    style={{ fontSize: '0.85em', padding: '4px 10px', cursor: 'pointer', fontWeight: isLeftWin ? 'bold' : 'normal', background: isLeftWin ? '#1565c0' : '#e3f2fd', color: isLeftWin ? '#fff' : '#1565c0', border: isLeftWin ? '2px solid #1565c0' : '1px solid #90caf9', borderRadius: 6 }}>
                                    {leftName}勝
                                  </button>
                                  <button onClick={() => forceConfirmMatch(m.id, rightId, false)}
                                    style={{ fontSize: '0.85em', padding: '4px 10px', cursor: 'pointer', fontWeight: isRightWin ? 'bold' : 'normal', background: isRightWin ? '#c62828' : '#fce4ec', color: isRightWin ? '#fff' : '#c62828', border: isRightWin ? '2px solid #c62828' : '1px solid #ef9a9a', borderRadius: 6 }}>
                                    {rightName}勝
                                  </button>
                                  <button onClick={() => forceConfirmMatch(m.id, null, true)}
                                    style={{ fontSize: '0.85em', padding: '4px 10px', cursor: 'pointer', fontWeight: isDraw ? 'bold' : 'normal', background: isDraw ? '#616161' : '#f5f5f5', color: isDraw ? '#fff' : '#616161', border: isDraw ? '2px solid #616161' : '1px solid #bbb', borderRadius: 6 }}>
                                    引分
                                  </button>
                                </div>
                              )}
                            </td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}

          {/* 順位表（standingsResult は useMemo 済み） */}
          {participants.length > 0 && (
            <section style={{ marginBottom: '1.5em' }}>
              <h3 style={{ fontSize: '1em', borderBottom: '1px solid #eee', paddingBottom: 6 }}>
                {selectedEvent.status === 'finished' ? '🏆 最終順位' : '📊 現在の順位'}
              </h3>
              <table style={{ width: '100%', fontSize: '0.85em', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>名前</th>
                    <th style={thStyle}>勝</th>
                    <th style={thStyle}>敗</th>
                    <th style={thStyle}>分</th>
                    <th style={thStyle}>Pts</th>
                    <th style={thStyle}>OMW%</th>
                  </tr>
                </thead>
                <tbody>
                  {standingsResult.sortedStandings.map((s, i) => (
                    <tr key={s.uid} style={i === 0 && selectedEvent.status === 'finished' ? { background: '#fff9c4' } : {}}>
                      <td style={tdStyle}><strong>{standingsResult.getRank(i)}</strong></td>
                      <td style={tdStyle}>{getName(s.uid)}</td>
                      <td style={tdStyle}>{s.wins}</td>
                      <td style={tdStyle}>{s.losses}</td>
                      <td style={tdStyle}>{s.draws}</td>
                      <td style={tdStyle}><strong>{s.points}</strong></td>
                      <td style={tdStyle}>{(s.omw * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* デッキ閲覧モーダル（イベント詳細画面用） */}
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

  // === イベント一覧画面 ===
  return (
    <div style={containerStyle}>
      <div style={adminCardStyle}>
        <div style={{ marginBottom: '1em' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
            <button onClick={() => navigate('/mypage')} style={{ ...btnSecondary, fontSize: '0.85em' }}>マイページ</button>
            <button onClick={() => navigate('/')} style={{ ...btnSecondary, fontSize: '0.85em' }}>トップ</button>
          </div>
          <h2 style={{ margin: 0 }}>🔧 管理者ページ</h2>
        </div>

        {/* イベント作成 */}
        {!showCreate ? (
          <button onClick={() => setShowCreate(true)} style={{ ...btnPrimary, marginBottom: '1em' }}>
            + 新しいイベントを作成
          </button>
        ) : (
          <div style={{ background: '#f9f9f9', padding: '1em', borderRadius: 8, marginBottom: '1em' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1em' }}>イベント作成</h3>
            <label style={labelStyle}>イベント名</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} style={inputStyle} placeholder="例: 第1回対戦会" />

            <label style={labelStyle}>開催日</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>形式</label>
            <select value={newFormat} onChange={e => setNewFormat(e.target.value)} style={inputStyle}>
              <option value="swiss">スイスドロー</option>
              <option value="round_robin">総当たり</option>
              <option value="single_elimination">トーナメント</option>
            </select>

            <label style={labelStyle}>マッチ形式</label>
            <select value={newMatchType} onChange={e => setNewMatchType(e.target.value)} style={inputStyle}>
              <option value="bo1">1本先取</option>
              <option value="bo3">2本先取(BO3)</option>
            </select>

            <label style={labelStyle}>デッキ制</label>
            <select value={newDeckCount} onChange={e => setNewDeckCount(Number(e.target.value))} style={inputStyle}>
              <option value={1}>1デッキ制</option>
              <option value={2}>2デッキ制</option>
            </select>

            <label style={labelStyle}>最大ラウンド数</label>
            <input type="number" value={newMaxRounds} onChange={e => setNewMaxRounds(Number(e.target.value))} min={1} max={20} style={inputStyle} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreateEvent} style={btnPrimary}>作成</button>
              <button onClick={() => setShowCreate(false)} style={btnSecondary}>キャンセル</button>
            </div>
          </div>
        )}

        {/* イベント一覧 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(ev => (
            <div key={ev.id} onClick={() => selectEvent(ev)}
              style={{ border: '1px solid #ddd', borderRadius: 8, padding: '0.8em', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{ev.name}</strong>
                <span style={{ fontSize: '0.85em', color: '#888' }}>{ev.status}</span>
              </div>
              <div style={{ fontSize: '0.8em', color: '#666' }}>{ev.date} ・ 第{ev.current_round}/{ev.max_rounds}回戦</div>
            </div>
          ))}
        </div>

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
