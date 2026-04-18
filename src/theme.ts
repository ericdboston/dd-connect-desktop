// DDTG brand — single source of truth for colors and typography.
// Mirrors the React Native app and the web portal so the desktop UI
// feels like a coherent member of the family, not a fork.
export const brand = {
  navy: '#07101c',
  navyLight: '#0f1b2d',
  navyDark: '#040a12',
  blue: '#3d9eff',
  blueDim: '#2b7fd4',
  red: '#e8132a',
  redDim: '#b00e20',
  white: '#f0f4ff',
  textMuted: '#9aa3c7',
  border: '#162236',
  success: '#22c55e',
  error: '#e8132a',
} as const;

export const fonts = {
  sans: "'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
} as const;
