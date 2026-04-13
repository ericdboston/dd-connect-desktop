import { useEffect, useState } from 'react';
import { useSip } from '../../store/sip';
import { brand, fonts } from '../../theme';

interface KeyDef {
  digit: string;
  sub: string;
}

const KEYS: KeyDef[] = [
  { digit: '1', sub: ' ' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: ' ' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: ' ' },
];

export default function DialpadPage() {
  const isRegistered = useSip((s) => s.isRegistered);
  const currentCall = useSip((s) => s.currentCall);
  const makeCall = useSip((s) => s.makeCall);

  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Keyboard input — typing 0-9, *, # appends to the display.
  // Backspace removes the last digit. Enter places the call.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when the user is typing into another input
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (/^[0-9*#]$/.test(e.key)) {
        setDigits((d) => d + e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        setDigits((d) => d.slice(0, -1));
        e.preventDefault();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void place();
      } else if (e.key === '+') {
        setDigits((d) => d + '+');
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  function press(key: string) {
    setDigits((d) => d + key);
    setError(null);
  }

  function backspace() {
    setDigits((d) => d.slice(0, -1));
    setError(null);
  }

  async function place() {
    const target = digits.trim();
    if (!target) return;
    if (!isRegistered) {
      setError('Not registered with PBX');
      return;
    }
    try {
      await makeCall(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Call failed');
    }
  }

  // When a call is active the layout swaps in <ActiveCallPage /> and
  // this dialpad isn't visible at all — but the local `currentCall` ref
  // still gates the Call button so callers see a disabled state instead
  // of a "call already in progress" error if they somehow get here.
  const inCall = currentCall !== null;

  return (
    <div className="ddc-dialpad">
      <div className="ddc-dial-display">
        <div className="ddc-dial-digits">{digits || ' '}</div>
        {error && <div className="ddc-dial-error">{error}</div>}
      </div>

      <div className="ddc-dial-grid">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            className="ddc-dial-key"
            onClick={() => press(k.digit)}
          >
            <span className="ddc-dial-key-digit">{k.digit}</span>
            <span className="ddc-dial-key-sub">{k.sub.trim() || '\u00A0'}</span>
          </button>
        ))}
      </div>

      <div className="ddc-dial-actions">
        <button
          type="button"
          className="ddc-dial-back"
          onClick={backspace}
          disabled={!digits}
          aria-label="Backspace"
        >
          ⌫
        </button>
        <button
          type="button"
          className="ddc-dial-call"
          onClick={place}
          disabled={!digits || !isRegistered || inCall}
        >
          <span className="ddc-dial-call-icon">📞</span>
          CALL
        </button>
        <div className="ddc-dial-spacer" />
      </div>

      <style>{`
        .ddc-dialpad {
          min-height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 36px 24px 60px;
          font-family: ${fonts.sans};
        }
        .ddc-dial-display {
          width: 100%;
          max-width: 320px;
          min-height: 84px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-bottom: 22px;
        }
        .ddc-dial-digits {
          font-family: ${fonts.mono};
          font-size: 38px;
          font-weight: 500;
          letter-spacing: 4px;
          color: ${brand.white};
          min-height: 48px;
          line-height: 1.2;
        }
        .ddc-dial-error {
          margin-top: 6px;
          font-size: 12px;
          color: ${brand.red};
          letter-spacing: 0.5px;
        }
        .ddc-dial-callstate {
          margin-top: 4px;
          font-size: 12px;
          color: ${brand.blue};
          letter-spacing: 1.4px;
          text-transform: uppercase;
        }

        .ddc-dial-grid {
          display: grid;
          grid-template-columns: repeat(3, 84px);
          gap: 16px;
        }
        .ddc-dial-key {
          width: 84px;
          height: 84px;
          background: rgba(7, 20, 64, 0.65);
          border: 1px solid rgba(77, 166, 255, 0.18);
          border-radius: 12px;
          color: ${brand.white};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          cursor: pointer;
          transition: border-color 120ms ease, background-color 120ms ease, transform 60ms ease;
          font-family: ${fonts.sans};
        }
        .ddc-dial-key:hover {
          border-color: ${brand.blue};
          background: rgba(77, 166, 255, 0.10);
        }
        .ddc-dial-key:active { transform: scale(0.97); }
        .ddc-dial-key-digit {
          font-size: 28px;
          font-weight: 600;
          line-height: 1;
        }
        .ddc-dial-key-sub {
          font-size: 10px;
          letter-spacing: 1.6px;
          color: #8aa0d8;
          line-height: 1;
        }

        .ddc-dial-actions {
          display: grid;
          grid-template-columns: 64px 1fr 64px;
          align-items: center;
          gap: 16px;
          width: 100%;
          max-width: 332px;
          margin-top: 28px;
        }
        .ddc-dial-spacer { width: 64px; height: 64px; }
        .ddc-dial-back {
          width: 64px;
          height: 64px;
          background: transparent;
          color: #8aa0d8;
          border: 1px solid rgba(138, 160, 216, 0.35);
          border-radius: 50%;
          font-size: 22px;
          cursor: pointer;
          transition: color 120ms, border-color 120ms;
        }
        .ddc-dial-back:hover:not(:disabled) {
          color: ${brand.white};
          border-color: ${brand.blue};
        }
        .ddc-dial-back:disabled { opacity: 0.35; cursor: not-allowed; }

        .ddc-dial-call, .ddc-dial-end {
          height: 64px;
          border: none;
          border-radius: 32px;
          color: #ffffff;
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 3px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .ddc-dial-call {
          background: ${brand.success};
          box-shadow: 0 0 0 1px rgba(34,197,94,0.4),
                      0 6px 24px rgba(34,197,94,0.35),
                      0 0 30px rgba(34,197,94,0.15);
        }
        .ddc-dial-call:hover:not(:disabled) { filter: brightness(1.1); }
        .ddc-dial-call:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .ddc-dial-end {
          background: ${brand.red};
          box-shadow: 0 0 0 1px rgba(232,19,42,0.4),
                      0 6px 24px rgba(232,19,42,0.35);
        }
        .ddc-dial-end:hover { filter: brightness(1.1); }
        .ddc-dial-call-icon { font-size: 18px; line-height: 1; }
      `}</style>
    </div>
  );
}
