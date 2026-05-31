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
  radiusSm: 10,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 20,
} as const;

/**
 * Wariant C — Emerald Aurora (ciemny).
 * Głęboka zieleń z emerald-akcentem; chrome (header + nav) prawie czarno-zielony.
 */
const DARK_AURORA = {
  bg: '#04130c',
  surface: '#0c2016',
  surface2: '#0a1b12',
  surface3: '#10261a',
  border: 'rgba(52,232,158,0.14)',
  text: '#EAFFF3',
  textSub: '#A7D8BF',
  textMuted: '#6B9580',
  accent: '#34E89E',
  accentDark: '#0BD9B3',
  accentLight: 'rgba(52,232,158,0.12)',
  accentText: '#04130C',
  success: '#34E89E',
  successBg: 'rgba(52,232,158,0.12)',
  warning: '#FFD479',
  warningBg: 'rgba(255,212,121,0.12)',
  danger: '#FF6B81',
  dangerBg: 'rgba(255,107,129,0.12)',
  info: '#7CC4FF',
  infoBg: 'rgba(124,196,255,0.12)',
  headerBg: '#06140D',
  headerText: '#EAFFF3',
  headerSub: '#6B9580',
  navBg: '#06140D',
  navActive: '#34E89E',
  navInactive: '#6B9580',
  navBorder: 'rgba(52,232,158,0.12)',
  cardBg: '#0c2016',
  cardBorder: 'rgba(52,232,158,0.14)',
  inputBg: '#0a1b12',
  inputBorder: 'rgba(52,232,158,0.18)',
  inputText: '#EAFFF3',
  inputPlaceholder: '#6B9580',
  ...PLATINUM_SHAPE,
  shadowColor: '#000000',
  shadowOpacity: 0.5,
  shadowRadius: 22,
  shadowOffsetY: 9,
  cardElevation: 5,
  chartSecondary: '#0BD9B3',
  chartCyan: '#34E89E',
} as const satisfies Omit<Theme, 'name'>;

/**
 * Wariant A — Leśny premium (jasny).
 * Jasna treść (biel + leśna zieleń) z ciemnozielonym chrome (header + nav),
 * dzięki czemu status bar 'light-content' pozostaje poprawny w obu motywach.
 */
const LIGHT_LESNY = {
  bg: '#f6faf7',
  surface: '#ffffff',
  surface2: '#f9fcfa',
  surface3: '#edf6f0',
  border: 'rgba(15,95,58,0.14)',
  text: '#12251A',
  textSub: '#3E5A48',
  textMuted: '#6E8175',
  accent: '#0F6B3F',
  accentDark: '#0A4F31',
  accentLight: 'rgba(15,107,63,0.10)',
  accentText: '#FFFFFF',
  success: '#12824D',
  successBg: 'rgba(18,130,77,0.10)',
  warning: '#B87514',
  warningBg: 'rgba(184,117,20,0.12)',
  danger: '#C92D39',
  dangerBg: 'rgba(201,45,57,0.10)',
  info: '#126E90',
  infoBg: 'rgba(18,110,144,0.10)',
  headerBg: '#0B3825',
  headerText: '#F6FFF9',
  headerSub: 'rgba(246,255,249,0.70)',
  navBg: '#0B3825',
  navActive: '#2FBE72',
  navInactive: 'rgba(246,255,249,0.60)',
  navBorder: 'rgba(255,255,255,0.10)',
  cardBg: '#ffffff',
  cardBorder: 'rgba(15,95,58,0.14)',
  inputBg: '#ffffff',
  inputBorder: 'rgba(15,95,58,0.18)',
  inputText: '#12251A',
  inputPlaceholder: '#6E8175',
  ...PLATINUM_SHAPE,
  shadowColor: '#1F4F32',
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffsetY: 7,
  cardElevation: 3,
  chartSecondary: '#2FBE72',
  chartCyan: '#0F6B3F',
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
