export type ThemeName = 'dark' | 'light' | 'green';

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

const ARBOR_WHITE_GREEN = {
  bg: '#F4F8F1',
  surface: '#FFFFFF',
  surface2: '#F8FBF6',
  surface3: '#EEF6EA',
  border: '#DCE8D5',
  text: '#102116',
  textSub: '#405243',
  textMuted: '#6E7D71',
  accent: '#166534',
  accentDark: '#0F3F24',
  accentLight: '#DCFCE7',
  accentText: '#FFFFFF',
  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  info: '#0F766E',
  infoBg: '#CCFBF1',
  headerBg: '#FFFFFF',
  headerText: '#102116',
  headerSub: '#637565',
  navBg: '#FFFFFF',
  navActive: '#166534',
  navInactive: '#91A09A',
  navBorder: '#DCE8D5',
  cardBg: '#FFFFFF',
  cardBorder: '#DCE8D5',
  inputBg: '#F8FBF6',
  inputBorder: '#C8D8BF',
  inputText: '#102116',
  inputPlaceholder: '#879486',
  ...SHAPE,
  shadowColor: '#14532D',
  shadowOpacity: 0.1,
  shadowRadius: 14,
  shadowOffsetY: 4,
  cardElevation: 2,
  chartSecondary: '#6B8E23',
  chartCyan: '#0F766E',
} as const satisfies Omit<Theme, 'name'>;

const ARBOR_LIGHT_OFFICE = {
  ...ARBOR_WHITE_GREEN,
  bg: '#F7FAF5',
  surface2: '#FBFDF9',
  surface3: '#F0F7EC',
  border: '#E1EADC',
  textSub: '#455747',
  textMuted: '#728174',
  accent: '#1F7A3A',
  accentDark: '#14532D',
  navActive: '#1F7A3A',
  cardBorder: '#E1EADC',
  inputBorder: '#D3E0CD',
  shadowOpacity: 0.08,
} as const satisfies Omit<Theme, 'name'>;

const ARBOR_FOREST_NIGHT = {
  bg: '#06130C',
  surface: '#0C1F13',
  surface2: '#12301E',
  surface3: '#183A26',
  border: 'rgba(187,247,208,0.15)',
  text: '#F3FAF1',
  textSub: '#CFE7D3',
  textMuted: '#93AA98',
  accent: '#86EFAC',
  accentDark: '#22C55E',
  accentLight: 'rgba(134,239,172,0.18)',
  accentText: '#052E16',
  success: '#86EFAC',
  successBg: 'rgba(34,197,94,0.16)',
  warning: '#FBBF24',
  warningBg: 'rgba(251,191,36,0.15)',
  danger: '#F87171',
  dangerBg: 'rgba(248,113,113,0.14)',
  info: '#5EEAD4',
  infoBg: 'rgba(94,234,212,0.13)',
  headerBg: '#06130C',
  headerText: '#F3FAF1',
  headerSub: '#A7BEAA',
  navBg: '#08180F',
  navActive: '#86EFAC',
  navInactive: '#78907D',
  navBorder: 'rgba(187,247,208,0.15)',
  cardBg: '#0C1F13',
  cardBorder: 'rgba(187,247,208,0.15)',
  inputBg: '#0A1A10',
  inputBorder: 'rgba(187,247,208,0.2)',
  inputText: '#F3FAF1',
  inputPlaceholder: '#849889',
  ...SHAPE,
  shadowColor: '#000000',
  shadowOpacity: 0.28,
  shadowRadius: 16,
  shadowOffsetY: 5,
  cardElevation: 3,
  chartSecondary: '#A3E635',
  chartCyan: '#5EEAD4',
} as const satisfies Omit<Theme, 'name'>;

const DEEP_SPACE_TECH = {
  bg: '#060913',
  surface: 'rgba(18,24,41,0.92)',
  surface2: 'rgba(13,18,30,0.88)',
  surface3: '#121829',
  border: 'rgba(255,255,255,0.05)',
  text: '#F1F5F9',
  textSub: '#CBD5E1',
  textMuted: '#64748B',
  accent: '#00E5FF',
  accentDark: '#00A6D6',
  accentLight: 'rgba(0,229,255,0.12)',
  accentText: '#060913',
  success: '#00E676',
  successBg: 'rgba(0,230,118,0.1)',
  warning: '#FF9100',
  warningBg: 'rgba(255,145,0,0.1)',
  danger: '#FF3D71',
  dangerBg: 'rgba(255,61,113,0.1)',
  info: '#00E5FF',
  infoBg: 'rgba(0,229,255,0.1)',
  headerBg: '#060913',
  headerText: '#F1F5F9',
  headerSub: '#64748B',
  navBg: '#060913',
  navActive: '#00E5FF',
  navInactive: '#64748B',
  navBorder: 'rgba(255,255,255,0.05)',
  cardBg: 'rgba(18,24,41,0.92)',
  cardBorder: 'rgba(255,255,255,0.05)',
  inputBg: 'rgba(13,18,30,0.8)',
  inputBorder: 'rgba(255,255,255,0.05)',
  inputText: '#F1F5F9',
  inputPlaceholder: '#64748B',
  ...SHAPE,
  radiusSm: 10,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 20,
  shadowColor: '#000000',
  shadowOpacity: 0.42,
  shadowRadius: 22,
  shadowOffsetY: 9,
  cardElevation: 5,
  chartSecondary: '#00E676',
  chartCyan: '#00E5FF',
} as const satisfies Omit<Theme, 'name'>;

const DEEP_SPACE_EMERALD = {
  ...DEEP_SPACE_TECH,
  accent: '#00E676',
  accentDark: '#00A86B',
  accentLight: 'rgba(0,230,118,0.12)',
  navActive: '#00E676',
} as const satisfies Omit<Theme, 'name'>;

const DEEP_SPACE_PULSAR = {
  ...DEEP_SPACE_TECH,
  accent: '#00E5FF',
  accentDark: '#00A6D6',
  accentLight: 'rgba(0,229,255,0.12)',
  navActive: '#00E5FF',
} as const satisfies Omit<Theme, 'name'>;

/** Role colors shared by badges, profile cards and employee lists. */
export function getRolaColor(rola: string): string {
  const map: Record<string, string> = {
    Dyrektor: '#00E676',
    Administrator: '#00E5FF',
    Kierownik: '#00E5FF',
    Brygadzista: '#00E676',
    Specjalista: '#22D3EE',
    'Wyceniający': '#B45309',
    Pomocnik: '#64748B',
    'Pomocnik bez doświadczenia': '#7A847B',
    Magazynier: '#FF9100',
  };
  return map[rola] || '#64748B';
}

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    ...DEEP_SPACE_TECH,
  },
  light: {
    name: 'light',
    ...DEEP_SPACE_EMERALD,
  },
  green: {
    name: 'green',
    ...DEEP_SPACE_PULSAR,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: 'Deep Space Tech',
  light: 'Laser Emerald',
  green: 'Pulsar Blue',
};
