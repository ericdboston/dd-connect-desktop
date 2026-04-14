import { useEffect, useState } from 'react';
import { brand, fonts } from '../theme';

const AUTO_DECLINE_MS = 30_000;

/**
 * Renders inside the Electron always-on-top popup window.
 *
 * Reads caller info from the hash-query params set by
 * electron/incomingCallWindow.openIncomingCallWindow. No router,
 * no store, no auth — this component is a leaf and communicates
 * with the rest of the app exclusively via the `incomingCall`
 * IPC bridge exposed on window.ddconnect.
 */
export default function IncomingCallPopup() {
  const [caller, setCaller] = useState(() => parseCallerFromHash());
  const [countdown, setCountdown] = useState(Math.floor(AUTO_DECLINE_MS / 1000));

  // Subscribe to IPC update events in case the main process swaps
  // us to a new caller mid-flight (e.g. a second INVITE arrived).
  useEffect(() => {
    const unsub = window.ddconnect?.incomingCall?.onUpdate?.((info) => {
      setCaller(info);
      setCountdown(Math.floor(AUTO_DECLINE_MS / 1000));
    });
    return () => { unsub?.(); };
  }, []);

  // Countdown tick + auto-decline after 30 seconds.
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          // Fire the decline action once, then stop the timer.
          window.ddconnect?.incomingCall?.sendAction('decline');
          clearInterval(tick);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [caller.callId]);

  const onAnswer = () => {
    window.ddconnect?.incomingCall?.sendAction('answer');
  };
  const onDecline = () => {
    window.ddconnect?.incomingCall?.sendAction('decline');
  };

  const displayName =
    caller.callerName && caller.callerName !== caller.callerNumber
      ? caller.callerName
      : null;

  return (
    <div className="ddc-incoming">
      <div className="ddc-incoming-header">
        <img
          src="/ddconnect-logo.png"
          alt="DD Connect"
          className="ddc-incoming-logo"
        />
        <span className="ddc-incoming-label">Incoming call</span>
        <span className="ddc-incoming-countdown">{countdown}s</span>
      </div>

      <div className="ddc-incoming-caller">
        <div className="ddc-incoming-name">
          {displayName ?? caller.callerNumber ?? 'Unknown'}
        </div>
        {displayName && (
          <div className="ddc-incoming-number">{caller.callerNumber}</div>
        )}
      </div>

      <div className="ddc-incoming-actions">
        <button
          type="button"
          className="ddc-incoming-btn ddc-incoming-decline"
          onClick={onDecline}
        >
          <span className="ddc-incoming-icon">✕</span>
          Decline
        </button>
        <button
          type="button"
          className="ddc-incoming-btn ddc-incoming-answer"
          onClick={onAnswer}
        >
          <span className="ddc-incoming-icon">📞</span>
          Answer
        </button>
      </div>

      <style>{`
        html, body, #root {
          background: transparent !important;
        }
        .ddc-incoming {
          width: 100vw;
          height: 100vh;
          box-sizing: border-box;
          padding: 18px 20px 20px;
          background:
            radial-gradient(ellipse at top left, #112280 0%, #071440 100%);
          border: 1px solid rgba(77, 166, 255, 0.35);
          border-radius: 14px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
          color: ${brand.white};
          font-family: ${fonts.sans};
          display: flex;
          flex-direction: column;
          -webkit-app-region: drag; /* let user drag the frameless window */
          position: relative;
          overflow: hidden;
        }
        /* Thin ring-pulse glow around the card — makes it feel alive */
        .ddc-incoming::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 16px;
          border: 2px solid rgba(77, 166, 255, 0.45);
          animation: ring-pulse 1.8s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes ring-pulse {
          0%, 100% {
            opacity: 0.3;
            box-shadow: 0 0 0 0 rgba(77, 166, 255, 0.45);
          }
          50% {
            opacity: 0.9;
            box-shadow: 0 0 24px 4px rgba(77, 166, 255, 0.3);
          }
        }

        .ddc-incoming-header {
          display: flex;
          align-items: center;
          gap: 10px;
          -webkit-app-region: drag;
        }
        .ddc-incoming-logo {
          width: 26px;
          height: 26px;
          object-fit: contain;
          display: block;
        }
        .ddc-incoming-label {
          flex: 1;
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: ${brand.blue};
          font-weight: 700;
        }
        .ddc-incoming-countdown {
          font-family: ${fonts.mono};
          font-size: 11px;
          color: ${brand.textMuted};
          letter-spacing: 0.5px;
        }

        .ddc-incoming-caller {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 4px;
          padding: 6px 0 10px;
        }
        .ddc-incoming-name {
          font-size: 22px;
          font-weight: 700;
          color: ${brand.white};
          line-height: 1.1;
        }
        .ddc-incoming-number {
          font-family: ${fonts.mono};
          font-size: 13px;
          color: #8aa0d8;
          letter-spacing: 1px;
        }

        .ddc-incoming-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          -webkit-app-region: no-drag; /* buttons must be clickable */
        }
        .ddc-incoming-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 44px;
          border: none;
          border-radius: 22px;
          color: #fff;
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: filter 120ms ease, transform 80ms ease;
        }
        .ddc-incoming-btn:hover { filter: brightness(1.12); }
        .ddc-incoming-btn:active { transform: translateY(1px); }
        .ddc-incoming-decline {
          background: ${brand.red};
          box-shadow: 0 0 0 1px rgba(232, 19, 42, 0.5),
                      0 6px 22px rgba(232, 19, 42, 0.45);
        }
        .ddc-incoming-answer {
          background: ${brand.success};
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.5),
                      0 6px 22px rgba(34, 197, 94, 0.45);
        }
        .ddc-incoming-icon { font-size: 14px; line-height: 1; }
      `}</style>
    </div>
  );
}

// Parse ?name=...&number=...&callId=... from window.location.hash.
// The popup is loaded with hash "/incoming-call?name=...&number=..."
// so we need to split on '?' and use URLSearchParams on the query half.
function parseCallerFromHash(): {
  callerName: string;
  callerNumber: string;
  callId: string;
} {
  const hash = window.location.hash || '';
  // hash looks like: "#/incoming-call?name=Alice&number=5551234&callId=xyz"
  const idx = hash.indexOf('?');
  const qs = idx >= 0 ? hash.slice(idx + 1) : '';
  const params = new URLSearchParams(qs);
  return {
    callerName: params.get('name') || '',
    callerNumber: params.get('number') || '',
    callId: params.get('callId') || '',
  };
}
