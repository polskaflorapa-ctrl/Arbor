import { POLSKA_FLORA_COLORS, ROAD_UA } from './brand';

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
  fontRegular: string;
  fontMedium: string;
  fontBold: string;
  fontExtraBold: string;
  fontBlack: string;
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
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 18,
  radiusXl: 22,
  fontScreenTitle: 24,
  fontSection: 16,
  fontBody: 15,
  fontCaption: 12,
  fontMicro: 11,
  fontRegular: ROAD_UA.regular,
  fontMedium: ROAD_UA.medium,
  fontBold: ROAD_UA.bold,
  fontExtraBold: ROAD_UA.extraBold,
  fontBlack: ROAD_UA.black,
} as const;

// Wspólny kształt (promienie + cienie) dla obu motywów — większe, miękkie karty.
const PLATINUM_SHAPE = {
  ...SHAPE,
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 18,
  radiusXl: 22,
} as const;

/** Ciemny wariant zatwierdzonej identyfikacji Polska Flora. */
const DARK_POLSKA_FLORA = {
  bg: POLSKA_FLORA_COLORS.darkBrown,
  surface: POLSKA_FLORA_COLORS.darkBrown,
  surface2: 'rgba(118,100,64,0.30)',
  surface3: 'rgba(118,100,64,0.46)',
  border: 'rgba(180,194,50,0.24)',
  text: POLSKA_FLORA_COLORS.white,
  textSub: POLSKA_FLORA_COLORS.lightGreen,
  textMuted: 'rgba(255,255,255,0.68)',
  accent: POLSKA_FLORA_COLORS.primaryGreen,
  accentDark: POLSKA_FLORA_COLORS.lightBrown,
  accentLight: 'rgba(180,194,50,0.18)',
  accentText: POLSKA_FLORA_COLORS.darkBrown,
  success: POLSKA_FLORA_COLORS.lightGreen,
  successBg: 'rgba(180,194,50,0.16)',
  warning: POLSKA_FLORA_COLORS.white,
  warningBg: 'rgba(189,112,30,0.16)',
  danger: POLSKA_FLORA_COLORS.white,
  dangerBg: 'rgba(189,112,30,0.24)',
  info: POLSKA_FLORA_COLORS.lightGreen,
  infoBg: 'rgba(180,194,50,0.14)',
  headerBg: POLSKA_FLORA_COLORS.darkBrown,
  headerText: POLSKA_FLORA_COLORS.white,
  headerSub: POLSKA_FLORA_COLORS.lightGreen,
  navBg: POLSKA_FLORA_COLORS.darkBrown,
  navActive: POLSKA_FLORA_COLORS.lightGreen,
  navInactive: 'rgba(255,255,255,0.68)',
  navBorder: 'rgba(180,194,50,0.22)',
  cardBg: POLSKA_FLORA_COLORS.darkBrown,
  cardBorder: 'rgba(180,194,50,0.20)',
  inputBg: 'rgba(255,255,255,0.06)',
  inputBorder: 'rgba(180,194,50,0.28)',
  inputText: POLSKA_FLORA_COLORS.white,
  inputPlaceholder: 'rgba(255,255,255,0.62)',
  ...PLATINUM_SHAPE,
  shadowColor: '#000000',
  shadowOpacity: 0.28,
  shadowRadius: 18,
  shadowOffsetY: 8,
  cardElevation: 5,
  chartSecondary: POLSKA_FLORA_COLORS.orangeBrown,
  chartCyan: POLSKA_FLORA_COLORS.lightGreen,
} as const satisfies Omit<Theme, 'name'>;

/**
 * Jasny wariant 1:1 z prototypem mobilki Polska Flora
 * (platform/public/prototypes/arbor-mobile.html) — dokładne hexy prototypu:
 * krem #faf8f1, karty #fff z linią #ece6d7, atrament #2c2011, ciemny nagłówek
 * #2a1d0f z tekstem #efe9da, statusy: #456b1f/#e4efd6, #995510/#fae7d2,
 * #a3402a/#f6e0d9, #5d6a0b/#f1f3d6.
 */
