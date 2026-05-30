export type ThemeName = 'tech' | 'emerald' | 'pulsar';

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
  // Distinct true-blue accent so "Pulsar Blue" differs from "tech" (cyan).
  accent: '#3B82F6',
  accentDark: '#2563EB',
  accentLight: 'rgba(59,130,246,0.12)',
  navActive: '#3B82F6',
  info: '#3B82F6',
  infoBg: 'rgba(59,130,246,0.1)',
  chartCyan: '#3B82F6',
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
  tech: {
    name: 'tech',
    ...DEEP_SPACE_TECH,
  },
  emerald: {
    name: 'emerald',
    ...DEEP_SPACE_EMERALD,
  },
  pulsar: {
    name: 'pulsar',
    ...DEEP_SPACE_PULSAR,
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  tech: 'Deep Space Tech',
  emerald: 'Laser Emerald',
  pulsar: 'Pulsar Blue',
};
