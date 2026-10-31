import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { AuthContext } from './useAuth';

// --- 認証コンテキスト ---
// アプリ全体で「今ログインしているユーザー」を共有するための仕組み。
// コンテキスト本体と useAuth フックは ./useAuth.js に定義している。

/**
 * AuthProvider: アプリ全体をこれで囲むと、
 * どのコンポーネントからでも useAuth() でユーザー情報を取得できる
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // ログイン中のユーザー情報
  const [loading, setLoading] = useState(true);  // 初期読み込み中かどうか

  useEffect(() => {
    // ページを開いた時に、既にログイン済みかチェック
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // ログイン/ログアウト時に自動で更新される仕組み
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    // クリーンアップ（コンポーネントが消える時に購読解除）
    return () => subscription.unsubscribe();
  }, []);

  // メールでログイン
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  // ログアウト
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
