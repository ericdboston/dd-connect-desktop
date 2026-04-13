// DDTG brand — single source of truth for colors and typography.
// Mirrors the React Native app and the web portal so the desktop UI
// feels like a coherent member of the family, not a fork.
export const brand = {
  navy: '#0d1a6e',
  navyLight: '#112280',
  navyDark: '#0a1458',
  blue: '#4da6ff',
  blueDim: '#2e7bd1',
  red: '#e8132a',
  redDim: '#b00e20',
  white: '#f0f4ff',
  textMuted: '#9aa3c7',
  border: '#1f2f8a',
  success: '#22c55e',
  error: '#e8132a',
} as const;

export const fonts = {
  // Syne for display, JetBrains Mono for numbers/data.
  sans: "'Syne', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
} as const;
