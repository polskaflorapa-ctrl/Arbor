export type ThemeName = 'light' | 'dark';

export interface Theme {
  name: ThemeName;
  // Backgrounds
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  // Borders
  border: string;
  // Text
  text: string;
  textSub: string;
  textMuted: string;
  // Accent
  accent: string;
  accentDark: string;
  accentLight: string;
  accentText: string;
  // Status
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
  // Navigation
  navBg: string;
  navActive: string;
  navInactive: string;
  navBorder: string;
  // Cards
  cardBg: string;
  cardBorder: string;
  // Inputs
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  // Layout and typography
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
  // Card shadow
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetY: number;
  cardElevation: number;
  chartSecondary: string;
  chartCyan: string;
}

const SHAPE = {
  radiusXs: 6,
  radiusSm: 8,
  radiusMd: 10,
  radiusLg: 14,
  radiusXl: 18,
  fontScreenTitle: 24,
  fontSection: 16,
  fontBody: 15,
  fontCaption: 12,
  fontMicro: 11,
} as const;

// Wspólny kształt (promienie + cienie) dla obu motywów — większe, miękkie karty.
const PLATINUM_SHAPE = {
  ...SHAPE,
  radiusSm: 8,
  radiusMd: 10,
  radiusLg: 12,
  radiusXl: 14,
} as const;

/**
 * Wariant C — Emerald Aurora (ciemny).
 * Głęboka zieleń z emerald-akcentem; chrome (header + nav) prawie czarno-zielony.
 */
const DARK_AURORA = {
  bg: '#0B1120',
  surface: '#111827',
  surface2: '#172033',
  surface3: '#1F2937',
  border: 'rgba(148,163,184,0.18)',
  text: '#F8FAFC',
  textSub: '#CBD5E1',
  textMuted: '#94A3B8',
  accent: '#22C55E',
  accentDark: '#16A34A',
  accentLight: 'rgba(34,197,94,0.13)',
  accentText: '#FFFFFF',
  success: '#22C55E',
  successBg: 'rgba(34,197,94,0.13)',
  warning: '#F59E0B',
  warningBg: 'rgba(245,158,11,0.14)',
  danger: '#EF4444',
  dangerBg: 'rgba(239,68,68,0.13)',
  info: '#38BDF8',
  infoBg: 'rgba(56,189,248,0.13)',
  headerBg: '#0F172A',
  headerText: '#F8FAFC',
  headerSub: '#94A3B8',
  navBg: '#0F172A',
  navActive: '#22C55E',
  navInactive: '#94A3B8',
  navBorder: 'rgba(148,163,184,0.16)',
  cardBg: '#111827',
  cardBorder: 'rgba(148,163,184,0.16)',
  inputBg: '#0F172A',
  inputBorder: 'rgba(148,163,184,0.22)',
  inputText: '#F8FAFC',
  inputPlaceholder: '#94A3B8',
  ...PLATINUM_SHAPE,
  shadowColor: '#000000',
  shadowOpacity: 0.24,
  shadowRadius: 16,
  shadowOffsetY: 6,
  cardElevation: 3,
  chartSecondary: '#38BDF8',
  chartCyan: '#22C55E',
} as const satisfies Omit<Theme, 'name'>;

/**
 * Wariant A — Leśny premium (jasny).
 * Jasna treść (biel + leśna zieleń) z ciemnozielonym chrome (header + nav),
 * dzięki czemu status bar 'light-content' pozostaje poprawny w obu motywach.
 */
const LIGHT_LESNY = {
  bg: '#F6F8FB',
  surface: '#ffffff',
  surface2: '#F8FAFC',
  surface3: '#EEF2F7',
  border: 'rgba(15,23,42,0.10)',
  text: '#111827',
  textSub: '#334155',
  textMuted: '#64748B',
  accent: '#15803D',
  accentDark: '#166534',
  accentLight: 'rgba(21,128,61,0.10)',
  accentText: '#FFFFFF',
  success: '#16A34A',
  successBg: 'rgba(22,163,74,0.10)',
  warning: '#D97706',
  warningBg: 'rgba(217,119,6,0.11)',
  danger: '#DC2626',
  dangerBg: 'rgba(220,38,38,0.10)',
  info: '#0284C7',
  infoBg: 'rgba(2,132,199,0.10)',
  headerBg: '#FFFFFF',
  headerText: '#111827',
  headerSub: '#64748B',
  navBg: '#FFFFFF',
  navActive: '#15803D',
  navInactive: '#64748B',
  navBorder: 'rgba(15,23,42,0.10)',
  cardBg: '#ffffff',
  cardBorder: 'rgba(15,23,42,0.10)',
  inputBg: '#F8FAFC',
  inputBorder: 'rgba(15,23,42,0.12)',
  inputText: '#111827',
  inputPlaceholder: '#64748B',
  ...PLATINUM_SHAPE,
  shadowColor: '#0F172A',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffsetY: 5,
  cardElevation: 2,
  chartSecondary: '#0284C7',
  chartCyan: '#15803D',
} as const satisfies Omit<Theme, 'name'>;

/**
 * Role colors shared by badges, profile cards and employee lists.
 * CANONICAL SOURCE — must stay in sync with web/src/theme.js getRolaColor().
 * Covers all 14 employee roles + spelling/diacritic variants.
 */
export const ROLA_COLORS: Record<string, string> = {
  Prezes: '#FACC15',
  Dyrektor: '#F59E0B',
  'Dyrektor Sprzedazy': '#FB7185',
  'Dyrektor Sprzedaży': '#FB7185',
  'Dyrektor dzialu sprzedaz': '#FB7185',
  'Dyrektor działu sprzedaż': '#FB7185',
  Administrator: '#00E5FF',
  Kierownik: '#38BDF8',
  Dyspozytor: '#A78BFA',
  Brygadzista: '#00E676',
  Specjalista: '#22D3EE',
  'Wyceniający': '#B45309',
  Wyceniajacy: '#B45309',
  Handlowiec: '#F472B6',
  'Pracownik biurowy': '#818CF8',
  Pomocnik: '#94A3B8',
  'Pomocnik bez doświadczenia': '#64748B',
  Magazynier: '#FF9100',
};

export function getRolaColor(rola: string): string {
  return ROLA_COLORS[rola] || '#64748B';
}

export const themes: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    ...LIGHT_LESNY,
  },
  dark: {
    name: 'dark',
    ...DARK_AURORA,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Jasny · Leśny premium',
  dark: 'Ciemny · Emerald aurora',
};
