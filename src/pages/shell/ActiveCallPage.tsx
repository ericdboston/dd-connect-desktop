import { useEffect, useState } from 'react';
import { useSip } from '../../store/sip';
import { brand, fonts } from '../../theme';

export default function ActiveCallPage() {
  const currentCall = useSip((s) => s.currentCall);
  const muted = useSip((s) => s.muted);
  const toggleMute = useSip((s) => s.toggleMute);
  const hangupCall = useSip((s) => s.hangupCall);

  const [held, setHeld] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [seconds, setSeconds] = useState(0);

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
          icon="⌨"
          label="Keypad"
          active={keypadOpen}
          onClick={() => setKeypadOpen((k) => !k)}
          stub
        />
        <ControlButton
          icon="🔊"
          label="Speaker"
          active={speaker}
          onClick={() => setSpeaker((s) => !s)}
          stub
        />
      </div>

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

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}
