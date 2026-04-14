import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../store/auth';
import { useSip } from '../../store/sip';
import {
  listVoicemails,
  fetchVoicemailAudio,
  markVoicemailRead,
  markVoicemailUnread,
  deleteVoicemail,
  type VoicemailMessage,
} from '../../api/voicemail';
import { extractErrorMessage } from '../../api/client';
import { brand, fonts } from '../../theme';

// Same junk-name filter as RecentsPage — sofia/verto leak
// 6–12 char alphanumeric session tokens into caller_id_name on WebRTC
// contacts. We fall back to showing the number alone when we see one.
const JUNK_NAME_RE = /^[a-z0-9]{6,12}$/i;

export default function VoicemailPage() {
  const access = useAuth((s) => s.access);
  const myExtension = useAuth((s) => s.extension);
  const sipConfig = useAuth((s) => s.sip_config);
  const isRegistered = useSip((s) => s.isRegistered);
  const currentCall = useSip((s) => s.currentCall);
  const makeCall = useSip((s) => s.makeCall);

  const domain = sipConfig?.sip_domain || '';

  const [messages, setMessages] = useState<VoicemailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which row is expanded for playback. Only one message plays at a
  // time — opening a second row tears down the first audio element.
  const [openId, setOpenId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Row-level working state for mark-read/unread/delete so the whole
  // list doesn't go grey while one row is updating.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Hold the current object URL in a ref too so the unmount cleanup
  // effect can revoke it without chasing state closure staleness.
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const fetchList = useCallback(async () => {
    if (!access || !myExtension || !domain) return;
    setError(null);
    try {
      const data = await listVoicemails(access, myExtension, domain);
      setMessages(data);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }, [access, myExtension, domain]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchList();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchList]);

  async function handleRefresh() {
    if (loading || refreshing) return;
    setRefreshing(true);
    try { await fetchList(); }
    finally { setRefreshing(false); }
  }

  async function handleToggleOpen(msg: VoicemailMessage) {
    // Collapse current row if clicked again.
    if (openId === msg.id) {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      setOpenId(null);
      setAudioUrl(null);
      setAudioError(null);
      return;
    }

    // Opening a new row — tear down prior object URL first so we don't
    // leak blobs while the user hops from message to message.
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      setAudioUrl(null);
    }

    setOpenId(msg.id);
    setAudioError(null);
    setAudioLoading(true);

    try {
      const blob = await fetchVoicemailAudio(access!, msg.id, myExtension!, domain);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      // The audio endpoint auto-marks the message read on the server.
      // Reflect that optimistically in the list without a full refetch.
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m)),
      );
    } catch (e) {
      setAudioError(extractErrorMessage(e));
    } finally {
      setAudioLoading(false);
    }
  }

  async function handleToggleRead(msg: VoicemailMessage) {
    if (busyId) return;
    setBusyId(msg.id);
    const targetRead = !msg.is_read;
    // Optimistic flip — revert on failure.
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, is_read: targetRead } : m)),
    );
    try {
      if (targetRead) {
        await markVoicemailRead(access!, msg.id, myExtension!, domain);
      } else {
        await markVoicemailUnread(access!, msg.id, myExtension!, domain);
      }
    } catch (e) {
      console.warn('[voicemail] mark toggle failed', e);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_read: !targetRead } : m)),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(msg: VoicemailMessage) {
    if (busyId) return;
    const confirmed = window.confirm(
      `Delete voicemail from ${displayCaller(msg)}?\n\n` +
      'This permanently removes the message from the server.',
    );
    if (!confirmed) return;

    setBusyId(msg.id);
    try {
      await deleteVoicemail(access!, msg.id, myExtension!, domain);
      // Collapse if the deleted row was currently open.
      if (openId === msg.id) {
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        setOpenId(null);
        setAudioUrl(null);
      }
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    } catch (e) {
      console.warn('[voicemail] delete failed', e);
      setError(extractErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCallBack(msg: VoicemailMessage) {
    const target = (msg.caller_id_number || '').replace(/^\+/, '');
    if (!target || !isRegistered || currentCall) return;
    try { await makeCall(target); }
    catch (e) { console.warn('[voicemail] callback failed', e); }
  }

  const unreadCount = useMemo(
    () => messages.filter((m) => !m.is_read).length,
    [messages],
  );

  return (
    <div className="ddc-vm">
      <div className="ddc-vm-header">
        <h1 className="ddc-vm-title">Voicemail</h1>
        <div className="ddc-vm-actions">
          <div className="ddc-vm-count">
            {loading
              ? 'Loading…'
              : unreadCount > 0
                ? `${unreadCount} new · ${messages.length} total`
                : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
          </div>
          <button
            className="ddc-vm-refresh"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {error && <div className="ddc-vm-error">{error}</div>}

      {!loading && !error && messages.length === 0 && (
        <div className="ddc-vm-empty">
          <div className="ddc-vm-empty-icon">📬</div>
          <div className="ddc-vm-empty-title">Inbox empty</div>
          <div className="ddc-vm-empty-sub">
            New voicemail messages will appear here.
          </div>
        </div>
      )}

      <div className="ddc-vm-list">
        {messages.map((msg) => {
          const isOpen = openId === msg.id;
          const caller = displayCaller(msg);
          const number = msg.caller_id_number || '';
          const canCall =
            isRegistered && !currentCall && !!number && number !== myExtension;
          const rowBusy = busyId === msg.id;

          return (
            <div
              key={msg.id}
              className={`ddc-vm-row ${msg.is_read ? '' : 'unread'} ${isOpen ? 'open' : ''}`}
            >
              <button
                className="ddc-vm-main"
                onClick={() => handleToggleOpen(msg)}
                title={isOpen ? 'Collapse' : 'Play message'}
              >
                <div className="ddc-vm-dot-col">
                  {!msg.is_read && <span className="ddc-vm-unread-dot" />}
                </div>
                <div className="ddc-vm-play">
                  {isOpen ? '▾' : '▶'}
                </div>
                <div className="ddc-vm-info">
                  <div className="ddc-vm-name-row">
                    <span className="ddc-vm-name">{caller.primary}</span>
                    {caller.secondary && (
                      <span className="ddc-vm-number">{caller.secondary}</span>
                    )}
                  </div>
                  <div className="ddc-vm-meta">
                    <span className="ddc-vm-time">{formatRelative(msg.created)}</span>
                    <span className="ddc-vm-sep">·</span>
                    <span className="ddc-vm-duration">{msg.duration_display}</span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="ddc-vm-player">
                  {audioLoading && (
                    <div className="ddc-vm-player-status">Loading audio…</div>
                  )}
                  {audioError && (
                    <div className="ddc-vm-player-error">{audioError}</div>
                  )}
                  {audioUrl && !audioLoading && !audioError && (
                    <audio
                      className="ddc-vm-audio"
                      src={audioUrl}
                      controls
                      autoPlay
                    />
                  )}

                  <div className="ddc-vm-row-actions">
                    <button
                      className="ddc-vm-action"
                      onClick={() => handleCallBack(msg)}
                      disabled={!canCall}
                      title={canCall ? `Call ${number}` : 'Cannot call back'}
                    >
                      📞 Call back
                    </button>
                    <button
                      className="ddc-vm-action"
                      onClick={() => handleToggleRead(msg)}
                      disabled={rowBusy}
                    >
                      {msg.is_read ? 'Mark unread' : 'Mark read'}
                    </button>
                    <button
                      className="ddc-vm-action ddc-vm-action-danger"
                      onClick={() => handleDelete(msg)}
                      disabled={rowBusy}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .ddc-vm {
          min-height: 100%;
          padding: 28px 40px 60px;
          font-family: ${fonts.sans};
          overflow-y: auto;
        }
        .ddc-vm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .ddc-vm-title {
          color: ${brand.white};
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 0;
          text-transform: uppercase;
        }
        .ddc-vm-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ddc-vm-count {
          color: ${brand.textMuted};
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-family: ${fonts.mono};
        }
        .ddc-vm-refresh {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: transparent;
          border: 1px solid rgba(77, 166, 255, 0.3);
          color: ${brand.blue};
          font-size: 16px;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ddc-vm-refresh:hover:not(:disabled) {
          background: rgba(77, 166, 255, 0.1);
          border-color: ${brand.blue};
        }
        .ddc-vm-refresh:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .ddc-vm-error {
          color: ${brand.red};
          background: rgba(232, 19, 42, 0.08);
          border: 1px solid rgba(232, 19, 42, 0.25);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 13px;
        }

        .ddc-vm-empty {
          text-align: center;
          padding: 60px 0;
          color: ${brand.textMuted};
        }
        .ddc-vm-empty-icon {
          font-size: 48px;
          opacity: 0.5;
          margin-bottom: 12px;
        }
        .ddc-vm-empty-title {
          color: ${brand.white};
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .ddc-vm-empty-sub {
          font-size: 12px;
          letter-spacing: 0.5px;
        }

        .ddc-vm-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .ddc-vm-row {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 8px;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .ddc-vm-row:hover {
          background: rgba(77, 166, 255, 0.06);
          border-color: rgba(77, 166, 255, 0.2);
        }
        .ddc-vm-row.open {
          background: rgba(77, 166, 255, 0.08);
          border-color: rgba(77, 166, 255, 0.3);
        }

        .ddc-vm-main {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          background: transparent;
          border: none;
          padding: 12px 14px;
          color: ${brand.white};
          font-family: ${fonts.sans};
          text-align: left;
          cursor: pointer;
        }

        .ddc-vm-dot-col {
          width: 10px;
          display: flex;
          justify-content: center;
          flex-shrink: 0;
        }
        .ddc-vm-unread-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${brand.blue};
          box-shadow: 0 0 6px rgba(77, 166, 255, 0.7);
        }

        .ddc-vm-play {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          color: ${brand.blue};
          background: rgba(7, 20, 64, 0.7);
          border: 1px solid rgba(77, 166, 255, 0.4);
          flex-shrink: 0;
        }

        .ddc-vm-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .ddc-vm-name-row {
          display: flex;
          align-items: baseline;
          gap: 10px;
          overflow: hidden;
        }
        .ddc-vm-name {
          font-size: 14px;
          font-weight: 600;
          color: ${brand.white};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-vm-row.unread .ddc-vm-name {
          font-weight: 800;
        }
        .ddc-vm-number {
          font-family: ${fonts.mono};
          font-size: 11px;
          color: ${brand.textMuted};
          letter-spacing: 0.3px;
        }
        .ddc-vm-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: ${brand.textMuted};
        }
        .ddc-vm-time { letter-spacing: 0.5px; }
        .ddc-vm-sep { opacity: 0.5; }
        .ddc-vm-duration { font-family: ${fonts.mono}; }

        .ddc-vm-player {
          padding: 4px 16px 14px 56px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ddc-vm-audio {
          width: 100%;
          max-width: 460px;
          height: 36px;
          outline: none;
          filter: invert(0.88) hue-rotate(180deg);
        }
        .ddc-vm-player-status {
          font-size: 12px;
          color: ${brand.textMuted};
          letter-spacing: 0.5px;
        }
        .ddc-vm-player-error {
          font-size: 12px;
          color: ${brand.red};
        }

        .ddc-vm-row-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ddc-vm-action {
          background: transparent;
          border: 1px solid rgba(77, 166, 255, 0.35);
          color: ${brand.blue};
          font-family: ${fonts.sans};
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 7px 14px;
          border-radius: 15px;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ddc-vm-action:hover:not(:disabled) {
          background: rgba(77, 166, 255, 0.12);
          border-color: ${brand.blue};
        }
        .ddc-vm-action:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .ddc-vm-action-danger {
          border-color: rgba(232, 19, 42, 0.45);
          color: ${brand.red};
        }
        .ddc-vm-action-danger:hover:not(:disabled) {
          background: ${brand.red};
          color: #fff;
          border-color: ${brand.red};
        }
      `}</style>
    </div>
  );
}

// ---------- helpers ----------

function displayCaller(msg: VoicemailMessage): { primary: string; secondary: string } {
  const name = msg.caller_id_name?.trim();
  const number = msg.caller_id_number || '(unknown)';
  // Same rejection rules as Recents — empty, literal 'Caller' placeholder,
  // equals number, starts with '+', or matches the 6–12 alnum junk pattern.
  const isJunk =
    !name
    || name === number
    || name === 'Caller'
    || name.startsWith('+')
    || JUNK_NAME_RE.test(name);
  if (!isJunk) {
    return { primary: name, secondary: number };
  }
  return { primary: number, secondary: '' };
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: diffDay > 365 ? 'numeric' : undefined,
  });
}
