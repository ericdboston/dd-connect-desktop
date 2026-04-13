import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ddconnectLogin } from '../api/auth';
import { extractErrorMessage } from '../api/client';
import { useAuth } from '../store/auth';
import { brand, fonts } from '../theme';

const REMEMBER_KEY = 'login:rememberedExtension';

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const [extension, setExtension] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await window.ddconnect?.store.get<string>(REMEMBER_KEY);
        if (saved) setExtension(saved);
      } catch { /* electron-store unavailable — ignore */ }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const ext = extension.trim();
    if (!ext || !password) {
      setError('Extension and password are required.');
      return;
    }

    setLoading(true);
    try {
      const res = await ddconnectLogin(ext, password);
      await setSession(
        {
          access: res.access,
          refresh: res.refresh,
          extension: res.sip_config.extension,
          display_name: res.sip_config.display_name,
          sip_config: res.sip_config,
        },
        remember,
      );
      if (remember) {
        try { await window.ddconnect?.store.set(REMEMBER_KEY, ext); } catch { /* noop */ }
      } else {
        try { await window.ddconnect?.store.delete(REMEMBER_KEY); } catch { /* noop */ }
      }
      navigate('/shell', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ddc-splash">
      {/* Circuit board ghost overlay — pure SVG so no asset loading */}
      <svg className="ddc-circuit" viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#4da6ff" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="1280" height="800" fill="url(#grid)" />
        {/* scattered circuit traces */}
        <g stroke="#4da6ff" strokeWidth="0.6" fill="none" opacity="0.6">
          <path d="M 120 120 L 220 120 L 220 200 L 320 200" />
          <circle cx="320" cy="200" r="3" fill="#4da6ff" />
          <path d="M 960 140 L 1080 140 L 1080 240" />
          <circle cx="1080" cy="240" r="3" fill="#4da6ff" />
          <path d="M 100 620 L 220 620 L 220 700" />
          <circle cx="220" cy="700" r="3" fill="#4da6ff" />
          <path d="M 1040 600 L 1160 600 L 1160 680 L 1080 680" />
          <circle cx="1160" cy="600" r="3" fill="#4da6ff" />
          <path d="M 480 80 L 480 160 L 560 160" />
          <path d="M 760 720 L 760 640 L 680 640" />
        </g>
        <g stroke="#e8132a" strokeWidth="0.6" fill="none" opacity="0.4">
          <path d="M 200 360 L 280 360 L 280 440" />
          <circle cx="280" cy="440" r="2.5" fill="#e8132a" />
          <path d="M 1080 380 L 1000 380 L 1000 460" />
          <circle cx="1000" cy="460" r="2.5" fill="#e8132a" />
        </g>
      </svg>

      {/* Four corner brackets */}
      <span className="ddc-bracket ddc-bracket-tl" />
      <span className="ddc-bracket ddc-bracket-tr" />
      <span className="ddc-bracket ddc-bracket-bl" />
      <span className="ddc-bracket ddc-bracket-br" />

      <div className="ddc-content">
        {/* Logo */}
        <div className="ddc-logo-circle">
          <div className="ddc-logo-letters">
            <span className="ddc-d-red">D</span>
            <span className="ddc-d-blue">D</span>
          </div>
        </div>
        <div className="ddc-wordmark">CONNECT</div>
        <div className="ddc-underline" />
        <div className="ddc-tagline">UNIFIED COMMUNICATIONS</div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="ddc-form">
          <label className="ddc-label" htmlFor="ext">EXTENSION</label>
          <input
            id="ext"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            placeholder="Enter your extension"
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            disabled={loading}
            className="ddc-input"
          />

          <label className="ddc-label" htmlFor="pw">SIP PASSWORD</label>
          <input
            id="pw"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="ddc-input"
          />

          <label className="ddc-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={loading}
            />
            <span>Remember me</span>
          </label>

          <button type="submit" disabled={loading} className="ddc-submit">
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>

          {error && <div className="ddc-error">{error}</div>}
        </form>
      </div>

      <div className="ddc-footer">
        Powered by Decisive Data Technology Group
      </div>

      {/* Inline scoped styles — keeps every rule for this screen colocated */}
      <style>{`
        .ddc-splash {
          position: fixed;
          inset: 0;
          background:
            radial-gradient(ellipse at center, #0d2080 0%, #071440 70%, #050e30 100%);
          font-family: ${fonts.sans};
          color: ${brand.white};
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
        }
        .ddc-circuit {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.08;
          pointer-events: none;
        }
        .ddc-bracket {
          position: absolute;
          width: 36px;
          height: 36px;
          pointer-events: none;
        }
        .ddc-bracket-tl {
          top: 28px; left: 28px;
          border-top: 2px solid #e8132a;
          border-left: 2px solid #e8132a;
        }
        .ddc-bracket-tr {
          top: 28px; right: 28px;
          border-top: 2px solid #4da6ff;
          border-right: 2px solid #4da6ff;
        }
        .ddc-bracket-bl {
          bottom: 28px; left: 28px;
          border-bottom: 2px solid #4da6ff;
          border-left: 2px solid #4da6ff;
        }
        .ddc-bracket-br {
          bottom: 28px; right: 28px;
          border-bottom: 2px solid #e8132a;
          border-right: 2px solid #e8132a;
        }

        .ddc-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 380px;
        }

        .ddc-logo-circle {
          width: 132px;
          height: 132px;
          border-radius: 50%;
          background: rgba(8, 18, 60, 0.6);
          border: 1px solid rgba(77, 166, 255, 0.18);
          box-shadow:
            inset 0 0 24px rgba(0, 0, 0, 0.45),
            0 0 40px rgba(77, 166, 255, 0.10);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 22px;
        }
        .ddc-logo-letters {
          position: relative;
          width: 86px;
          height: 64px;
        }
        .ddc-d-red, .ddc-d-blue {
          position: absolute;
          top: 0;
          font-family: ${fonts.sans};
          font-weight: 800;
          font-size: 64px;
          line-height: 1;
        }
        .ddc-d-red {
          left: 0;
          color: #e8132a;
          text-shadow: 0 0 18px rgba(232, 19, 42, 0.45);
        }
        .ddc-d-blue {
          right: 0;
          color: #4da6ff;
          text-shadow: 0 0 18px rgba(77, 166, 255, 0.45);
        }

        .ddc-wordmark {
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 30px;
          letter-spacing: 14px;
          color: #f0f4ff;
          padding-left: 14px; /* visually compensate for letter-spacing */
        }
        .ddc-underline {
          width: 180px;
          height: 1px;
          background: #4da6ff;
          margin: 8px 0 12px;
          box-shadow: 0 0 8px rgba(77, 166, 255, 0.6);
        }
        .ddc-tagline {
          font-family: ${fonts.sans};
          font-size: 11px;
          letter-spacing: 5px;
          color: #8aa0d8;
          margin-bottom: 42px;
          text-transform: uppercase;
        }

        .ddc-form {
          width: 100%;
          display: flex;
          flex-direction: column;
        }
        .ddc-label {
          font-size: 11px;
          letter-spacing: 3px;
          color: #8aa0d8;
          margin-bottom: 8px;
          margin-top: 18px;
        }
        .ddc-label:first-child { margin-top: 0; }

        .ddc-input {
          background: rgba(7, 20, 64, 0.55);
          border: none;
          border-bottom: 1px solid rgba(77, 166, 255, 0.45);
          color: #f0f4ff;
          font-family: ${fonts.mono};
          font-size: 16px;
          letter-spacing: 1.5px;
          padding: 12px 4px;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .ddc-input::placeholder {
          color: rgba(138, 160, 216, 0.55);
          letter-spacing: 0.5px;
        }
        .ddc-input:focus {
          border-bottom-color: #4da6ff;
          box-shadow: 0 1px 0 0 #4da6ff, 0 8px 20px -16px rgba(77, 166, 255, 0.7);
        }

        .ddc-remember {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #c8d4f5;
          font-size: 13px;
          letter-spacing: 1px;
          margin: 22px 0 24px;
          cursor: pointer;
          user-select: none;
        }
        .ddc-remember input {
          accent-color: #4da6ff;
          width: 14px;
          height: 14px;
          cursor: pointer;
        }

        .ddc-submit {
          width: 100%;
          background: #4da6ff;
          color: #ffffff;
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 4px;
          border: none;
          border-radius: 4px;
          padding: 14px 16px;
          cursor: pointer;
          box-shadow:
            0 0 0 1px rgba(77, 166, 255, 0.4),
            0 6px 24px rgba(77, 166, 255, 0.35),
            0 0 30px rgba(77, 166, 255, 0.15);
          transition: filter 150ms ease, box-shadow 150ms ease, transform 80ms ease;
        }
        .ddc-submit:hover:not(:disabled) {
          filter: brightness(1.1);
          box-shadow:
            0 0 0 1px rgba(77, 166, 255, 0.5),
            0 8px 32px rgba(77, 166, 255, 0.45),
            0 0 40px rgba(77, 166, 255, 0.25);
        }
        .ddc-submit:active:not(:disabled) { transform: translateY(1px); }
        .ddc-submit:disabled { opacity: 0.55; cursor: not-allowed; }

        .ddc-error {
          margin-top: 16px;
          color: #ff6b7a;
          font-size: 13px;
          text-align: center;
          letter-spacing: 0.5px;
        }

        .ddc-footer {
          position: absolute;
          bottom: 24px;
          left: 0;
          right: 0;
          text-align: center;
          color: #6b7ba8;
          font-size: 11px;
          letter-spacing: 1.5px;
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
