import { brand, fonts } from '../../theme';

interface Props {
  title: string;
  subtitle?: string;
}

// Generic centered placeholder for unbuilt shell pages. Each route in
// App.tsx renders one of these with a different title until the real
// page lands in a later step (Dialpad → 3D, IncomingCall → 3E, etc).
export default function PagePlaceholder({ title, subtitle }: Props) {
  return (
    <div style={styles.wrap}>
      <div style={styles.icon}>•</div>
      <div style={styles.title}>{title}</div>
      <div style={styles.sub}>{subtitle ?? 'Coming soon'}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: fonts.sans,
    color: brand.textMuted,
    padding: 40,
  },
  icon: {
    fontSize: 64,
    color: brand.blue,
    lineHeight: 1,
    marginBottom: 12,
    opacity: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 2,
    color: brand.white,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sub: {
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: brand.textMuted,
  },
};
