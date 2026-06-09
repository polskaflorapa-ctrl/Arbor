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
  radiusXs: 4,
  radiusSm: 6,
  radiusMd: 7,
  radiusLg: 8,
  radiusXl: 9,
  fontScreenTitle: 22,
  fontSection: 16,
  fontBody: 15,
  fontCaption: 12,
  fontMicro: 11,
} as const;

// Wspólny kształt (promienie + cienie) dla obu motywów — większe, miękkie karty.
const PLATINUM_SHAPE = {
  ...SHAPE,
  radiusSm: 6,
  radiusMd: 7,
  radiusLg: 8,
  radiusXl: 9,
} as const;

/**
 * Wariant C — Emerald Aurora (ciemny).
 * Głęboka zieleń z emerald-akcentem; chrome (header + nav) prawie czarno-zielony.
 */
const DARK_AURORA = {
  bg: '#050B09',
  surface: '#0A1411',
  surface2: '#101C18',
  surface3: '#162820',
  border: 'rgba(154,183,169,0.18)',
  text: '#F7FFF9',
  textSub: '#C7D8CF',
  textMuted: '#8FA59A',
  accent: '#2EAF68',
  accentDark: '#1F7E4A',
  accentLight: '#082A1A',
  accentText: '#FFFFFF',
  success: '#45B36D',
  successBg: '#082819',
  warning: '#D99A32',
  warningBg: '#2A210F',
  danger: '#FF6B5F',
  dangerBg: '#2A1110',
  info: '#319EC1',
  infoBg: '#071F28',
  headerBg: '#07100D',
  headerText: '#F7FFF9',
  headerSub: '#8FA59A',
  navBg: '#07100D',
  navActive: '#2EAF68',
  navInactive: '#8FA59A',
  navBorder: 'rgba(154,183,169,0.16)',
  cardBg: '#0B1612',
  cardBorder: 'rgba(154,183,169,0.17)',
  inputBg: '#07100D',
  inputBorder: 'rgba(154,183,169,0.24)',
  inputText: '#F7FFF9',
  inputPlaceholder: '#8FA59A',
  ...PLATINUM_SHAPE,
  shadowColor: '#000000',
  shadowOpacity: 0.34,
  shadowRadius: 22,
  shadowOffsetY: 8,
  cardElevation: 5,
  chartSecondary: '#41C8FF',
  chartCyan: '#319EC1',
} as const satisfies Omit<Theme, 'name'>;

/**
 * Wariant A — Leśny premium (jasny).
 * Jasna treść (biel + leśna zieleń) z ciemnozielonym chrome (header + nav),
 * dzięki czemu status bar 'light-content' pozostaje poprawny w obu motywach.
 */
const LIGHT_LESNY = {
  bg: '#F3F6EF',
  surface: '#FEFFFC',
  surface2: '#EAF0E7',
  surface3: '#DDE8DE',
  border: 'rgba(24,49,38,0.12)',
  text: '#10251B',
  textSub: '#294338',
  textMuted: '#65786D',
  accent: '#0F7A45',
  accentDark: '#095B34',
  accentLight: 'rgba(15,122,69,0.11)',
  accentText: '#FFFFFF',
  success: '#159451',
  successBg: 'rgba(21,148,81,0.11)',
  warning: '#B76B12',
  warningBg: 'rgba(183,107,18,0.12)',
  danger: '#C24135',
  dangerBg: 'rgba(194,65,53,0.11)',
  info: '#1D80A6',
  infoBg: 'rgba(29,128,166,0.11)',
  headerBg: '#FEFFFC',
  headerText: '#10251B',
  headerSub: '#65786D',
  navBg: '#FEFFFC',
  navActive: '#0F7A45',
  navInactive: '#65786D',
  navBorder: 'rgba(24,49,38,0.12)',
  cardBg: '#FEFFFC',
  cardBorder: 'rgba(24,49,38,0.11)',
  inputBg: '#F7FAF5',
  inputBorder: 'rgba(24,49,38,0.15)',
  inputText: '#10251B',
  inputPlaceholder: '#65786D',
  ...PLATINUM_SHAPE,
  shadowColor: '#183126',
  shadowOpacity: 0.07,
  shadowRadius: 11,
  shadowOffsetY: 3,
  cardElevation: 1,
  chartSecondary: '#1D80A6',
  chartCyan: '#0F7A45',
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
  light: 'Jasny - Field Paper',
  dark: 'Ciemny - Night Field Ops',
};
