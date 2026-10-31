import { createContext, useContext } from 'react';

// --- 認証コンテキスト本体 ---
// AuthProvider (AuthContext.jsx) と useAuth で共有する。
// ※ コンポーネント以外のエクスポートを .jsx から分離することで
//    react-refresh/only-export-components の警告を回避する。
export const AuthContext = createContext(null);

/**
 * useAuth(): どのコンポーネントからでも呼べる
 *
 * 使い方:
 *   const { user, signIn, signOut } = useAuth();
 *   if (user) { ... ログイン済み ... }
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth は AuthProvider の中で使ってください');
  }
  return context;
}
