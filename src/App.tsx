import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ShellLayout from './pages/shell/ShellLayout';
import PagePlaceholder from './pages/shell/PagePlaceholder';
import DialpadPage from './pages/shell/DialpadPage';
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
  if (isAuthed) return <Navigate to="/shell/dialpad" replace />;
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
              <ShellLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dialpad" replace />} />
          <Route path="dialpad" element={<DialpadPage />} />
          <Route
            path="contacts"
            element={<PagePlaceholder title="Contacts" subtitle="Coming soon" />}
          />
          <Route
            path="recents"
            element={<PagePlaceholder title="Recents" subtitle="Coming soon" />}
          />
          <Route
            path="voicemail"
            element={<PagePlaceholder title="Voicemail" subtitle="Coming soon" />}
          />
          <Route
            path="chat"
            element={<PagePlaceholder title="Chat" subtitle="Coming soon" />}
          />
          <Route
            path="settings"
            element={<PagePlaceholder title="Settings" subtitle="Coming soon" />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
