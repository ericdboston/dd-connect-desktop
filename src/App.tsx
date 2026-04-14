import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ShellLayout from './pages/shell/ShellLayout';
import PagePlaceholder from './pages/shell/PagePlaceholder';
import DialpadPage from './pages/shell/DialpadPage';
import ContactsPage from './pages/shell/ContactsPage';
import RecentsPage from './pages/shell/RecentsPage';
import VoicemailPage from './pages/shell/VoicemailPage';
import SettingsPage from './pages/shell/SettingsPage';
import IncomingCallPopup from './pages/IncomingCallPopup';
import { useAuth } from './store/auth';
import { brand } from './theme';

// The incoming-call popup is a second BrowserWindow that loads the
// same renderer bundle but navigates to '#/incoming-call'. We detect
// that up front — BEFORE any store hydration or router mounting —
// and render a bare popup tree with no auth, no SIP engine, no
// router. Keeps the popup isolated from the main app's state.
const isIncomingCallPopup =
  typeof window !== 'undefined' &&
  window.location.hash.startsWith('#/incoming-call');

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

  // Popup window renders its own bare tree. No auth store, no
  // router, no shell. Detected on first render and never changes
  // for the lifetime of this renderer process.
  if (isIncomingCallPopup) {
    return <IncomingCallPopup />;
  }

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
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="recents" element={<RecentsPage />} />
          <Route path="voicemail" element={<VoicemailPage />} />
          <Route
            path="chat"
            element={<PagePlaceholder title="Chat" subtitle="Coming soon" />}
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
