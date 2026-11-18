import React, { useState } from 'react';
import { useAuth } from './useAuth';
import { useLocation, useNavigate } from 'react-router-dom';
import EyeIcon from './components/EyeIcon';
import { inputStyle } from './styles/commonStyles';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { error: signInError } = await signIn(email.trim(), password);
      if (signInError) {
        setError('メールアドレスまたはパスワードが間違っています');
      } else {
        const from = location.state?.from;
        const returnTo = typeof from?.pathname === 'string'
          && from.pathname.startsWith('/')
          && !from.pathname.startsWith('//')
          ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
          : '/';
        navigate(returnTo, { replace: true });
      }
    } catch {
      setError('ログインできませんでした。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f5f5', padding: '1em',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#fff', padding: '2em', borderRadius: 12, boxShadow: '0 2px 12px #bbb',
        width: '100%', maxWidth: 360,
      }}>
        <h1 style={{ textAlign: 'center', marginBottom: '1em', fontSize: '1.35em' }}>
          面接用アカウントでログイン
        </h1>
        <label htmlFor="interview-email" style={{ fontSize: '0.9em', color: '#555' }}>
          メールアドレス
        </label>
        <input
          id="interview-email"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          autoComplete="username"
          required
          style={{ ...inputStyle, margin: '0.3em 0 1em' }}
        />
        <label htmlFor="interview-password" style={{ fontSize: '0.9em', color: '#555' }}>
          パスワード
        </label>
        <div style={{ position: 'relative', margin: '0.3em 0 1em' }}>
          <input
            id="interview-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', paddingRight: '2.5em', margin: 0 }}
          />
          <EyeIcon open={showPassword} onClick={() => setShowPassword(value => !value)} />
        </div>
        <button type="submit" disabled={submitting} style={{
          width: '100%', background: submitting ? '#90caf9' : '#1976d2', color: '#fff',
          fontWeight: 'bold', fontSize: '1.05em', border: 'none', borderRadius: 6,
          padding: '0.7em', cursor: submitting ? 'default' : 'pointer',
        }}>
          {submitting ? 'ログイン中...' : 'ログイン'}
        </button>
        {error && <p role="alert" style={{ color: '#d32f2f', marginTop: '0.8em', textAlign: 'center' }}>{error}</p>}
      </form>
    </main>
  );
}
