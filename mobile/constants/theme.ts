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

/** Jasny wariant zatwierdzonej identyfikacji Polska Flora. */
const LIGHT_POLSKA_FLORA = {
  bg: POLSKA_FLORA_COLORS.white,
  surface: POLSKA_FLORA_COLORS.white,
  surface2: 'rgba(118,100,64,0.07)',
  surface3: 'rgba(180,194,50,0.13)',
  border: 'rgba(118,100,64,0.24)',
  text: POLSKA_FLORA_COLORS.darkBrown,
  textSub: POLSKA_FLORA_COLORS.lightBrown,
  textMuted: 'rgba(59,42,24,0.66)',
  accent: POLSKA_FLORA_COLORS.primaryGreen,
  accentDark: POLSKA_FLORA_COLORS.lightBrown,
  accentLight: 'rgba(180,194,50,0.22)',
  accentText: POLSKA_FLORA_COLORS.darkBrown,
  success: POLSKA_FLORA_COLORS.darkBrown,
  successBg: 'rgba(180,194,50,0.24)',
  warning: POLSKA_FLORA_COLORS.lightBrown,
  warningBg: 'rgba(189,112,30,0.16)',
  danger: POLSKA_FLORA_COLORS.darkBrown,
  dangerBg: 'rgba(189,112,30,0.24)',
  info: POLSKA_FLORA_COLORS.lightBrown,
  infoBg: 'rgba(180,194,50,0.18)',
  headerBg: POLSKA_FLORA_COLORS.white,
  headerText: POLSKA_FLORA_COLORS.darkBrown,
  headerSub: POLSKA_FLORA_COLORS.lightBrown,
  navBg: POLSKA_FLORA_COLORS.white,
  navActive: POLSKA_FLORA_COLORS.darkBrown,
  navInactive: 'rgba(59,42,24,0.62)',
  navBorder: 'rgba(118,100,64,0.24)',
  cardBg: POLSKA_FLORA_COLORS.white,
  cardBorder: 'rgba(118,100,64,0.22)',
  inputBg: 'rgba(118,100,64,0.05)',
  inputBorder: 'rgba(118,100,64,0.28)',
  inputText: POLSKA_FLORA_COLORS.darkBrown,
  inputPlaceholder: 'rgba(59,42,24,0.54)',
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
