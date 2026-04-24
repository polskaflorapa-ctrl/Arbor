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

/** Kolory ról — zgodne z web/src/theme.js getRolaColor (Platinum Chrome). */
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

/** Wspólne tokeny „Platinum Chrome” (web: ThemeContext dark/green). */
const PLATINUM_CHROME_OMIT_NAME = {
  bg: '#030303',
  surface: '#0f0f0f',
  surface2: '#141414',
  surface3: '#1a1a1a',
  border: 'rgba(255,255,255,0.1)',
  text: '#f4f4f5',
  textSub: '#c4c4cc',
  textMuted: '#8b8b96',
  accent: '#e8e8ed',
  accentDark: '#a1a1aa',
  accentLight: 'rgba(255,255,255,0.1)',
  accentText: '#0a0a0a',
  success: '#34d399',
  successBg: 'rgba(52,211,153,0.14)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.12)',
  danger: '#f87171',
  dangerBg: 'rgba(248,113,113,0.12)',
  info: '#38bdf8',
  infoBg: 'rgba(56,189,248,0.12)',
  headerBg: '#050505',
  headerText: '#f4f4f5',
  headerSub: '#8b8b96',
  navBg: '#050505',
  navActive: '#e8e8ed',
  navInactive: '#8b8b96',
  navBorder: 'rgba(255,255,255,0.08)',
  cardBg: '#0f0f0f',
  cardBorder: 'rgba(255,255,255,0.1)',
  inputBg: '#121212',
  inputBorder: 'rgba(255,255,255,0.14)',
  inputText: '#f4f4f5',
  inputPlaceholder: '#8b8b96',
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
  shadowOpacity: 0.55,
  shadowRadius: 20,
  shadowOffsetY: 8,
  cardElevation: 6,
  chartSecondary: '#94a3b8',
  chartCyan: '#22d3ee',
} as const satisfies Omit<Theme, 'name'>;

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    ...PLATINUM_CHROME_OMIT_NAME,
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
    ...PLATINUM_CHROME_OMIT_NAME,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: 'Ciemny (Platinum)',
  light: 'Jasny',
  green: 'Platinum Chrome',
};
