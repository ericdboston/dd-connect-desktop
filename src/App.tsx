import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ShellPlaceholder from './pages/ShellPlaceholder';
import { useAuth } from './store/auth';
import { brand } from './theme';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthed = useAuth((s) => s.isAuthed);
  const hydrating = useAuth((s) => s.hydrating);
  if (hydrating) return <BootSplash />;
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const isAuthed = useAuth((s) => s.isAuthed);
  const hydrating = useAuth((s) => s.hydrating);
  if (hydrating) return <BootSplash />;
  if (isAuthed) return <Navigate to="/shell" replace />;
  return <>{children}</>;
}

function BootSplash() {
  return (
    <div style={{
      minHeight: '100vh',
      background: brand.navy,
      color: brand.textMuted,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      letterSpacing: 2,
      textTransform: 'uppercase',
    }}>
      Loading…
    </div>
  );
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/shell"
          element={
            <RequireAuth>
              <ShellPlaceholder />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
