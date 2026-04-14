import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { useSip } from '../../store/sip';
import { useChatUnread } from '../../store/chat';
import ActiveCallPage from './ActiveCallPage';
import { brand, fonts } from '../../theme';

const CHAT_UNREAD_POLL_MS = 20_000;

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/shell/dialpad', label: 'Dialpad', icon: '📞' },
  { to: '/shell/contacts', label: 'Contacts', icon: '👥' },
  { to: '/shell/recents', label: 'Recents', icon: '🕐' },
  { to: '/shell/voicemail', label: 'Voicemail', icon: '📬' },
  { to: '/shell/chat', label: 'Chat', icon: '💬' },
  { to: '/shell/settings', label: 'Settings', icon: '⚙️' },
];

export default function ShellLayout() {
  const display_name = useAuth((s) => s.display_name);
  const extension = useAuth((s) => s.extension);
  const sip_config = useAuth((s) => s.sip_config);
  const access = useAuth((s) => s.access);
  const authSignOut = useAuth((s) => s.signOut);
  const chatUnread = useChatUnread((s) => s.unread);
  const refreshChatUnread = useChatUnread((s) => s.refresh);
  const resetChatUnread = useChatUnread((s) => s.reset);
  const location = useLocation();

  const isRegistered = useSip((s) => s.isRegistered);
  const initSip = useSip((s) => s.init);
  const destroySip = useSip((s) => s.destroy);
  const currentCall = useSip((s) => s.currentCall);

  // Bring the Verto engine up as soon as the shell mounts with a valid
  // session. Do NOT destroy on unmount — the VertoClient lives for the
  // authed session lifetime, not the React component lifetime. React
  // StrictMode double-mounts effects in dev which would churn the
  // socket (open → close → open → close) and make mod_verto dedupe
  // sessions, producing the "socket keeps closing" symptom we chased
  // for hours. useSip.init() is idempotent (early-returns if a client
  // already exists), so repeated mounts are safe. Destruction only
  // happens on explicit sign-out below.
  useEffect(() => {
    if (sip_config) initSip(sip_config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sip_config]);

  // Poll the chat unread count so the sidebar badge tracks new
  // messages without requiring the user to open the Chat page. The
  // ChatPage itself also refreshes this store on WS open, send, and
  // incoming broadcast — polling is just the safety net for a
  // session that never opens chat at all.
  useEffect(() => {
    if (!access) return;
    void refreshChatUnread(access);
    const timer = setInterval(() => {
      if (access) void refreshChatUnread(access);
    }, CHAT_UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [access, refreshChatUnread]);

  async function signOut() {
    resetChatUnread();
    destroySip();
    // Yield one tick so the SipClient WebSocket teardown completes
    // before the auth store clears and React re-renders the tree.
    // Without this, Chromium's TLS session state can carry stale
    // keepalive sockets into the next login, causing the very next
    // /api/auth/ddconnect/ POST to fail at the transport layer.
    await new Promise((r) => setTimeout(r, 0));
    await authSignOut();
  }

  const currentTitle =
    NAV_ITEMS.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Dialpad';

  return (
    <div className="ddc-shell">
      {/* Sidebar */}
      <aside className="ddc-sidebar">
        <div className="ddc-sidebar-brand">
          <img src="/ddconnect-logo.png" alt="DD Connect" className="ddc-sidebar-logo" />
          <span className="ddc-sidebar-brand-text">DD Connect</span>
        </div>

        <nav className="ddc-nav">
          {NAV_ITEMS.map((item) => {
            const badge = item.to === '/shell/chat' && chatUnread > 0
              ? (chatUnread > 99 ? '99+' : String(chatUnread))
              : null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `ddc-nav-item${isActive ? ' ddc-nav-item-active' : ''}`
                }
              >
                <span className="ddc-nav-icon">{item.icon}</span>
                <span className="ddc-nav-label">{item.label}</span>
                {badge && <span className="ddc-nav-badge">{badge}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="ddc-sidebar-foot">
          <div className="ddc-user-row">
            <div className="ddc-user-avatar">
              {(display_name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="ddc-user-meta">
              <div className="ddc-user-name">{display_name || 'Unknown'}</div>
              <div className="ddc-user-ext">
                <span
                  className={`ddc-dot ${isRegistered ? 'ddc-dot-ok' : 'ddc-dot-bad'}`}
                />
                Ext {extension || '----'}
              </div>
            </div>
          </div>
          <button className="ddc-signout" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      {/* Right side: top bar + content */}
      <div className="ddc-main-col">
        <header className="ddc-topbar">
          <div className="ddc-topbar-title">{currentTitle}</div>
          <div className={`ddc-pill ${isRegistered ? 'ddc-pill-ok' : 'ddc-pill-bad'}`}>
            <span className={`ddc-dot ${isRegistered ? 'ddc-dot-ok' : 'ddc-dot-bad'}`} />
            {isRegistered ? 'Registered' : 'Unregistered'}
          </div>
        </header>

        <main className="ddc-content">
          {/* While a call is in progress, the active-call screen takes
              over the content area. When sip clears currentCall (call
              ended either side), we automatically fall back to whatever
              route was active. No URL change, no navigation race. */}
          {currentCall ? <ActiveCallPage /> : <Outlet />}
        </main>
      </div>

      <style>{`
        .ddc-shell {
          position: fixed;
          inset: 0;
          display: flex;
          background: #0a1550;
          color: ${brand.white};
          font-family: ${fonts.sans};
        }

        .ddc-sidebar {
          width: 220px;
          flex-shrink: 0;
          background: #071440;
          border-right: 1px solid rgba(77, 166, 255, 0.10);
          display: flex;
          flex-direction: column;
        }

        .ddc-sidebar-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 18px 18px 22px;
          border-bottom: 1px solid rgba(77, 166, 255, 0.08);
        }
        .ddc-sidebar-logo {
          width: 40px;
          height: 40px;
          object-fit: contain;
          display: block;
        }
        .ddc-sidebar-brand-text {
          font-weight: 700;
          font-size: 16px;
          letter-spacing: 1px;
          color: #f0f4ff;
        }

        .ddc-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 14px 0;
          overflow-y: auto;
        }
        .ddc-nav-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 18px 12px 16px;
          color: #c8d4f5;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.4px;
          text-decoration: none;
          border-left: 3px solid transparent;
          transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
        }
        .ddc-nav-item:hover {
          background: rgba(77, 166, 255, 0.06);
          color: ${brand.white};
        }
        .ddc-nav-item-active {
          background: rgba(77, 166, 255, 0.10);
          color: ${brand.white};
          border-left-color: ${brand.blue};
        }
        .ddc-nav-icon { font-size: 18px; line-height: 1; }
        .ddc-nav-label { line-height: 1; flex: 1; }
        .ddc-nav-badge {
          background: ${brand.blue};
          color: #0a1550;
          font-family: ${fonts.mono};
          font-size: 10px;
          font-weight: 800;
          padding: 2px 7px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
          margin-left: auto;
        }

        .ddc-sidebar-foot {
          border-top: 1px solid rgba(77, 166, 255, 0.10);
          padding: 14px 14px 16px;
        }
        .ddc-user-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ddc-user-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: ${brand.blueDim};
          color: #fff;
          font-weight: 700;
          font-size: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .ddc-user-meta {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .ddc-user-name {
          font-size: 13px;
          font-weight: 600;
          color: #f0f4ff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ddc-user-ext {
          font-family: ${fonts.mono};
          font-size: 11px;
          color: #8aa0d8;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .ddc-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ddc-dot-ok {
          background: ${brand.success};
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
        }
        .ddc-dot-bad {
          background: ${brand.red};
          box-shadow: 0 0 6px rgba(232, 19, 42, 0.6);
        }

        .ddc-signout {
          margin-top: 12px;
          width: 100%;
          background: transparent;
          color: #8aa0d8;
          border: 1px solid rgba(138, 160, 216, 0.25);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 11px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          font-weight: 600;
          cursor: pointer;
          transition: color 120ms, border-color 120ms;
        }
        .ddc-signout:hover {
          color: ${brand.white};
          border-color: ${brand.blue};
        }

        .ddc-main-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .ddc-topbar {
          height: 48px;
          flex-shrink: 0;
          background: #0d1a6e;
          border-bottom: 1px solid rgba(77, 166, 255, 0.10);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 22px;
        }
        .ddc-topbar-title {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 1.2px;
          color: #f0f4ff;
          text-transform: uppercase;
        }

        .ddc-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }
        .ddc-pill-ok {
          background: rgba(34, 197, 94, 0.10);
          color: ${brand.success};
          border: 1px solid rgba(34, 197, 94, 0.35);
        }
        .ddc-pill-bad {
          background: rgba(232, 19, 42, 0.10);
          color: ${brand.red};
          border: 1px solid rgba(232, 19, 42, 0.35);
        }

        .ddc-content {
          flex: 1;
          background: #0a1550;
          overflow: auto;
        }
      `}</style>
    </div>
  );
}
