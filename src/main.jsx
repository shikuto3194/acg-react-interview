import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from './AuthContext.jsx'
import { useAuth } from './useAuth.js'
import './index.css'

const App = lazy(() => import('./App.jsx'))
const LoginPage = lazy(() => import('./LoginPage.jsx'))
const MyPage = lazy(() => import('./MyPage.jsx'))
const EventsPage = lazy(() => import('./EventsPage.jsx'))
const AdminPage = lazy(() => import('./AdminPage.jsx'))
const AdminEventsPage = lazy(() => import('./AdminEventsPage.jsx'))

function InterviewAuthGate({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>ログイン状態を確認しています...</div>;
  }
  if (!user && location.pathname !== '/login') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }
  return children;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InterviewAuthGate>
          <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>読み込み中...</div>}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/mypage" element={<MyPage />} />
              <Route path="/events/*" element={<EventsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/events" element={<AdminEventsPage />} />
              <Route path="/admin/cards" element={<Navigate to="/admin" replace />} />
              <Route path="/*" element={<App />} />
            </Routes>
          </Suspense>
        </InterviewAuthGate>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
