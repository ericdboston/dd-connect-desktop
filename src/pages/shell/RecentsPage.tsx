import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../store/auth';
import { useSip } from '../../store/sip';
import { listCdrs, type CdrRecord } from '../../api/cdr';
import { extractErrorMessage } from '../../api/client';
import { brand, fonts } from '../../theme';

const PAGE_SIZE = 50;

// electron-store key for the "cleared before" ISO timestamp. CDRs with
// a start_time strictly before this value are hidden from the list.
// Pure client-side — the server CDR table is untouched.
const CLEARED_BEFORE_KEY = 'recents:clearedBefore';

// Matches caller_id_name values that are clearly machine-generated
// junk and not real human names — short hex/alphanumeric tokens like
// "u85s65me", "pttnh3hi", "3lg3mnc6on96", that leak through from
// Verto/sofia NAT-traversal session identifiers. When the caller ID
// name matches this pattern we fall back to showing the number alone.
const JUNK_NAME_RE = /^[a-z0-9]{6,12}$/i;

export default function RecentsPage() {
  const access = useAuth((s) => s.access);
  const myExtension = useAuth((s) => s.extension);
  const isRegistered = useSip((s) => s.isRegistered);
  const currentCall = useSip((s) => s.currentCall);
  const makeCall = useSip((s) => s.makeCall);

  const [cdrs, setCdrs] = useState<CdrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [clearedBefore, setClearedBefore] = useState<string | null>(null);

  const fetchCdrs = useCallback(async () => {
    if (!access) return;
    setError(null);
    try {
      const data = await listCdrs(access);
      setCdrs(data);
      setVisible(PAGE_SIZE);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }, [access]);

  // Initial load. Also reads the persisted clearedBefore timestamp so
  // the filter is active immediately and doesn't flash the cleared
  // records on screen before the hide kicks in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const saved = await window.ddconnect?.store.get<string>(
          CLEARED_BEFORE_KEY,
        );
        if (!cancelled && saved) setClearedBefore(saved);
      } catch { /* noop */ }
      await fetchCdrs();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchCdrs]);

  async function handleRefresh() {
    if (refreshing || loading) return;
    setRefreshing(true);
    try {
      await fetchCdrs();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRedial(target: string) {
    if (!isRegistered || currentCall || !target) return;
    try { await makeCall(target); }
    catch (e) { console.warn('[recents] redial failed', e); }
  }

  async function handleClearHistory() {
    // Client-side clear: stash "now" as the cleared-before cutoff.
    // Any CDR with start_time strictly earlier is hidden from this
    // list. Server CDR table is untouched — refreshing restores the
    // list only if new calls have been placed since the cutoff.
    const confirmed = window.confirm(
      'Clear visible call history?\n\n' +
      'This hides current calls from your Recents list on this device. ' +
      'The server CDR records are untouched.',
    );
    if (!confirmed) return;
    const now = new Date().toISOString();
    setClearedBefore(now);
    try { await window.ddconnect?.store.set(CLEARED_BEFORE_KEY, now); }
    catch (e) { console.warn('[recents] persist clearedBefore failed', e); }
  }

  // Apply the clearedBefore cutoff client-side so the filter survives
  // reloads without needing the server to know anything about it.
  const filteredCdrs = useMemo(() => {
    if (!clearedBefore) return cdrs;
    const cutoff = Date.parse(clearedBefore);
    if (Number.isNaN(cutoff)) return cdrs;
    return cdrs.filter((c) => {
      const started = Date.parse(c.start_time);
      return Number.isNaN(started) || started >= cutoff;
    });
  }, [cdrs, clearedBefore]);

  const page = useMemo(
    () => filteredCdrs.slice(0, visible),
    [filteredCdrs, visible],
  );
  const hasMore = visible < filteredCdrs.length;

  return (
    <div className="ddc-recents">
      <div className="ddc-recents-header">
        <h1 className="ddc-recents-title">Recents</h1>
        <div className="ddc-recents-actions">
          <div className="ddc-recents-count">
            {loading
              ? 'Loading…'
              : `${filteredCdrs.length} call${filteredCdrs.length === 1 ? '' : 's'}`}
          </div>
          <button
            className="ddc-recents-refresh"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
          <button
            className="ddc-recents-clear"
            onClick={handleClearHistory}
            disabled={loading || filteredCdrs.length === 0}
            title="Clear visible history (client-side only)"
          >
            Clear
          </button>
        </div>
      </div>

      {error && <div className="ddc-recents-error">{error}</div>}

      {!loading && !error && filteredCdrs.length === 0 && (
        <div className="ddc-recents-empty">
          <div className="ddc-recents-empty-icon">☎</div>
          <div className="ddc-recents-empty-title">
            {cdrs.length > 0 ? 'History cleared' : 'No calls yet'}
          </div>
          <div className="ddc-recents-empty-sub">
            {cdrs.length > 0
              ? 'New calls from this point forward will appear here.'
              : 'Calls you make and receive will appear here.'}
          </div>
        </div>
      )}

      <div className="ddc-recents-list">
        {page.map((cdr) => {
          const cls = classifyCall(cdr, myExtension || '');
          const display = displayNameFor(cdr, cls);
          const redialTarget = redialTargetFor(cdr, cls);
          const canRedial =
            isRegistered && !currentCall && !!redialTarget && redialTarget !== myExtension;

          return (
            <button
              key={cdr.uuid || cdr.id}
              className={`ddc-recents-row ${cls.tone}`}
              onClick={() => canRedial && handleRedial(redialTarget!)}
              disabled={!canRedial}
              title={canRedial ? `Redial ${redialTarget}` : 'Cannot redial'}
            >
              <div className={`ddc-recents-arrow ${cls.tone}`} title={cls.label}>
                {cls.arrow}
              </div>

              <div className="ddc-recents-info">
                <div className="ddc-recents-name-row">
                  <span className={`ddc-recents-name ${cls.tone}`}>{display.primary}</span>
                  {display.secondary && (
                    <span className="ddc-recents-number">{display.secondary}</span>
                  )}
                </div>
                <div className="ddc-recents-meta">
                  <span className="ddc-recents-time">{formatRelative(cdr.start_time)}</span>
                  <span className="ddc-recents-sep">·</span>
                  <span className="ddc-recents-duration">
                    {cdr.was_answered ? formatDuration(cdr.billable_seconds) : cls.label}
                  </span>
                </div>
              </div>

              <div className="ddc-recents-actions-cell">
                <span className="ddc-recents-redial-icon">📞</span>
              </div>
            </button>
          );
        })}
      </div>

      {hasMore && !loading && (
        <div className="ddc-recents-more-row">
          <button
            className="ddc-recents-more"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            Show more ({filteredCdrs.length - visible} remaining)
          </button>
        </div>
      )}

      <style>{`
        .ddc-recents {
          min-height: 100%;
          padding: 28px 40px 60px;
          font-family: ${fonts.sans};
          overflow-y: auto;
        }
        .ddc-recents-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .ddc-recents-title {
          color: ${brand.white};
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 0;
          text-transform: uppercase;
        }
        .ddc-recents-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ddc-recents-count {
          color: ${brand.textMuted};
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-family: ${fonts.mono};
        }
        .ddc-recents-refresh {
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
        .ddc-recents-refresh:hover:not(:disabled) {
          background: rgba(77, 166, 255, 0.1);
          border-color: ${brand.blue};
        }
        .ddc-recents-refresh:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .ddc-recents-clear {
          background: transparent;
          border: 1px solid rgba(232, 19, 42, 0.45);
          color: ${brand.red};
          font-family: ${fonts.sans};
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          padding: 8px 16px;
          border-radius: 17px;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ddc-recents-clear:hover:not(:disabled) {
          background: ${brand.red};
          color: #fff;
          border-color: ${brand.red};
        }
        .ddc-recents-clear:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .ddc-recents-error {
          color: ${brand.red};
          background: rgba(232, 19, 42, 0.08);
          border: 1px solid rgba(232, 19, 42, 0.25);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 13px;
        }

        .ddc-recents-empty {
          text-align: center;
          padding: 60px 0;
          color: ${brand.textMuted};
        }
        .ddc-recents-empty-icon {
          font-size: 48px;
          opacity: 0.5;
          margin-bottom: 12px;
        }
        .ddc-recents-empty-title {
          color: ${brand.white};
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .ddc-recents-empty-sub {
          font-size: 12px;
          letter-spacing: 0.5px;
        }

        .ddc-recents-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .ddc-recents-row {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 10px 14px;
          color: ${brand.white};
          font-family: ${fonts.sans};
          text-align: left;
          cursor: pointer;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .ddc-recents-row:hover:not(:disabled) {
          background: rgba(77, 166, 255, 0.06);
          border-color: rgba(77, 166, 255, 0.2);
        }
        .ddc-recents-row:disabled {
          cursor: default;
        }
        .ddc-recents-row:disabled:hover {
          background: transparent;
          border-color: transparent;
        }

        .ddc-recents-arrow {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          flex-shrink: 0;
          background: rgba(7, 20, 64, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .ddc-recents-arrow.missed {
          color: ${brand.red};
          border-color: rgba(232, 19, 42, 0.4);
        }
        .ddc-recents-arrow.inbound {
          color: ${brand.white};
          border-color: rgba(255, 255, 255, 0.25);
        }
        .ddc-recents-arrow.outbound {
          color: ${brand.blue};
          border-color: rgba(77, 166, 255, 0.4);
        }
        .ddc-recents-arrow.noanswer {
          color: ${brand.blue};
          opacity: 0.6;
          border-color: rgba(77, 166, 255, 0.25);
        }

        .ddc-recents-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .ddc-recents-name-row {
          display: flex;
          align-items: baseline;
          gap: 10px;
          overflow: hidden;
        }
        .ddc-recents-name {
          font-size: 14px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-recents-name.missed   { color: ${brand.red}; }
        .ddc-recents-name.inbound  { color: ${brand.white}; }
        .ddc-recents-name.outbound { color: ${brand.blue}; }
        .ddc-recents-name.noanswer { color: ${brand.blue}; opacity: 0.65; font-style: italic; }

        .ddc-recents-number {
          font-family: ${fonts.mono};
          font-size: 11px;
          color: ${brand.textMuted};
          letter-spacing: 0.3px;
        }
        .ddc-recents-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: ${brand.textMuted};
        }
        .ddc-recents-time { letter-spacing: 0.5px; }
        .ddc-recents-sep { opacity: 0.5; }
        .ddc-recents-duration { font-family: ${fonts.mono}; }

        .ddc-recents-actions-cell {
          opacity: 0;
          transition: opacity 120ms ease;
          color: ${brand.blue};
          font-size: 16px;
          flex-shrink: 0;
        }
        .ddc-recents-row:hover:not(:disabled) .ddc-recents-actions-cell {
          opacity: 1;
        }

        .ddc-recents-more-row {
          display: flex;
          justify-content: center;
          padding: 24px 0 40px;
        }
        .ddc-recents-more {
          background: transparent;
          border: 1px solid rgba(77, 166, 255, 0.3);
          border-radius: 20px;
          color: ${brand.blue};
          padding: 10px 22px;
          font-family: ${fonts.sans};
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ddc-recents-more:hover {
          background: rgba(77, 166, 255, 0.1);
          border-color: ${brand.blue};
        }
      `}</style>
    </div>
  );
}

// ---------- helpers ----------

interface CallClass {
  tone: 'missed' | 'inbound' | 'outbound' | 'noanswer';
  arrow: string;
  label: string;
}

function classifyCall(cdr: CdrRecord, myExt: string): CallClass {
  // 'local' direction is internal ext-to-ext — treat as outbound from
  // our perspective if the caller matches the current user's ext, else
  // as inbound.
  const effective =
    cdr.direction === 'local'
      ? cdr.caller_id_number === myExt
        ? 'outbound'
        : 'inbound'
      : cdr.direction;

  if (effective === 'inbound') {
    if (cdr.was_answered) {
      return { tone: 'inbound', arrow: '↙', label: 'Incoming' };
    }
    return { tone: 'missed', arrow: '↙', label: 'Missed' };
  }
  // outbound
  if (cdr.was_answered) {
    return { tone: 'outbound', arrow: '↗', label: 'Outgoing' };
  }
  return { tone: 'noanswer', arrow: '↗', label: 'No answer' };
}

function displayNameFor(
  cdr: CdrRecord,
  cls: CallClass,
): { primary: string; secondary: string } {
  if (cls.tone === 'outbound' || cls.tone === 'noanswer') {
    // For outgoing, show who we DIALED
    return {
      primary: cdr.destination_number || '(unknown)',
      secondary: '',
    };
  }
  // For incoming and missed, show who called US
  const name = cdr.caller_id_name?.trim();
  const number = cdr.caller_id_number || '(unknown)';
  // Reject the name if it's empty, matches the number, starts with
  // '+' (likely a raw E.164 tagged as "name"), or matches the junk
  // pattern (6–12 char alphanumeric — typical sofia/verto NAT
  // session tokens that leak into caller_id_name).
  const isJunk = !name || name === number || name.startsWith('+')
    || JUNK_NAME_RE.test(name);
  if (!isJunk) {
    return { primary: name, secondary: number };
  }
  return { primary: number, secondary: '' };
}

function redialTargetFor(cdr: CdrRecord, cls: CallClass): string {
  // For outgoing, redial the destination. For incoming, call the
  // caller back. Strip any leading + for internal consistency with
  // how the dialplan expects dialed numbers (E.164 is accepted by
  // outbound_e164 but raw 10-digit is cleaner for same-country dials).
  const raw =
    cls.tone === 'outbound' || cls.tone === 'noanswer'
      ? cdr.destination_number
      : cdr.caller_id_number;
  return (raw || '').replace(/^\+/, '');
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  // Older than a week → show absolute date
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: diffDay > 365 ? 'numeric' : undefined,
  });
}
