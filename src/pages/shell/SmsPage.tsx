import { useEffect, useState, useRef } from 'react';
import { brand, fonts } from '../../theme';
import { fetchSmsConversations, fetchSmsMessages, sendSms } from '../../api/sms';
import type { SmsConversation, SmsMessage } from '../../api/types';

function formatPhone(num: string): string {
  const d = num.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return num;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SmsPage() {
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [input, setInput] = useState('');
  const [newTo, setNewTo] = useState('');
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try { setConversations(await fetchSmsConversations()); } catch { /* */ }
  };

  const loadMessages = async (remote: string) => {
    try { setMessages(await fetchSmsMessages(remote)); } catch { /* */ }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    const t = setInterval(loadConversations, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected), 5000);
    return () => clearInterval(t);
  }, [selected]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const to = composing ? newTo.trim() : selected;
    const body = input.trim();
    if (!to || !body) return;
    setSending(true);
    try {
      const result = await sendSms(to, body);
      if (result.status === 'sent' || result.status === 'queued') {
        setInput('');
        if (composing) { setComposing(false); setSelected(to); setNewTo(''); }
        setMessages(prev => [...prev, {
          id: result.id || Date.now(), from_number: '', to_number: to,
          body, direction: 'outbound', status: result.status, is_read: true,
          created_at: new Date().toISOString(),
        }]);
        loadConversations();
      }
    } catch { /* */ }
    finally { setSending(false); }
  };

  const activeRemote = composing ? newTo : selected;

  return (
    <div className="sms-container">
      {/* Left panel — conversation list */}
      <div className="sms-list">
        <div className="sms-list-header">
          <span>Messages</span>
          <button className="sms-compose-btn" onClick={() => { setComposing(true); setSelected(''); }}
            type="button" title="New message">✏️</button>
        </div>
        {conversations.map(c => (
          <button
            key={c.remote_number}
            className={`sms-conv ${selected === c.remote_number ? 'active' : ''}`}
            onClick={() => { setSelected(c.remote_number); setComposing(false); }}
            type="button"
          >
            <div className="sms-conv-top">
              <span className="sms-conv-name">{formatPhone(c.remote_number)}</span>
              <span className="sms-conv-time">{formatTime(c.last_timestamp)}</span>
            </div>
            <div className="sms-conv-bottom">
              <span className="sms-conv-preview">
                {c.direction === 'outbound' && <span style={{color: brand.textMuted}}>You: </span>}
                {c.last_message}
              </span>
              {c.unread_count > 0 && <span className="sms-badge">{c.unread_count}</span>}
            </div>
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="sms-empty-list">No conversations yet</div>
        )}
      </div>

      {/* Right panel — thread */}
      <div className="sms-thread">
        {(selected || composing) ? (
          <>
            <div className="sms-thread-header">
              {composing ? (
                <input
                  className="sms-to-input"
                  placeholder="Enter phone number..."
                  value={newTo}
                  onChange={e => setNewTo(e.target.value)}
                  autoFocus
                />
              ) : (
                <span className="sms-thread-title">{formatPhone(selected)}</span>
              )}
            </div>
            <div className="sms-messages">
              {messages.map(m => (
                <div key={m.id} className={`sms-bubble-row ${m.direction === 'outbound' ? 'out' : 'in'}`}>
                  <div className={`sms-bubble ${m.direction === 'outbound' ? 'out' : 'in'}`}>
                    <div className="sms-bubble-text">{m.body}</div>
                    <div className="sms-bubble-meta">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {m.direction === 'outbound' && (
                        <span style={{marginLeft: 4}}>
                          {m.status === 'delivered' ? '✓✓' : m.status === 'failed' ? '⚠' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
              {messages.length === 0 && !composing && (
                <div className="sms-empty-thread">No messages — send the first one</div>
              )}
            </div>
            <div className="sms-input-bar">
              <input
                className="sms-input"
                placeholder="Type a message..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }}}
                maxLength={1600}
                disabled={sending}
              />
              <button className="sms-send-btn" onClick={() => { void handleSend(); }}
                disabled={!input.trim() || !activeRemote || sending} type="button">
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="sms-empty-thread">
            <div style={{fontSize: 32, marginBottom: 8}}>💬</div>
            Select a conversation or start a new one
          </div>
        )}
      </div>

      <style>{`
        .sms-container {
          display: flex; height: 100%; font-family: ${fonts.sans};
        }
        .sms-list {
          width: 320px; min-width: 280px; border-right: 1px solid ${brand.border};
          display: flex; flex-direction: column; overflow-y: auto;
        }
        .sms-list-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 16px 12px; font-size: 18px; font-weight: 700;
          color: ${brand.white};
        }
        .sms-compose-btn {
          background: ${brand.blue}; border: none; border-radius: 50%;
          width: 32px; height: 32px; cursor: pointer; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
        }
        .sms-conv {
          display: flex; flex-direction: column; gap: 4px;
          padding: 12px 16px; border: none; background: transparent;
          text-align: left; cursor: pointer; border-bottom: 1px solid ${brand.border};
          font-family: ${fonts.sans}; color: ${brand.white}; width: 100%;
        }
        .sms-conv:hover { background: rgba(255,255,255,0.04); }
        .sms-conv.active { background: rgba(61,158,255,0.1); border-left: 3px solid ${brand.blue}; }
        .sms-conv-top { display: flex; justify-content: space-between; align-items: center; }
        .sms-conv-name { font-size: 14px; font-weight: 600; }
        .sms-conv-time { font-size: 11px; color: ${brand.textMuted}; }
        .sms-conv-bottom { display: flex; justify-content: space-between; align-items: center; }
        .sms-conv-preview { font-size: 12px; color: ${brand.textMuted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px; }
        .sms-badge { background: ${brand.red}; color: #fff; font-size: 10px; font-weight: 700; border-radius: 10px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
        .sms-empty-list { padding: 40px 16px; text-align: center; color: ${brand.textMuted}; font-size: 13px; }

        .sms-thread {
          flex: 1; display: flex; flex-direction: column; min-width: 0;
        }
        .sms-thread-header {
          padding: 14px 20px; border-bottom: 1px solid ${brand.border};
          font-size: 16px; font-weight: 700; color: ${brand.white};
        }
        .sms-thread-title { font-family: ${fonts.mono}; }
        .sms-to-input {
          background: transparent; border: none; border-bottom: 1px solid ${brand.border};
          color: ${brand.white}; font-size: 16px; font-weight: 600; width: 100%;
          outline: none; padding: 4px 0; font-family: ${fonts.mono};
        }
        .sms-messages {
          flex: 1; overflow-y: auto; padding: 16px 20px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .sms-bubble-row { display: flex; }
        .sms-bubble-row.out { justify-content: flex-end; }
        .sms-bubble-row.in { justify-content: flex-start; }
        .sms-bubble {
          max-width: 65%; padding: 10px 14px; border-radius: 16px;
        }
        .sms-bubble.out {
          background: ${brand.blue}; color: #fff;
          border-bottom-right-radius: 4px;
        }
        .sms-bubble.in {
          background: ${brand.navyLight}; color: ${brand.white};
          border-bottom-left-radius: 4px;
        }
        .sms-bubble-text { font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
        .sms-bubble-meta { font-size: 10px; color: rgba(255,255,255,0.5); text-align: right; margin-top: 4px; }
        .sms-empty-thread { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: ${brand.textMuted}; font-size: 14px; }

        .sms-input-bar {
          display: flex; gap: 8px; padding: 12px 20px;
          border-top: 1px solid ${brand.border};
        }
        .sms-input {
          flex: 1; background: ${brand.navyLight}; border: 1px solid ${brand.border};
          border-radius: 20px; padding: 10px 16px; color: ${brand.white};
          font-size: 14px; font-family: ${fonts.sans}; outline: none;
        }
        .sms-input:focus { border-color: ${brand.blue}; }
        .sms-send-btn {
          background: ${brand.blue}; color: #fff; border: none;
          border-radius: 20px; padding: 10px 20px; font-weight: 600;
          font-family: ${fonts.sans}; cursor: pointer; font-size: 13px;
        }
        .sms-send-btn:disabled { opacity: 0.4; cursor: default; }
        .sms-send-btn:hover:not(:disabled) { filter: brightness(1.1); }
      `}</style>
    </div>
  );
}
