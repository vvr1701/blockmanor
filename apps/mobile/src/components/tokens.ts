/**
 * Design tokens — PRD §15. The ONLY source of colour and type in the app:
 * no ad-hoc hex values, no one-off font sizes (ui-engineer rules).
 * Mockups: docs/design/spec/*.dc.html.
 */

export const colors = {
  night: '#131830',
  night2: '#1C2344',
  gold: '#E9C46A',
  goldDeep: '#C99A35',
  cream: '#F3EAD7',
  muted: '#98A1C6',
  ok: '#7ED99E',
  bad: '#E85D5D',
} as const;

/** Block palette — deuteranopia-checked (PRD §15); obstacles differ by SHAPE too. */
export const blockColors = {
  coral: '#E76F51',
  teal: '#2A9D8F',
  gold: '#E9C46A',
  violet: '#8E7CC3',
  amber: '#F4A261',
  sky: '#57A0E5',
  rose: '#D46A9E',
} as const;

/** Type scale — PRD §15: 12/14/16/20/26/34. */
export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 34,
} as const;

export const fontFamily = {
  /** Playfair Display — titles/chapters. Loaded with the design system in Stage 1. */
  display: 'serif',
  /** Nunito — UI. */
  body: 'System',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  block: 6,
  card: 12,
  sheet: 20,
} as const;
