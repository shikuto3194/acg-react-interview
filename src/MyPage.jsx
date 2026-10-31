import React, { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase, APP_GAME_ID } from './supabaseClient';
import { useNavigate } from 'react-router-dom';
import DeckViewModal from './DeckViewModal';
import EyeIcon from './components/EyeIcon';
import { calculateStandings } from './utils/calculateStandings';
import { migrateDeckSnapshot } from './utils/deckIdMigration';
import { inputStyle, labelStyle, sectionTitle, btnPrimaryDynamic } from './styles/commonStyles';

/**
 * マイページ
 * - 表示名の編集
 * - メールアドレス・パスワードの変更
 * - （今後）戦績・ランキング表示
 */
export default function MyPage() {
  // All three interview sites share one Auth account; interview users cannot change its credentials from MyPage.
  const credentialChangesAllowed = false;
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  // プロフィール
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // 管理者判定
  const [isAdmin, setIsAdmin] = useState(false);

  // パスワード変更
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwMessage, setPwMessage] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // メールアドレス変更
  const [newEmail, setNewEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState('');

  // 戦績
  const [finishedEvents, setFinishedEvents] = useState([]);
  const [viewDeck, setViewDeck] = useState(null);

  // 未ログインならログインページへ（認証ロード完了を待つ）
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // プロフィール読み込み
  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, role')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name || '');
        setIsAdmin(data.role === 'admin');
      } else if (error && error.code === 'PGRST116') {
        // プロフィールがまだない → 作成
        await supabase.from('profiles').insert({
          user_id: user.id,
          display_name: '',
          role: 'user',
        });
      }
      setLoading(false);
    };

    fetchProfile();
  }, [user]);

  // 終了イベント戦績取得
  useEffect(() => {
    if (!user) return;
    (async () => {
      // 自分が参加した終了イベントを取得
      const { data: parts } = await supabase
        .from('event_participants')
        .select('event_id, deck_name, deck_name_2, deck_data, deck_data_2, token_deck, token_deck_2')
        .eq('user_id', user.id);
      if (!parts || parts.length === 0) { setFinishedEvents([]); return; }
      const eventIds = parts.map(p => p.event_id);
      const { data: evts } = await supabase
        .from('events')
        .select('*')
        .in('id', eventIds)
        .eq('game', APP_GAME_ID)
        .eq('status', 'finished')
        .order('date', { ascending: false });
      if (!evts || evts.length === 0) { setFinishedEvents([]); return; }
      // 各イベントの全参加者・マッチを取得して順位計算
      const results = [];
      for (const ev of evts) {
        const [partRes, matchRes] = await Promise.all([
          supabase.from('event_participants').select('user_id').eq('event_id', ev.id),
          supabase.from('round_matches').select('player1_id, player2_id, winner_id, is_draw, status').eq('event_id', ev.id),
        ]);
        const allParts = partRes.data || [];
        const allMatches = matchRes.data || [];
        const { sortedStandings, getRank } = calculateStandings(allMatches, allParts);
        const myIdx = sortedStandings.findIndex(s => s.uid === user.id);
        const myStats = myIdx >= 0 ? sortedStandings[myIdx] : null;
        // 登録デッキは登録時点の ID スナップショット。旧世代のずれを補正してから渡す。
        const rawPart = parts.find(p => p.event_id === ev.id);
        const deck1 = migrateDeckSnapshot(rawPart?.deck_data, rawPart?.token_deck);
        const deck2 = migrateDeckSnapshot(rawPart?.deck_data_2, rawPart?.token_deck_2);
        results.push({
          event: ev,
          rank: myIdx >= 0 ? getRank(myIdx) : null,
          totalPlayers: allParts.length,
          stats: myStats,
          deckName: rawPart?.deck_name,
          deckName2: rawPart?.deck_name_2,
          deckData: deck1.cards,
          deckData2: deck2.cards,
          tokenDeck: deck1.tokenDeck,
          tokenDeck2: deck2.tokenDeck,
        });
      }
      setFinishedEvents(results);
    })();
  }, [user]);

  // 表示名を保存
  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage('');
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName })
      .eq('user_id', user.id);

    if (error) {
      setMessage('保存に失敗しました: ' + error.message);
    } else {
      setMessage('保存しました');
    }
    setSaving(false);
  };

  // パスワード変更
  const handleChangePassword = async () => {
    if (!credentialChangesAllowed) {
      setPwMessage('面接用の共通アカウントでは、この画面からパスワードを変更できません');
      return;
    }
    setPwMessage('');
    if (!newPassword) {
      setPwMessage('新しいパスワードを入力してください');
      return;
    }
    if (newPassword.length < 6) {
      setPwMessage('パスワードは6文字以上にしてください');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage('パスワードが一致しません');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPwMessage('変更に失敗しました: ' + error.message);
    } else {
      setPwMessage('パスワードを変更しました');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  // メールアドレス変更
  const handleChangeEmail = async () => {
    if (!credentialChangesAllowed) {
      setEmailMessage('面接用の共通アカウントでは、この画面からメールアドレスを変更できません');
      return;
    }
    setEmailMessage('');
    if (!newEmail) {
      setEmailMessage('新しいメールアドレスを入力してください');
      return;
    }
    if (newEmail === user.email) {
      setEmailMessage('現在と同じメールアドレスです');
      return;
    }
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) {
      setEmailMessage('変更に失敗しました: ' + error.message);
    } else {
      setEmailMessage('確認メールを送信しました。新しいメールアドレスのリンクをクリックして変更を完了してください。');
      setNewEmail('');
    }
  };

  if (!user) return null;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
      padding: '1em',
    }}>
      <div style={{
        maxWidth: 480,
        margin: '0 auto',
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 12px #bbb',
        padding: '1.5em',
      }}>
        <div style={{ marginBottom: '1em' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
            <button onClick={() => navigate('/events')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>イベント</button>
            <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>トップ</button>
          </div>
          <h2 style={{ margin: 0 }}>マイページ</h2>
        </div>

        {loading ? (
          <p>読み込み中...</p>
        ) : (
          <>
            {/* --- プロフィール --- */}
            <section style={{ marginBottom: '2em' }}>
              <h3 style={sectionTitle}>プロフィール</h3>
              <p role="note" style={{ color: '#555', fontSize: '0.9em' }}>
                面接用Authアカウントは3サイトで共通です。メールアドレスとパスワードの変更は管理者に依頼してください。
              </p>

              <label style={labelStyle}>メールアドレス</label>
              <div style={{ ...inputStyle, background: '#f0f0f0', color: '#888' }}>
                {user.email}
              </div>

              <label style={labelStyle}>メールアドレス変更</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="新しいメールアドレス"
                style={inputStyle}
                disabled={!credentialChangesAllowed}
              />
              <button onClick={handleChangeEmail} disabled={!credentialChangesAllowed} style={btnPrimaryDynamic(!credentialChangesAllowed)}>
                メールアドレスを変更
              </button>
              {emailMessage && (
                <div style={{
                  color: emailMessage.includes('失敗') || emailMessage.includes('同じ') ? '#d32f2f' : '#2e7d32',
                  marginTop: '0.5em', fontSize: '0.9em',
                }}>
                  {emailMessage}
                </div>
              )}

              <label style={labelStyle}>表示名（ニックネーム）</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="表示名を入力"
                style={inputStyle}
                maxLength={30}
              />

              <button
                onClick={handleSaveProfile}
                disabled={saving}
                style={btnPrimaryDynamic(saving)}
              >
                {saving ? '保存中...' : '表示名を保存'}
              </button>
              {message && (
                <div style={{
                  color: message.includes('失敗') ? '#d32f2f' : '#2e7d32',
                  marginTop: '0.5em', fontSize: '0.9em',
                }}>
                  {message}
                </div>
              )}
            </section>

            {/* --- パスワード変更 --- */}
            <section style={{ marginBottom: '2em' }}>
              <h3 style={sectionTitle}>パスワード変更</h3>

              <label style={labelStyle}>新しいパスワード</label>
              <div style={{ position:'relative', marginBottom: '0.8em' }}>
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="6文字以上"
                  autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: '2.5em', marginBottom: 0 }}
                  disabled={!credentialChangesAllowed}
                />
                <EyeIcon open={showNewPw} onClick={() => setShowNewPw(v => !v)} />
              </div>

              <label style={labelStyle}>パスワード確認</label>
              <div style={{ position:'relative', marginBottom: '0.8em' }}>
                <input
                  type={showConfirmPw ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: '2.5em', marginBottom: 0 }}
                  disabled={!credentialChangesAllowed}
                />
                <EyeIcon open={showConfirmPw} onClick={() => setShowConfirmPw(v => !v)} />
              </div>

              <button onClick={handleChangePassword} disabled={!credentialChangesAllowed} style={btnPrimaryDynamic(!credentialChangesAllowed)}>
                パスワードを変更
              </button>
              {pwMessage && (
                <div style={{
                  color: pwMessage.includes('失敗') ? '#d32f2f' : '#2e7d32',
                  marginTop: '0.5em', fontSize: '0.9em',
                }}>
                  {pwMessage}
                </div>
              )}
            </section>

            {/* --- 戦績 --- */}
            <section style={{ marginBottom: '2em' }}>
              <h3 style={sectionTitle}>戦績</h3>
              {finishedEvents.length === 0 ? (
                <p style={{ color: '#999', fontSize: '0.9em' }}>
                  対戦イベントに参加すると、ここに戦績が表示されます。
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {finishedEvents.map(fe => (
                    <div key={fe.event.id}
                      onClick={() => navigate(`/events/${fe.event.id}`)}
                      style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: '0.8em 1em', cursor: 'pointer', background: fe.rank === 1 ? '#fffde7' : '#fafafa', transition: 'box-shadow 0.2s' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.95em' }}>{fe.event.name}</strong>
                        <span style={{ fontSize: '0.8em', color: '#999' }}>{fe.event.date}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: '1.1em', fontWeight: 'bold', color: fe.rank === 1 ? '#f9a825' : '#333' }}>
                          {fe.rank === 1 ? '🏆' : ''} {fe.rank}位
                          <span style={{ fontSize: '0.75em', fontWeight: 'normal', color: '#999', marginLeft: 4 }}>/ {fe.totalPlayers}人</span>
                        </span>
                        {fe.stats && (
                          <span style={{ fontSize: '0.8em', color: '#666' }}>
                            {fe.stats.wins}勝 {fe.stats.losses}敗 {fe.stats.draws > 0 ? `${fe.stats.draws}分` : ''}
                          </span>
                        )}
                      </div>
                      {fe.deckName && (
                        <div style={{ fontSize: '0.8em', color: '#888', marginTop: 4 }}>
                          🃏 <span
                            style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); setViewDeck({ deckName: fe.deckName, deckCards: fe.deckData, tokenCards: fe.tokenDeck }); }}
                          >{fe.deckName}</span>
                          {fe.deckName2 && (
                            <> / <span
                              style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); setViewDeck({ deckName: fe.deckName2, deckCards: fe.deckData2, tokenCards: fe.tokenDeck2 }); }}
                            >{fe.deckName2}</span></>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* --- 管理者メニュー --- */}
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                style={{
                  width: '100%', background: '#1976d2', color: '#fff',
                  border: 'none', borderRadius: 6, padding: '0.7em',
                  fontSize: '1em', cursor: 'pointer', fontWeight: 'bold',
                  marginBottom: '0.6em',
                }}
              >
                🔧 運営・管理
              </button>
            )}

            {/* デッキ閲覧モーダル */}
            {viewDeck && (
              <DeckViewModal
                deckName={viewDeck.deckName}
                deckCards={viewDeck.deckCards}
                tokenCards={viewDeck.tokenCards}
                onClose={() => setViewDeck(null)}
              />
            )}

            {/* --- ログアウト --- */}
            <button
              onClick={async () => { await signOut(); navigate('/'); }}
              style={{
                width: '100%', background: '#e0e0e0', color: '#333',
                border: 'none', borderRadius: 6, padding: '0.7em',
                fontSize: '1em', cursor: 'pointer',
              }}
            >
              ログアウト
            </button>
          </>
        )}
      </div>
    </div>
  );
}

