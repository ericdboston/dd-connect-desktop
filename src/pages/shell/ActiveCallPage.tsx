import { useEffect, useState } from 'react';
import { useSip } from '../../store/sip';
import { brand, fonts } from '../../theme';
import { fetchParkSlots } from '../../api/sms';
import { sounds } from '../../services/Sounds';
import type { ParkSlot } from '../../api/types';

export default function ActiveCallPage() {
  const currentCall = useSip((s) => s.currentCall);
  const muted = useSip((s) => s.muted);
  const toggleMute = useSip((s) => s.toggleMute);
  const hangupCall = useSip((s) => s.hangupCall);
  const blindTransfer = useSip((s) => s.blindTransfer);
  const sendDtmf = useSip((s) => s.sendDtmf);

  const [held, setHeld] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkSlots, setParkSlots] = useState<ParkSlot[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [dtmfSent, setDtmfSent] = useState('');

  const loadParkSlots = async () => {
    try {
      const data = await fetchParkSlots();
      setParkSlots(data.slots);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!parkOpen) return;
    loadParkSlots();
    const timer = setInterval(loadParkSlots, 3000);
    return () => clearInterval(timer);
  }, [parkOpen]);

  const handleParkSlot = async (slot: ParkSlot) => {
    setParkOpen(false);
    if (slot.occupied) {
      await blindTransfer(String(slot.slot));
    } else {
      await blindTransfer(`*77${slot.slot}`);
    }
  };

  // Tick the call duration only while the call is in the connected
  // state. Reset to zero whenever a new call mounts the component.
  useEffect(() => {
    if (!currentCall) return;
    if (currentCall.state !== 'connected') {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    setDtmfSent('');
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentCall?.state, currentCall?.id]);

  // Defensive: if the layout ever mounts this component without a
  // current call (shouldn't happen — ShellLayout gates on currentCall),
  // render an empty container instead of crashing.
  if (!currentCall) {
    return <div className="ddc-call" />;
  }

  const callerNumber = currentCall.number || 'Unknown';
  const callerName =
    currentCall.name && currentCall.name !== currentCall.number
      ? currentCall.name
      : null;

  const status = (() => {
    if (currentCall.state === 'connected') return formatDuration(seconds);
    if (currentCall.state === 'ringing') {
      return currentCall.direction === 'incoming' ? 'Incoming call' : 'Calling…';
    }
    return 'Call ended';
  })();

  return (
    <div className="ddc-call">
      <div className="ddc-call-header">
        <div className="ddc-call-avatar">
          {(callerName || callerNumber).slice(0, 1).toUpperCase()}
        </div>
        <div className="ddc-call-name">{callerName || callerNumber}</div>
        {callerName && <div className="ddc-call-number">{callerNumber}</div>}
        <div className={`ddc-call-status ${currentCall.state === 'connected' ? 'connected' : ''}`}>
          {status}
        </div>
      </div>

      <div className="ddc-call-controls">
        <ControlButton
          icon={muted ? '🔇' : '🎙'}
          label={muted ? 'Unmute' : 'Mute'}
          active={muted}
          onClick={() => { void toggleMute(); }}
        />
        <ControlButton
          icon={held ? '▶' : '⏸'}
          label={held ? 'Resume' : 'Hold'}
          active={held}
          onClick={() => setHeld((h) => !h)}
          stub
        />
        <ControlButton
          icon="🅿️"
          label="Park"
          active={parkOpen}
          onClick={() => setParkOpen((p) => !p)}
        />
        <ControlButton
          icon="⌨"
          label="Keypad"
          active={keypadOpen}
          onClick={() => setKeypadOpen((k) => !k)}
        />
      </div>

      {keypadOpen && (
        <InCallKeypad
          dtmfSent={dtmfSent}
          onPress={(d) => {
            sounds.playDtmf(d);
            setDtmfSent((prev) => prev + d);
            void sendDtmf(d);
          }}
          onClear={() => setDtmfSent('')}
        />
      )}

      {parkOpen && (
        <div className="ddc-park-panel">
          <div className="ddc-park-title">Park Slots</div>
          <div className="ddc-park-grid">
            {parkSlots.map((ps) => (
              <button
                key={ps.slot}
                className={`ddc-park-slot ${ps.occupied ? 'occupied' : 'available'}`}
                onClick={() => { void handleParkSlot(ps); }}
                type="button"
              >
                <span className="ddc-park-slot-num">{ps.slot}</span>
                {ps.occupied && ps.caller_id_number && (
                  <span className="ddc-park-slot-cid">{ps.caller_id_name || ps.caller_id_number}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="ddc-call-end" onClick={hangupCall} type="button">
        <span className="ddc-call-end-icon">⌃</span>
        END CALL
      </button>

      <style>{`
        .ddc-call {
          min-height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px 60px;
          font-family: ${fonts.sans};
          gap: 32px;
        }

        .ddc-call-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .ddc-call-avatar {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: rgba(77, 166, 255, 0.15);
          border: 1px solid rgba(77, 166, 255, 0.35);
          color: ${brand.white};
          font-size: 38px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
          box-shadow: 0 0 40px rgba(77, 166, 255, 0.20);
        }
        .ddc-call-name {
          font-family: ${fonts.sans};
          font-size: 26px;
          font-weight: 700;
          color: ${brand.white};
          line-height: 1;
        }
        .ddc-call-number {
          font-family: ${fonts.mono};
          font-size: 14px;
          color: #8aa0d8;
          letter-spacing: 1.5px;
        }
        .ddc-call-status {
          margin-top: 6px;
          font-size: 13px;
          color: ${brand.blue};
          letter-spacing: 1.8px;
          text-transform: uppercase;
          font-weight: 600;
        }
        .ddc-call-status.connected {
          font-family: ${fonts.mono};
          font-size: 22px;
          letter-spacing: 3px;
          color: ${brand.success};
          text-transform: none;
        }

        .ddc-call-controls {
          display: grid;
          grid-template-columns: repeat(4, 80px);
          gap: 18px;
        }
        .ddc-ctl {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          background: transparent;
          border: none;
          color: #c8d4f5;
          cursor: pointer;
          font-family: ${fonts.sans};
          padding: 0;
        }
        .ddc-ctl-icon {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: rgba(7, 20, 64, 0.65);
          border: 1px solid rgba(77, 166, 255, 0.18);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .ddc-ctl:hover .ddc-ctl-icon {
          border-color: ${brand.blue};
          background: rgba(77, 166, 255, 0.10);
        }
        .ddc-ctl.active .ddc-ctl-icon {
          background: ${brand.blue};
          border-color: ${brand.blue};
          color: #fff;
        }
        .ddc-ctl-label {
          font-size: 11px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
        }
        .ddc-ctl.stub .ddc-ctl-icon::after {
          content: '';
          position: relative;
        }
        .ddc-ctl.stub .ddc-ctl-label::after {
          content: ' *';
          color: ${brand.textMuted};
        }

        .ddc-call-end {
          margin-top: 8px;
          height: 64px;
          min-width: 220px;
          background: ${brand.red};
          color: #fff;
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 3px;
          border: none;
          border-radius: 32px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          box-shadow: 0 0 0 1px rgba(232, 19, 42, 0.4),
                      0 6px 24px rgba(232, 19, 42, 0.35),
                      0 0 30px rgba(232, 19, 42, 0.15);
        }
        .ddc-call-end:hover { filter: brightness(1.1); }
        .ddc-call-end-icon { font-size: 18px; line-height: 1; }

        .ddc-park-panel {
          width: 100%;
          max-width: 420px;
          padding: 16px;
          background: rgba(15, 27, 45, 0.9);
          border: 1px solid ${brand.border};
          border-radius: 12px;
        }
        .ddc-park-title {
          font-size: 13px;
          font-weight: 600;
          color: ${brand.textMuted};
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 12px;
          text-align: center;
        }
        .ddc-park-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        .ddc-park-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 10px 4px;
          border-radius: 8px;
          border: 1px solid ${brand.border};
          background: rgba(255,255,255,0.04);
          cursor: pointer;
          font-family: ${fonts.sans};
          color: ${brand.white};
          transition: border-color 120ms;
        }
        .ddc-park-slot:hover { border-color: ${brand.blue}; }
        .ddc-park-slot.available { border-color: rgba(34,197,94,0.3); }
        .ddc-park-slot.occupied { border-color: rgba(232,19,42,0.3); background: rgba(232,19,42,0.08); }
        .ddc-park-slot-num { font-family: ${fonts.mono}; font-size: 14px; font-weight: 600; }
        .ddc-park-slot-cid { font-size: 9px; color: ${brand.textMuted}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70px; }

        .ddc-incall-keypad {
          max-width: 320px;
          padding: 16px;
          background: rgba(15, 27, 45, 0.9);
          border: 1px solid ${brand.border};
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .ddc-incall-display {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          min-height: 28px;
        }
        .ddc-incall-digits {
          font-family: ${fonts.mono};
          font-size: 18px;
          letter-spacing: 3px;
          color: ${brand.white};
          flex: 1;
          word-break: break-all;
        }
        .ddc-incall-clear {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid ${brand.border};
          background: transparent;
          color: #8aa0d8;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: color 120ms ease, border-color 120ms ease;
        }
        .ddc-incall-clear:hover {
          color: ${brand.white};
          border-color: ${brand.blue};
        }
        .ddc-incall-grid {
          display: grid;
          grid-template-columns: repeat(3, 64px);
          gap: 10px;
        }
        .ddc-incall-key {
          width: 64px;
          height: 64px;
          background: rgba(7, 20, 64, 0.65);
          border: 1px solid rgba(77, 166, 255, 0.18);
          border-radius: 12px;
          color: ${brand.white};
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: ${fonts.sans};
          transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease;
        }
        .ddc-incall-key:hover {
          border-color: ${brand.blue};
          background: rgba(77, 166, 255, 0.10);
        }
        .ddc-incall-key:active {
          transform: scale(0.96);
          background: rgba(77, 166, 255, 0.16);
        }
        .ddc-incall-key-digit {
          font-size: 22px;
          font-weight: 600;
        }
        .ddc-incall-key-sub {
          font-size: 9px;
          letter-spacing: 1.4px;
          color: #8aa0d8;
        }
      `}</style>
    </div>
  );
}

interface CtlProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  stub?: boolean;
}
function ControlButton({ icon, label, active, onClick, stub }: CtlProps) {
  const cls = `ddc-ctl${active ? ' active' : ''}${stub ? ' stub' : ''}`;
  return (
    <button type="button" className={cls} onClick={onClick}>
      <span className="ddc-ctl-icon">{icon}</span>
      <span className="ddc-ctl-label">{label}</span>
    </button>
  );
}

interface InCallKeypadProps {
  dtmfSent: string;
  onPress: (digit: string) => void;
  onClear: () => void;
}

const KEYPAD_KEYS: Array<{ digit: string; sub: string }> = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

function InCallKeypad({ dtmfSent, onPress, onClear }: InCallKeypadProps) {
  return (
    <div className="ddc-incall-keypad">
      <div className="ddc-incall-display">
        <span className="ddc-incall-digits">{dtmfSent || ' '}</span>
        {dtmfSent && (
          <button
            type="button"
            className="ddc-incall-clear"
            onClick={onClear}
            aria-label="Clear digits"
          >
            ⌫
          </button>
        )}
      </div>
      <div className="ddc-incall-grid">
        {KEYPAD_KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            className="ddc-incall-key"
            onClick={() => onPress(k.digit)}
          >
            <span className="ddc-incall-key-digit">{k.digit}</span>
            {k.sub && <span className="ddc-incall-key-sub">{k.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}
