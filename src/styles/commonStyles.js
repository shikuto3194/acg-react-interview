// 各ページ共通のスタイル定数

export const containerStyle = { minHeight: '100vh', background: '#f5f5f5', padding: '1em' };

export const cardStyle = { maxWidth: 600, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #bbb', padding: '1.5em' };

export const btnPrimary = { background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6em 1.2em', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.95em' };

export const btnDanger = { ...btnPrimary, background: '#d32f2f' };

export const btnSecondary = { ...btnPrimary, background: '#e0e0e0', color: '#333' };

export const btnSuccess = { ...btnPrimary, background: '#2e7d32' };

export const inputStyle = { width: '100%', fontSize: '1em', padding: '0.5em', borderRadius: 6, border: '1px solid #bbb', marginBottom: '0.8em', boxSizing: 'border-box' };

export const labelStyle = { fontSize: '0.85em', color: '#555', display: 'block', marginBottom: 2 };

export const sectionTitle = { fontSize: '1em', color: '#333', borderBottom: '1px solid #eee', paddingBottom: 6, marginBottom: 12 };

// 動的 btnPrimary（disabled 対応版、MyPage 等で使用）
export const btnPrimaryDynamic = (disabled) => ({
  width: '100%', background: disabled ? '#90caf9' : '#1976d2', color: '#fff',
  fontWeight: 'bold', fontSize: '1em', border: 'none', borderRadius: 6,
  padding: '0.6em', cursor: disabled ? 'default' : 'pointer',
});
