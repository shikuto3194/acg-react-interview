/**
 * AdminPage.jsx
 * 管理者専用メニュー
 * - イベント運営 (/admin/events)
 * - カード管理 (/admin/cards)
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from './supabaseClient';
import { useNavigate } from 'react-router-dom';
import { containerStyle } from './styles/commonStyles';

const menuCardStyle = { maxWidth: 480, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #bbb', padding: '1.5em' };

const menuButtonStyle = {
  width: '100%',
  background: '#1976d2',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '1em 1.2em',
  fontSize: '1.05em',
  fontWeight: 'bold',
  cursor: 'pointer',
  marginBottom: '0.8em',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/login'); return; }
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      if (error) {
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

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={menuCardStyle}><p>読み込み中...</p></div>
      </div>
    );
  }
  if (!isAdmin) return null;

  return (
    <div style={containerStyle}>
      <div style={menuCardStyle}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
          <button onClick={() => navigate('/mypage')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>マイページ</button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#1976d2', cursor: 'pointer', fontSize: '0.9em' }}>トップ</button>
        </div>
        <h2 style={{ margin: '0 0 1em 0' }}>運営メニュー</h2>

        <button onClick={() => navigate('/admin/events')} style={menuButtonStyle}>
          <span style={{ fontSize: '1.4em' }}>🏆</span>
          <span>イベント運営</span>
        </button>

      </div>
    </div>
  );
}
