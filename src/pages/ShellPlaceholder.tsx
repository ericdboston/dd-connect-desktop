import { useAuth } from '../store/auth';
import { brand, fonts } from '../theme';

// Empty branded shell — v0.1 placeholder, gets replaced in Step 3B with
// the real sidebar + top bar layout.
export default function ShellPlaceholder() {
  const { extension, display_name, signOut } = useAuth();

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.logoDD}>DD</span>
          <span style={styles.logoConnect}>Connect</span>
        </div>
        <div style={styles.subtitle}>Signed in</div>

        <div style={styles.row}>
          <span style={styles.label}>Name</span>
          <span style={styles.value}>{display_name || '—'}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Extension</span>
          <span style={{ ...styles.value, fontFamily: fonts.mono }}>
            {extension || '—'}
          </span>
        </div>

        <button style={styles.signOut} onClick={signOut}>Sign out</button>
      </div>
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
    fontFamily: fonts.sans,
  },
  card: {
    width: 420,
    background: brand.navyLight,
    border: `1px solid ${brand.border}`,
    borderRadius: 16,
    padding: '40px 36px',
  },
  logoRow: { textAlign: 'center', fontWeight: 800, fontSize: 40, lineHeight: 1 },
  logoDD: { color: brand.red },
  logoConnect: { color: brand.white, marginLeft: 8 },
  subtitle: {
    textAlign: 'center',
    color: brand.blue,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 28,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: `1px solid ${brand.border}`,
  },
  label: {
    color: brand.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: { color: brand.white, fontSize: 15 },
  signOut: {
    marginTop: 28,
    width: '100%',
    background: 'transparent',
    color: brand.blue,
    border: `1px solid ${brand.blue}`,
    borderRadius: 8,
    padding: '12px 16px',
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
};
