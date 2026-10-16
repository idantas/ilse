/**
 * Design tokens from shadcn preset radix-luma (b1VlJXuq).
 * Neutral base, border-radius 14px root, OKLCH colors converted to hex.
 *
 * These are used in place of hardcoded values throughout the Ilse toolbar.
 * The custom pixel/avatar/glow animations still use the #FF6C03 Ilse orange
 * directly — not part of the preset.
 */

// Border radius scale — derived from --radius: 0.875rem (14px)
export const radius = {
  sm: 8,    // 0.6 * 14
  md: 11,   // 0.8 * 14
  lg: 14,   // base
  xl: 20,   // 1.4 * 14
  '2xl': 25, // 1.8 * 14
  '3xl': 31, // 2.2 * 14
  full: 9999,
} as const;

// Neutral color palette (light mode) — converted from oklch
export const color = {
  background: '#ffffff',
  foreground: '#0a0a0a',      // oklch(0.145)
  card: '#ffffff',
  cardForeground: '#0a0a0a',
  popover: '#ffffff',
  popoverForeground: '#0a0a0a',
  primary: '#202020',          // oklch(0.205)
  primaryForeground: '#fafafa',
  secondary: '#f6f6f6',        // oklch(0.97)
  secondaryForeground: '#202020',
  muted: '#f6f6f6',
  mutedForeground: '#757575',  // oklch(0.556)
  accent: '#f6f6f6',
  accentForeground: '#202020',
  destructive: '#d43131',      // oklch destructive
  border: '#e8e8e8',           // oklch(0.922)
  input: '#e8e8e8',
  ring: '#a3a3a3',             // oklch(0.708)
} as const;

// Shadow scale — shadcn doesn't ship shadows in the preset, but radix-luma
// typically uses subtle neutral shadows. These are the defaults we'll use
// for non-custom elements (panels, cards).
export const shadow = {
  xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
  sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.04)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.08), 0 4px 6px rgba(0, 0, 0, 0.04)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.08), 0 8px 10px rgba(0, 0, 0, 0.04)',
} as const;

// Ilse identity — these are NOT from the preset, they're the brand custom
export const ilse = {
  /** Brand orange */
  brand: '#FA6900',
  orange: '#FF6C03',
  orangeLight: '#FFC194',
  orangePale: '#FFECDE',
  /** Test mode — blue, away from the orange and from the finding severities (red, amber, gray) */
  test: '#2F6BFF',
  testLight: '#A1BCFF',
  testPale: '#E2EAFF',
} as const;

/** The toolbar's accent per mode: hex for fills, "r,g,b" for rgba() glows */
export const modeAccent = (mode: 'design' | 'test') => mode === 'test'
  ? { hex: ilse.test, rgb: '47,107,255' }
  : { hex: ilse.orange, rgb: '255,108,3' };

// Font — preset uses --font-sans (inherits from app).
// We use the system sans-serif stack to match whatever the user's app defines.
export const font = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
} as const;
