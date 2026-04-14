import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { useSip } from '../../store/sip';
import { listExtensions, listRegistrations, type Extension } from '../../api/contacts';
import { getOrCreateConversationByExtension } from '../../api/chat';
import { extractErrorMessage } from '../../api/client';
import { brand, fonts } from '../../theme';

const REFRESH_REGISTRATIONS_MS = 30_000;

export default function ContactsPage() {
  const access = useAuth((s) => s.access);
  const myExtension = useAuth((s) => s.extension);
  const isRegistered = useSip((s) => s.isRegistered);
  const currentCall = useSip((s) => s.currentCall);
  const makeCall = useSip((s) => s.makeCall);

  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [onlineSet, setOnlineSet] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the extension list once on mount.
  useEffect(() => {
    if (!access) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listExtensions(access);
        if (!cancelled) {
          // Sort numerically by extension number, enabled first.
          data.sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.number.localeCompare(b.number, undefined, { numeric: true });
          });
          setExtensions(data);
        }
      } catch (e) {
        if (!cancelled) setError(extractErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [access]);

  // Poll registration status every 30s so the online/offline dots
  // reflect real SIP register state without hammering the backend.
  useEffect(() => {
    if (!access) return;
    let cancelled = false;
    async function fetchOnce() {
      try {
        const map = await listRegistrations(access!);
        if (cancelled) return;
        const next = new Set<string>();
        for (const [ext, entries] of Object.entries(map)) {
          if (Array.isArray(entries) && entries.length > 0) next.add(ext);
        }
        setOnlineSet(next);
      } catch { /* silent — the contacts list still renders without dots */ }
    }
    void fetchOnce();
    const timer = setInterval(fetchOnce, REFRESH_REGISTRATIONS_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [access]);

  // Apply the search filter against name + number + email.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return extensions;
    return extensions.filter((ext) => {
      const hay = [
        ext.number,
        ext.caller_id_name,
        ext.caller_id_number,
        ext.user_name,
        ext.user_email,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [extensions, query]);

  const navigate = useNavigate();
  const [chatBusyExt, setChatBusyExt] = useState<string | null>(null);

  async function handleCall(number: string) {
    if (!isRegistered || currentCall) return;
    try { await makeCall(number); }
    catch (e) { console.warn('[contacts] makeCall failed', e); }
  }

  async function handleChat(peerExtension: string) {
    if (!access || chatBusyExt || peerExtension === myExtension) return;
    setChatBusyExt(peerExtension);
    try {
      const { conversation_id } = await getOrCreateConversationByExtension(
        access, peerExtension,
      );
      navigate(`/shell/chat?conversation=${conversation_id}`);
    } catch (e) {
      console.warn('[contacts] get-or-create conversation failed', e);
      setError(extractErrorMessage(e));
    } finally {
      setChatBusyExt(null);
    }
  }

  return (
    <div className="ddc-contacts">
      <div className="ddc-contacts-header">
        <h1 className="ddc-contacts-title">Contacts</h1>
        <div className="ddc-contacts-count">
          {loading ? 'Loading…' : `${filtered.length} of ${extensions.length}`}
        </div>
      </div>

      <div className="ddc-contacts-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or extension…"
          className="ddc-contacts-search-input"
        />
      </div>

      {error && <div className="ddc-contacts-error">{error}</div>}

      {!loading && !error && extensions.length === 0 && (
        <div className="ddc-contacts-empty">
          No extensions in this tenant yet.
        </div>
      )}

      {!loading && !error && filtered.length === 0 && extensions.length > 0 && (
        <div className="ddc-contacts-empty">
          No contacts match “{query}”.
        </div>
      )}

      <div className="ddc-contacts-list">
        {filtered.map((ext) => {
          const isMe = ext.number === myExtension;
          const name =
            ext.caller_id_name ||
            ext.user_name ||
            `Extension ${ext.number}`;
          const online = onlineSet.has(ext.number);
          return (
            <div key={ext.id} className={`ddc-contact ${isMe ? 'me' : ''}`}>
              <div className="ddc-contact-avatar">
                {name.slice(0, 1).toUpperCase()}
              </div>

              <div className="ddc-contact-info">
                <div className="ddc-contact-name-row">
                  <span className="ddc-contact-name">{name}</span>
                  {isMe && <span className="ddc-contact-you-badge">You</span>}
                  {!ext.enabled && (
                    <span className="ddc-contact-disabled-badge">Disabled</span>
                  )}
                </div>
                <div className="ddc-contact-meta">
                  <span className={`ddc-contact-dot ${online ? 'ok' : 'bad'}`} />
                  <span className="ddc-contact-ext">Ext {ext.number}</span>
                  {ext.user_email && (
                    <span className="ddc-contact-email">· {ext.user_email}</span>
                  )}
                </div>
              </div>

              <div className="ddc-contact-actions">
                <button
                  className="ddc-contact-btn call"
                  onClick={() => handleCall(ext.number)}
                  disabled={
                    isMe || !isRegistered || !ext.enabled || currentCall !== null
                  }
                  title={
                    isMe
                      ? 'Cannot call yourself'
                      : !isRegistered
                        ? 'Not registered with PBX'
                        : currentCall
                          ? 'A call is already in progress'
                          : !ext.enabled
                            ? 'Extension is disabled'
                            : `Call ${ext.number}`
                  }
                  aria-label={`Call ${name}`}
                >
                  <span className="ddc-contact-icon">📞</span>
                </button>
                <button
                  className="ddc-contact-btn chat"
                  onClick={() => handleChat(ext.number)}
                  disabled={isMe || chatBusyExt === ext.number}
                  title={
                    isMe
                      ? 'Cannot chat with yourself'
                      : chatBusyExt === ext.number
                        ? 'Opening…'
                        : `Chat with ${name}`
                  }
                  aria-label={`Chat with ${name}`}
                >
                  <span className="ddc-contact-icon">💬</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .ddc-contacts {
          min-height: 100%;
          padding: 28px 40px 60px;
          font-family: ${fonts.sans};
          overflow-y: auto;
        }
        .ddc-contacts-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
        }
        .ddc-contacts-title {
          color: ${brand.white};
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 0;
          text-transform: uppercase;
        }
        .ddc-contacts-count {
          color: ${brand.textMuted};
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-family: ${fonts.mono};
        }

        .ddc-contacts-search {
          margin-bottom: 20px;
        }
        .ddc-contacts-search-input {
          width: 100%;
          box-sizing: border-box;
          background: rgba(7, 20, 64, 0.55);
          border: 1px solid rgba(77, 166, 255, 0.25);
          border-radius: 8px;
          color: ${brand.white};
          font-family: ${fonts.sans};
          font-size: 14px;
          padding: 12px 14px;
          outline: none;
          transition: border-color 120ms ease;
        }
        .ddc-contacts-search-input::placeholder {
          color: ${brand.textMuted};
        }
        .ddc-contacts-search-input:focus {
          border-color: ${brand.blue};
          box-shadow: 0 0 0 3px rgba(77, 166, 255, 0.12);
        }

        .ddc-contacts-error {
          color: ${brand.red};
          background: rgba(232, 19, 42, 0.08);
          border: 1px solid rgba(232, 19, 42, 0.25);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 13px;
        }
        .ddc-contacts-empty {
          color: ${brand.textMuted};
          text-align: center;
          padding: 40px 0;
          font-size: 13px;
          letter-spacing: 1px;
        }

        .ddc-contacts-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ddc-contact {
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(7, 20, 64, 0.55);
          border: 1px solid rgba(77, 166, 255, 0.12);
          border-radius: 10px;
          padding: 14px 16px;
          transition: border-color 120ms ease, background-color 120ms ease;
        }
        .ddc-contact:hover {
          border-color: rgba(77, 166, 255, 0.35);
          background: rgba(77, 166, 255, 0.06);
        }
        .ddc-contact.me {
          border-color: rgba(77, 166, 255, 0.45);
          background: rgba(77, 166, 255, 0.08);
        }

        .ddc-contact-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: ${brand.blueDim};
          color: #fff;
          font-weight: 700;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .ddc-contact-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ddc-contact-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ddc-contact-name {
          color: ${brand.white};
          font-size: 15px;
          font-weight: 600;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-contact-you-badge {
          background: ${brand.blue};
          color: ${brand.white};
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .ddc-contact-disabled-badge {
          background: rgba(232, 19, 42, 0.2);
          color: ${brand.red};
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .ddc-contact-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          color: ${brand.textMuted};
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-contact-ext {
          font-family: ${fonts.mono};
          letter-spacing: 0.5px;
        }
        .ddc-contact-email {
          opacity: 0.75;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ddc-contact-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ddc-contact-dot.ok {
          background: ${brand.success};
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
        }
        .ddc-contact-dot.bad {
          background: ${brand.textMuted};
          opacity: 0.55;
        }

        .ddc-contact-actions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }
        .ddc-contact-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 1px solid rgba(77, 166, 255, 0.3);
          background: rgba(7, 20, 64, 0.55);
          color: ${brand.white};
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 120ms ease;
        }
        .ddc-contact-btn:hover:not(:disabled) {
          transform: scale(1.05);
        }
        .ddc-contact-btn.call:hover:not(:disabled) {
          background: ${brand.success};
          border-color: ${brand.success};
        }
        .ddc-contact-btn.chat:hover:not(:disabled) {
          background: ${brand.blue};
          border-color: ${brand.blue};
        }
        .ddc-contact-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .ddc-contact-icon {
          line-height: 1;
        }
      `}</style>
    </div>
  );
}