const LIGHT_POLSKA_FLORA = {
  bg: '#faf8f1',
  surface: '#ffffff',
  surface2: '#faf8f1',
  surface3: '#f1f3d6',
  border: '#ece6d7',
  text: '#2c2011',
  textSub: '#5a5040',
  textMuted: '#8a8069',
  accent: POLSKA_FLORA_COLORS.primaryGreen,
  accentDark: '#7f8c12',
  accentLight: '#f1f3d6',
  accentText: '#23260a',
  success: '#456b1f',
  successBg: '#e4efd6',
  warning: '#995510',
  warningBg: '#fae7d2',
  danger: '#a3402a',
  dangerBg: '#f6e0d9',
  info: '#5d6a0b',
  infoBg: '#f1f3d6',
  headerBg: '#2a1d0f',
  headerText: '#efe9da',
  headerSub: POLSKA_FLORA_COLORS.primaryGreen,
  navBg: '#ffffff',
  navActive: '#5d6a0b',
  navInactive: '#8a8069',
  navBorder: '#ece6d7',
  cardBg: '#ffffff',
  cardBorder: '#ece6d7',
  inputBg: '#faf8f1',
  inputBorder: '#e0d9c8',
  inputText: '#2c2011',
  inputPlaceholder: '#9a907a',
  ...PLATINUM_SHAPE,
  shadowColor: POLSKA_FLORA_COLORS.darkBrown,
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffsetY: 5,
  cardElevation: 1,
  chartSecondary: POLSKA_FLORA_COLORS.orangeBrown,
  chartCyan: POLSKA_FLORA_COLORS.lightGreen,
} as const satisfies Omit<Theme, 'name'>;

/**
 * Role colors shared by badges, profile cards and employee lists.
 * CANONICAL SOURCE — must stay in sync with web/src/theme.js getRolaColor().
 * Covers all 14 employee roles + spelling/diacritic variants.
 */
export const ROLA_COLORS: Record<string, string> = {
  Prezes: POLSKA_FLORA_COLORS.darkBrown,
  Dyrektor: POLSKA_FLORA_COLORS.orangeBrown,
  'Dyrektor Sprzedazy': POLSKA_FLORA_COLORS.orangeBrown,
  'Dyrektor Sprzedaży': POLSKA_FLORA_COLORS.orangeBrown,
  'Dyrektor dzialu sprzedaz': POLSKA_FLORA_COLORS.orangeBrown,
  'Dyrektor działu sprzedaż': POLSKA_FLORA_COLORS.orangeBrown,
  Administrator: POLSKA_FLORA_COLORS.lightBrown,
  Kierownik: POLSKA_FLORA_COLORS.lightBrown,
  Dyspozytor: POLSKA_FLORA_COLORS.lightGreen,
  Brygadzista: POLSKA_FLORA_COLORS.primaryGreen,
  Specjalista: POLSKA_FLORA_COLORS.lightGreen,
  'Wyceniający': POLSKA_FLORA_COLORS.orangeBrown,
  Wyceniajacy: POLSKA_FLORA_COLORS.orangeBrown,
  Handlowiec: POLSKA_FLORA_COLORS.orangeBrown,
  'Pracownik biurowy': POLSKA_FLORA_COLORS.lightBrown,
  Pomocnik: POLSKA_FLORA_COLORS.lightBrown,
  'Pomocnik bez doświadczenia': POLSKA_FLORA_COLORS.lightBrown,
  Magazynier: POLSKA_FLORA_COLORS.orangeBrown,
};

export function getRolaColor(rola: string): string {
  return ROLA_COLORS[rola] || POLSKA_FLORA_COLORS.lightBrown;
}

export const themes: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    ...LIGHT_POLSKA_FLORA,
  },
  dark: {
    name: 'dark',
    ...DARK_POLSKA_FLORA,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Polska Flora - Paper',
  dark: 'Polska Flora - Brown',
};
