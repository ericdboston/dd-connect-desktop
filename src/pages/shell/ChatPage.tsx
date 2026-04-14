import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { useChatUnread } from '../../store/chat';
import {
  listConversations,
  getMessages,
  postMessage,
  chatWebSocketUrl,
  userIdFromAccess,
  type Conversation,
  type ChatMessage,
} from '../../api/chat';
import { extractErrorMessage } from '../../api/client';
import { brand, fonts } from '../../theme';

const CONVERSATION_POLL_MS = 20_000;

export default function ChatPage() {
  const access = useAuth((s) => s.access);
  const displayName = useAuth((s) => s.display_name);
  const refreshUnread = useChatUnread((s) => s.refresh);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get('conversation');

  const myUserId = useMemo(() => userIdFromAccess(access), [access]);

  // ── Conversation list state ───────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);

  // ── Message thread state ──────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // ── Load conversation list ────────────────────────────────
  const fetchConversations = useCallback(async () => {
    if (!access) return;
    try {
      const data = await listConversations(access);
      setConversations(data);
      setListError(null);
    } catch (e) {
      setListError(extractErrorMessage(e));
    }
  }, [access]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      await fetchConversations();
      if (!cancelled) setListLoading(false);
    })();
    const timer = setInterval(fetchConversations, CONVERSATION_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [fetchConversations]);

  // Auto-select the deep-linked conversation from ?conversation=<id>.
  // Runs whenever the param changes OR the list loads, so navigating
  // here from Contacts before the list has fetched still lands on the
  // right row once the fetch resolves. We keep the param in the URL
  // so a refresh restores the selection, and clear activeId instead
  // of the param when the user picks a different row.
  useEffect(() => {
    if (!deepLinkId) return;
    const parsed = parseInt(deepLinkId, 10);
    if (Number.isFinite(parsed) && parsed !== activeId) {
      setActiveId(parsed);
    }
  }, [deepLinkId, activeId]);

  // Pick a sensible default when nothing is selected and the list
  // has a first row. Only fires when nothing is active — we never
  // override an explicit user pick or deep link.
  useEffect(() => {
    if (activeId === null && conversations.length > 0 && !deepLinkId) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId, deepLinkId]);

  // ── Load messages when active conversation changes ────────
  useEffect(() => {
    if (!access || activeId === null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(null);
    (async () => {
      try {
        const data = await getMessages(access, activeId);
        if (!cancelled) setMessages(data.messages);
      } catch (e) {
        if (!cancelled) setThreadError(extractErrorMessage(e));
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [access, activeId]);

  // ── WebSocket lifecycle per active conversation ───────────
  useEffect(() => {
    if (!access || activeId === null) return;

    let cancelled = false;
    const url = chatWebSocketUrl(activeId, access);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setWsOpen(true);
      // Fire a read_receipt so the server clears our unread count
      // for this conversation; refresh the sidebar badge right after
      // so the nav item reflects the new state without waiting for
      // the next poll tick.
      try { ws.send(JSON.stringify({ type: 'read_receipt' })); } catch { /* noop */ }
      if (access) void refreshUnread(access);
    };

    ws.onclose = () => {
      if (cancelled) return;
      setWsOpen(false);
    };

    ws.onerror = () => {
      if (cancelled) return;
      // Don't surface — the REST send path still works and the UI
      // reloads history on next selection. Closing fires onclose
      // right after and flips wsOpen to false.
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(ev.data); } catch { return; }
      if (payload.type !== 'chat_message') return;

      // Server broadcasts a denormalized payload, not a full serialized
      // Message object. Reshape into the local ChatMessage type so the
      // renderer doesn't have to know which channel a message came in
      // on (REST history vs WS push).
      const next: ChatMessage = {
        id: Number(payload.message_id) || Date.now(),
        conversation: Number(payload.conversation_id) || activeId,
        sender: (payload.sender_id as number | null) ?? null,
        sender_name: String(payload.sender_name || ''),
        message_type: String(payload.message_type || 'text'),
        body: String(payload.body || ''),
        file_path: String(payload.file_path || ''),
        file_name: String(payload.file_name || ''),
        file_size: (payload.file_size as number | null) ?? null,
        mime_type: String(payload.mime_type || ''),
        is_deleted: false,
        edited_at: null,
        created_at: String(payload.created_at || new Date().toISOString()),
      };
      setMessages((prev) => {
        // Deduplicate — the broadcast echoes our own send back to us,
        // and if we optimistically appended on send we'd end up with a
        // duplicate row. We don't currently optimistic-append (the echo
        // is fast enough that it reads as instant) so this guard only
        // matters under edge retries, but it's cheap insurance.
        if (prev.some((m) => m.id === next.id)) return prev;
        return [...prev, next];
      });

      // Fresh incoming from someone else bumps the conversation list
      // preview out of sync — re-fetch so the left panel updates.
      void fetchConversations();
      if (access) void refreshUnread(access);
    };

    return () => {
      cancelled = true;
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
      setWsOpen(false);
    };
  }, [access, activeId, refreshUnread, fetchConversations]);

  // Auto-scroll on new messages. Using a small timeout so the DOM has
  // actually laid out the new row before we scroll — without it the
  // scrollIntoView fires against the pre-append layout.
  useEffect(() => {
    if (!threadEndRef.current) return;
    const t = setTimeout(() => {
      threadEndRef.current?.scrollIntoView({ block: 'end' });
    }, 0);
    return () => clearTimeout(t);
  }, [messages, activeId]);

  // ── Sending ───────────────────────────────────────────────
  async function handleSend() {
    const body = draft.trim();
    if (!body || activeId === null || !access || sending) return;
    setSending(true);
    try {
      const ws = wsRef.current;
      if (ws && wsOpen && ws.readyState === WebSocket.OPEN) {
        // WS path — consumer persists AND broadcasts, including back
        // to us, so we clear the draft and let the onmessage handler
        // append to the thread.
        ws.send(JSON.stringify({ type: 'chat_message', body, message_type: 'text' }));
      } else {
        // Fallback: REST create. The server won't broadcast via WS
        // since we're not posting through the consumer, so splice
        // the returned message into local state ourselves.
        const created = await postMessage(access, activeId, body);
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
      }
      setDraft('');
      void fetchConversations();
    } catch (e) {
      console.warn('[chat] send failed', e);
      setThreadError(extractErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handlePickConversation(id: number) {
    if (id === activeId) return;
    setActiveId(id);
    // Keep the URL in sync so refreshing the app restores the pick,
    // but only if we're changing away from the deep-linked row.
    if (deepLinkId && String(id) !== deepLinkId) {
      const next = new URLSearchParams(searchParams);
      next.set('conversation', String(id));
      setSearchParams(next, { replace: true });
    } else if (!deepLinkId) {
      const next = new URLSearchParams(searchParams);
      next.set('conversation', String(id));
      setSearchParams(next, { replace: true });
    }
  }

  // ── Filter + active convo lookup ──────────────────────────
  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const title = displayTitle(c, myUserId).toLowerCase();
      const preview = c.last_message?.body?.toLowerCase() || '';
      return title.includes(q) || preview.includes(q);
    });
  }, [conversations, query, myUserId]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const grouped = useMemo(() => groupByDate(messages), [messages]);

  return (
    <div className="ddc-chat">
      {/* ── Left: conversation list ───────────────────────── */}
      <aside className="ddc-chat-sidebar">
        <div className="ddc-chat-sidebar-header">
          <h1 className="ddc-chat-title">Chat</h1>
        </div>
        <div className="ddc-chat-search-wrap">
          <input
            className="ddc-chat-search"
            type="text"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {listError && <div className="ddc-chat-error">{listError}</div>}

        <div className="ddc-chat-list">
          {listLoading && conversations.length === 0 && (
            <div className="ddc-chat-list-empty">Loading…</div>
          )}
          {!listLoading && conversations.length === 0 && (
            <div className="ddc-chat-list-empty">
              <div className="ddc-chat-list-empty-title">No conversations yet</div>
              <div className="ddc-chat-list-empty-sub">
                Start one from Contacts.
              </div>
            </div>
          )}
          {filteredConversations.map((c) => {
            const title = displayTitle(c, myUserId);
            const preview = previewText(c, displayName || '');
            const ts = c.last_message?.created_at || c.updated_at;
            const active = c.id === activeId;
            return (
              <button
                key={c.id}
                className={`ddc-chat-row ${active ? 'active' : ''}`}
                onClick={() => handlePickConversation(c.id)}
              >
                <div className="ddc-chat-avatar">
                  {(title || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="ddc-chat-row-body">
                  <div className="ddc-chat-row-top">
                    <span className="ddc-chat-row-title">{title}</span>
                    <span className="ddc-chat-row-time">{formatListTime(ts)}</span>
                  </div>
                  <div className="ddc-chat-row-bottom">
                    <span className="ddc-chat-row-preview">{preview}</span>
                    {c.unread_count > 0 && (
                      <span className="ddc-chat-unread-pill">{c.unread_count}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Right: message thread ─────────────────────────── */}
      <section className="ddc-chat-thread">
        {activeConversation ? (
          <>
            <header className="ddc-chat-thread-header">
              <div className="ddc-chat-thread-title">
                {displayTitle(activeConversation, myUserId)}
              </div>
              <div className={`ddc-chat-ws-dot ${wsOpen ? 'ok' : 'bad'}`} title={wsOpen ? 'Live' : 'Reconnecting'} />
            </header>

            <div className="ddc-chat-messages">
              {threadLoading && (
                <div className="ddc-chat-thread-status">Loading messages…</div>
              )}
              {threadError && (
                <div className="ddc-chat-error">{threadError}</div>
              )}
              {!threadLoading && !threadError && messages.length === 0 && (
                <div className="ddc-chat-empty-thread">
                  <div className="ddc-chat-empty-icon">💬</div>
                  <div className="ddc-chat-empty-title">No messages yet</div>
                  <div className="ddc-chat-empty-sub">Say hello!</div>
                </div>
              )}
              {grouped.map((group) => (
                <div key={group.label} className="ddc-chat-group">
                  <div className="ddc-chat-group-label">{group.label}</div>
                  {group.messages.map((m) => {
                    const mine = myUserId !== null && m.sender === myUserId;
                    return (
                      <div
                        key={m.id}
                        className={`ddc-chat-bubble-row ${mine ? 'mine' : 'theirs'}`}
                      >
                        <div className={`ddc-chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                          {!mine && (
                            <div className="ddc-chat-bubble-sender">{m.sender_name}</div>
                          )}
                          <div className="ddc-chat-bubble-body">{m.body}</div>
                          <div className="ddc-chat-bubble-time">
                            {formatBubbleTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={threadEndRef} />
            </div>

            <div className="ddc-chat-composer">
              <textarea
                className="ddc-chat-input"
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
              />
              <button
                className="ddc-chat-send"
                onClick={handleSend}
                disabled={!draft.trim() || sending}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="ddc-chat-empty-right">
            <div className="ddc-chat-empty-icon">💬</div>
            <div className="ddc-chat-empty-title">
              {conversations.length === 0 ? 'No conversations yet' : 'Pick a conversation'}
            </div>
            <div className="ddc-chat-empty-sub">
              {conversations.length === 0
                ? 'Start one from Contacts.'
                : 'Choose a conversation from the list to see messages.'}
            </div>
          </div>
        )}
      </section>

      <style>{`
        .ddc-chat {
          display: flex;
          min-height: 100%;
          height: 100%;
          font-family: ${fonts.sans};
          background: #0a1550;
        }

        /* ── Sidebar ── */
        .ddc-chat-sidebar {
          width: 280px;
          flex-shrink: 0;
          background: #081041;
          border-right: 1px solid rgba(77, 166, 255, 0.12);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .ddc-chat-sidebar-header {
          padding: 18px 18px 6px;
        }
        .ddc-chat-title {
          color: ${brand.white};
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 0;
          text-transform: uppercase;
        }
        .ddc-chat-search-wrap {
          padding: 10px 14px 12px;
        }
        .ddc-chat-search {
          width: 100%;
          background: rgba(7, 20, 64, 0.8);
          border: 1px solid rgba(77, 166, 255, 0.2);
          border-radius: 8px;
          padding: 9px 12px;
          color: ${brand.white};
          font-family: ${fonts.sans};
          font-size: 13px;
          outline: none;
          transition: border-color 120ms ease, background 120ms ease;
        }
        .ddc-chat-search:focus {
          border-color: ${brand.blue};
          background: rgba(7, 20, 64, 1);
        }
        .ddc-chat-search::placeholder {
          color: ${brand.textMuted};
        }

        .ddc-chat-error {
          color: ${brand.red};
          background: rgba(232, 19, 42, 0.08);
          border: 1px solid rgba(232, 19, 42, 0.25);
          border-radius: 6px;
          padding: 8px 12px;
          margin: 0 14px 10px;
          font-size: 12px;
        }

        .ddc-chat-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ddc-chat-list-empty {
          padding: 30px 16px;
          color: ${brand.textMuted};
          text-align: center;
          font-size: 12px;
          letter-spacing: 0.5px;
        }
        .ddc-chat-list-empty-title {
          color: ${brand.white};
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-size: 13px;
          margin-bottom: 6px;
        }
        .ddc-chat-list-empty-sub { font-size: 12px; }

        .ddc-chat-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-left: 3px solid transparent;
          border-radius: 0;
          color: ${brand.white};
          font-family: ${fonts.sans};
          text-align: left;
          cursor: pointer;
          width: 100%;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .ddc-chat-row:hover {
          background: rgba(77, 166, 255, 0.06);
        }
        .ddc-chat-row.active {
          background: rgba(77, 166, 255, 0.12);
          border-left-color: ${brand.blue};
        }

        .ddc-chat-avatar {
          width: 38px;
          height: 38px;
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

        .ddc-chat-row-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ddc-chat-row-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .ddc-chat-row-title {
          font-size: 13px;
          font-weight: 700;
          color: ${brand.white};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-chat-row-time {
          font-family: ${fonts.mono};
          font-size: 10px;
          color: ${brand.textMuted};
          flex-shrink: 0;
        }
        .ddc-chat-row-bottom {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: space-between;
        }
        .ddc-chat-row-preview {
          font-size: 12px;
          color: ${brand.textMuted};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .ddc-chat-unread-pill {
          background: ${brand.blue};
          color: #0a1550;
          font-family: ${fonts.mono};
          font-size: 10px;
          font-weight: 800;
          padding: 2px 7px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
          flex-shrink: 0;
        }

        /* ── Thread ── */
        .ddc-chat-thread {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
        }
        .ddc-chat-thread-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 22px;
          border-bottom: 1px solid rgba(77, 166, 255, 0.12);
          background: #0c1760;
        }
        .ddc-chat-thread-title {
          color: ${brand.white};
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }
        .ddc-chat-ws-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .ddc-chat-ws-dot.ok {
          background: ${brand.success};
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
        }
        .ddc-chat-ws-dot.bad {
          background: ${brand.red};
          box-shadow: 0 0 6px rgba(232, 19, 42, 0.6);
        }

        .ddc-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 18px 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .ddc-chat-thread-status {
          color: ${brand.textMuted};
          font-size: 12px;
          text-align: center;
          letter-spacing: 0.5px;
        }

        .ddc-chat-empty-thread,
        .ddc-chat-empty-right {
          margin: auto;
          text-align: center;
          color: ${brand.textMuted};
          padding: 40px;
        }
        .ddc-chat-empty-icon {
          font-size: 48px;
          opacity: 0.5;
          margin-bottom: 12px;
        }
        .ddc-chat-empty-title {
          color: ${brand.white};
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .ddc-chat-empty-sub {
          font-size: 12px;
          letter-spacing: 0.5px;
        }

        .ddc-chat-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ddc-chat-group-label {
          align-self: center;
          font-family: ${fonts.mono};
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: ${brand.textMuted};
          padding: 4px 12px;
          background: rgba(7, 20, 64, 0.6);
          border-radius: 10px;
          margin-bottom: 4px;
        }

        .ddc-chat-bubble-row {
          display: flex;
          width: 100%;
        }
        .ddc-chat-bubble-row.mine { justify-content: flex-end; }
        .ddc-chat-bubble-row.theirs { justify-content: flex-start; }

        .ddc-chat-bubble {
          max-width: 70%;
          padding: 9px 13px 6px;
          border-radius: 14px;
          font-size: 13px;
          line-height: 1.4;
          word-wrap: break-word;
          white-space: pre-wrap;
        }
        .ddc-chat-bubble.mine {
          background: ${brand.blue};
          color: #0a1550;
          border-bottom-right-radius: 4px;
        }
        .ddc-chat-bubble.theirs {
          background: rgba(7, 20, 64, 0.9);
          color: ${brand.white};
          border: 1px solid rgba(77, 166, 255, 0.2);
          border-bottom-left-radius: 4px;
        }
        .ddc-chat-bubble-sender {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: ${brand.blue};
          margin-bottom: 2px;
        }
        .ddc-chat-bubble.mine .ddc-chat-bubble-sender { color: #0a1550; }
        .ddc-chat-bubble-body { white-space: pre-wrap; }
        .ddc-chat-bubble-time {
          font-family: ${fonts.mono};
          font-size: 9px;
          margin-top: 3px;
          opacity: 0.7;
          text-align: right;
        }

        .ddc-chat-composer {
          display: flex;
          align-items: flex-end;
          gap: 10px;
          padding: 12px 22px 16px;
          border-top: 1px solid rgba(77, 166, 255, 0.12);
          background: #0c1760;
        }
        .ddc-chat-input {
          flex: 1;
          resize: none;
          background: rgba(7, 20, 64, 0.8);
          border: 1px solid rgba(77, 166, 255, 0.2);
          border-radius: 18px;
          padding: 10px 14px;
          color: ${brand.white};
          font-family: ${fonts.sans};
          font-size: 13px;
          outline: none;
          max-height: 140px;
          min-height: 38px;
          transition: border-color 120ms ease;
        }
        .ddc-chat-input:focus { border-color: ${brand.blue}; }
        .ddc-chat-input::placeholder { color: ${brand.textMuted}; }

        .ddc-chat-send {
          background: ${brand.blue};
          color: #0a1550;
          border: none;
          border-radius: 18px;
          padding: 10px 22px;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          cursor: pointer;
          transition: opacity 120ms ease, filter 120ms ease;
        }
        .ddc-chat-send:hover:not(:disabled) { filter: brightness(1.1); }
        .ddc-chat-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function displayTitle(c: Conversation, myUserId: number | null): string {
  if (c.is_channel) return c.display_title || c.title || c.channel_name || 'Channel';
  // For 1:1 / direct, the backend display_title concatenates every
  // participant name. Strip ourselves out so the header reads as the
  // peer's name rather than "Me, Peer".
  if (!c.is_channel && c.participant_names.length > 0 && myUserId !== null) {
    const others = c.participant_names.filter((p) => p.id !== myUserId);
    if (others.length === 1) return others[0].name;
    if (others.length > 1) return others.map((p) => p.name).join(', ');
  }
  return c.display_title || c.title || 'Conversation';
}

function previewText(c: Conversation, myDisplayName: string): string {
  const lm = c.last_message;
  if (!lm) return c.is_channel ? c.channel_topic || 'No messages yet' : 'No messages yet';
  // Prefix 'You: ' when the last message was sent by us so the preview
  // parallels mobile messengers' standard affordance.
  const isMine =
    myDisplayName && lm.sender_name && lm.sender_name.trim() === myDisplayName.trim();
  const body = lm.body || (lm.message_type === 'file' ? '[File]' : '');
  return isMine ? `You: ${body}` : body;
}

function formatListTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear()
    && then.getMonth() === now.getMonth()
    && then.getDate() === now.getDate();
  if (sameDay) {
    return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const diffDay = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (diffDay < 7) {
    return then.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatBubbleTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso);
  return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface MessageGroup {
  label: string;
  messages: ChatMessage[];
}

function groupByDate(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = startOfDay(new Date(now.getTime() - 86_400_000));

  for (const m of messages) {
    const d = new Date(m.created_at);
    const dayStart = startOfDay(d);
    let label: string;
    if (dayStart.getTime() === today.getTime()) label = 'Today';
    else if (dayStart.getTime() === yesterday.getTime()) label = 'Yesterday';
    else {
      label = d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric',
      });
    }
    if (!current || current.label !== label) {
      current = { label, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
