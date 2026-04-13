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

  // Preload the extension field if "remember me" stored one previously.
  // We intentionally do NOT pre-fill the password — only the JWT refresh
  // token + extension number survive a sign-out cycle.
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
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.logoRow}>
          <span style={styles.logoDD}>DD</span>
          <span style={styles.logoConnect}>Connect</span>
        </div>
        <div style={styles.subtitle}>Desktop Softphone</div>

        <label style={styles.label} htmlFor="ext">Extension</label>
        <input
          id="ext"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          placeholder="Extension"
          value={extension}
          onChange={(e) => setExtension(e.target.value)}
          disabled={loading}
          style={styles.input}
        />

        <label style={styles.label} htmlFor="pw">SIP Password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          placeholder="SIP Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          style={styles.input}
        />

        <label style={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
            style={styles.checkbox}
          />
          <span>Remember me</span>
        </label>

        <button type="submit" disabled={loading} style={styles.submit}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>Decisive Data Technology Group</div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: brand.navy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    fontFamily: fonts.sans,
  },
  card: {
    width: 420,
    background: brand.navyLight,
    border: `1px solid ${brand.border}`,
    borderRadius: 16,
    padding: '40px 36px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    display: 'flex',
    flexDirection: 'column',
  },
  logoRow: {
    textAlign: 'center',
    fontFamily: fonts.sans,
    fontWeight: 800,
    fontSize: 44,
    letterSpacing: 0.5,
    lineHeight: 1,
    marginTop: 4,
  },
  logoDD: {
    color: brand.red,
  },
  logoConnect: {
    color: brand.white,
    marginLeft: 8,
  },
  subtitle: {
    textAlign: 'center',
    color: brand.blue,
    fontFamily: fonts.sans,
    fontWeight: 500,
    fontSize: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 32,
  },
  label: {
    color: brand.textMuted,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    background: brand.navy,
    border: `1px solid ${brand.border}`,
    borderRadius: 8,
    color: brand.white,
    fontFamily: fonts.mono,
    fontSize: 16,
    padding: '12px 14px',
    outline: 'none',
    transition: 'border-color 120ms ease',
  },
  remember: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: brand.white,
    fontSize: 14,
    marginTop: 18,
    marginBottom: 22,
    cursor: 'pointer',
    userSelect: 'none',
  },
  checkbox: {
    accentColor: brand.blue,
    width: 16,
    height: 16,
    cursor: 'pointer',
  },
  submit: {
    background: brand.red,
    color: brand.white,
    fontFamily: fonts.sans,
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 1,
    textTransform: 'uppercase',
    border: 'none',
    borderRadius: 8,
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'background-color 120ms ease',
  },
  error: {
    marginTop: 14,
    color: brand.red,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: 600,
  },
  footer: {
    marginTop: 28,
    color: brand.textMuted,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
};
