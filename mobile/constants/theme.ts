export type ThemeName = 'dark' | 'light' | 'green';

export interface Theme {
  name: ThemeName;
  // Tła
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  // Obramowania
  border: string;
  // Teksty
  text: string;
  textSub: string;
  textMuted: string;
  // Akcent
  accent: string;
  accentDark: string;
  accentLight: string;
  accentText: string;
  // Statusy
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  // Header
  headerBg: string;
  headerText: string;
  headerSub: string;
  // Nawigacja
  navBg: string;
  navActive: string;
  navInactive: string;
  navBorder: string;
  // Karty
  cardBg: string;
  cardBorder: string;
  // Input
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  // Układ i typografia (wspólne)
  radiusXs: number;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  radiusXl: number;
  fontScreenTitle: number;
  fontSection: number;
  fontBody: number;
  fontCaption: number;
  fontMicro: number;
  // Cień kart (React Native)
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetY: number;
  cardElevation: number;
  /** Drugi akcent (wykresy, odznaki) — neutralny slate */
  chartSecondary: string;
  chartCyan: string;
}

/** Kolory ról — zgodne z web/src/theme.js getRolaColor. */
export function getRolaColor(rola: string): string {
  const map: Record<string, string> = {
    Dyrektor: '#f59e0b',
    Administrator: '#fbbf24',
    Kierownik: '#38bdf8',
    Brygadzista: '#34d399',
    Specjalista: '#22d3ee',
    'Wyceniający': '#94a3b8',
    Pomocnik: '#94a3b8',
    'Pomocnik bez doświadczenia': '#64748b',
    Magazynier: '#fb923c',
  };
  return map[rola] || '#94a3b8';
}

/** Ciemny motyw Arbor — spójny z web/src/index.css (:root / theme-dark / theme-green). */
const ARBOR_DARK_OMIT_NAME = {
  bg: '#060908',
  surface: '#0f1512',
  surface2: '#141b17',
  surface3: '#1a221e',
  border: 'rgba(255,255,255,0.09)',
  text: '#eef7f1',
  textSub: '#c0cdc6',
  textMuted: '#8a9b90',
  accent: '#5eea9f',
  accentDark: '#34d399',
  accentLight: 'rgba(94,234,159,0.14)',
  accentText: '#03140c',
  success: '#34d399',
  successBg: 'rgba(52,211,153,0.14)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.12)',
  danger: '#f87171',
  dangerBg: 'rgba(248,113,113,0.12)',
  info: '#38bdf8',
  infoBg: 'rgba(56,189,248,0.12)',
  headerBg: '#070b09',
  headerText: '#eef7f1',
  headerSub: '#8a9b90',
  navBg: '#070b09',
  navActive: '#5eea9f',
  navInactive: '#8a9b90',
  navBorder: 'rgba(255,255,255,0.09)',
  cardBg: '#0f1512',
  cardBorder: 'rgba(94,234,159,0.15)',
  inputBg: '#0d1210',
  inputBorder: 'rgba(94,234,159,0.2)',
  inputText: '#eef7f1',
  inputPlaceholder: '#8a9b90',
  radiusXs: 6,
  radiusSm: 10,
  radiusMd: 14,
  radiusLg: 18,
  radiusXl: 22,
  fontScreenTitle: 22,
  fontSection: 16,
  fontBody: 15,
  fontCaption: 12,
  fontMicro: 11,
  shadowColor: '#000000',
  shadowOpacity: 0.58,
  shadowRadius: 22,
  shadowOffsetY: 10,
  cardElevation: 6,
  chartSecondary: '#94a3b8',
  chartCyan: '#22d3ee',
} as const satisfies Omit<Theme, 'name'>;

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    ...ARBOR_DARK_OMIT_NAME,
  },

  light: {
    name: 'light',
    bg: '#eef2f6',
    surface: '#ffffff',
    surface2: '#f4f6f8',
    surface3: '#e8ecf0',
    border: 'rgba(15,23,42,0.1)',
    text: '#0f172a',
    textSub: '#475569',
    textMuted: '#64748b',
    accent: '#059669',
    accentDark: '#047857',
    accentLight: '#d1fae5',
    accentText: '#ffffff',
    success: '#059669',
    successBg: '#d1fae5',
    warning: '#d97706',
    warningBg: '#fef3c7',
    danger: '#dc2626',
    dangerBg: '#fee2e2',
    info: '#2563eb',
    infoBg: '#dbeafe',
    headerBg: '#ffffff',
    headerText: '#0f172a',
    headerSub: '#64748b',
    navBg: '#ffffff',
    navActive: '#059669',
    navInactive: '#94a3b8',
    navBorder: '#e2e8f0',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    inputBg: '#f8fafc',
    inputBorder: '#d8dee6',
    inputText: '#0f172a',
    inputPlaceholder: '#94a3b8',
    radiusXs: 6,
    radiusSm: 8,
    radiusMd: 12,
    radiusLg: 14,
    radiusXl: 18,
    fontScreenTitle: 22,
    fontSection: 16,
    fontBody: 15,
    fontCaption: 12,
    fontMicro: 11,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffsetY: 2,
    cardElevation: 2,
    chartSecondary: '#64748b',
    chartCyan: '#0891b2',
  },

  green: {
    name: 'green',
    ...ARBOR_DARK_OMIT_NAME,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: 'Arbor (ciemny)',
  light: 'Jasny',
  green: 'Arbor (akcent)',
};
