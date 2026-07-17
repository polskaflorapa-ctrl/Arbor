import { getRoleDisplayName } from './utils/roleDisplay';

export const BRAND_COLORS = Object.freeze({
  darkBrown: '#3B2A18',
  lightBrown: '#766440',
  primaryGreen: '#A0AF14',
  lightGreen: '#B4C232',
  orangeBrown: '#BD701E',
});

// Polska Flora — semantic aliases backed by the approved brand-book palette.
export const COLORS = {
  bg: '#f7f4ec',
  bgCard: '#ffffff',
  bgCard2: '#fbfaf6',
  bgAlt: '#f1ecdd',
  sidebar: BRAND_COLORS.darkBrown,

  accent: BRAND_COLORS.primaryGreen,
  accentDark: '#88950f',
  accentLight: BRAND_COLORS.lightGreen,
  accentBg: 'rgba(160,175,20,0.12)',

  text: BRAND_COLORS.darkBrown,
  textSub: '#5e4d31',
  textMuted: BRAND_COLORS.lightBrown,
  white: '#FFFFFF',

  success: '#5f6a0b',
  successBg: 'rgba(160,175,20,0.14)',
  warning: '#8b4e0d',
  warningBg: 'rgba(189,112,30,0.13)',
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.09)',
  info: BRAND_COLORS.lightBrown,
  infoBg: 'rgba(118,100,64,0.12)',
  purple: '#675d7a',
  purpleBg: 'rgba(103,93,122,0.1)',

  border: 'rgba(59,42,24,0.14)',
  borderLight: 'rgba(160,175,20,0.28)',
  shadow: 'rgba(59,42,24,0.14)',

  primary: BRAND_COLORS.primaryGreen,
  primaryDark: '#88950f',
  primaryLight: BRAND_COLORS.lightGreen,
  primaryVeryLight: 'rgba(160,175,20,0.12)',
  primaryBorder: 'rgba(160,175,20,0.3)',
  secondary: BRAND_COLORS.darkBrown,
};

export const SHADOWS = {
  sm: '0 12px 32px rgba(59,42,24,0.08)',
  md: '0 18px 44px rgba(59,42,24,0.12)',
  lg: '0 28px 68px rgba(59,42,24,0.16)',
};

// CANONICAL SOURCE — must stay in sync with mobile/constants/theme.ts ROLA_COLORS.
// Covers all 14 employee roles + spelling/diacritic variants.
export const ROLA_COLORS = {
  'Prezes':                      '#FACC15',
  'Dyrektor':                    '#F59E0B',
  'Dyrektor Sprzedazy':           '#FB7185',
  'Dyrektor Sprzedaży':           '#FB7185',
  'Dyrektor dzialu sprzedaz':     '#FB7185',
  'Dyrektor działu sprzedaż':     '#FB7185',
  'Administrator':               '#00E5FF',
  'Kierownik':                   '#38BDF8',
  'Dyspozytor':                  '#A78BFA',
  'Brygadzista':                 '#00E676',
  'Specjalista':                 '#22D3EE',
  'Wyceniający':                 '#B45309',
  'Wyceniajacy':                 '#B45309',
  'Handlowiec':                  '#F472B6',
  'Pracownik biurowy':           '#818CF8',
  'Pomocnik':                    '#94A3B8',
  'Pomocnik bez doświadczenia':  '#64748B',
  'Magazynier':                  '#FF9100',
};

export const getRolaColor = (rola) => ROLA_COLORS[rola] || '#64748B';

// Wszystkie dostępne role (do dropdownów)
export const WSZYSTKIE_ROLE = [
  { value: 'Prezes',                     label: 'Prezes',                     poziom: 11 },
  { value: 'Dyrektor',                   label: 'Dyrektor',                   poziom: 10 },
  { value: 'Dyrektor Sprzedaży',          label: 'Dyrektor sprzedaży',          poziom: 8  },
  { value: 'Administrator',              label: 'Administrator',              poziom: 9  },
  { value: 'Kierownik',                  label: 'Kierownik',                  poziom: 5  },
  { value: 'Brygadzista',               label: 'Brygadzista',               poziom: 3  },
  { value: 'Specjalista',               label: 'Specjalista',               poziom: 3  },
  { value: 'Wyceniający',               label: getRoleDisplayName('Wyceniający'), poziom: 2  },
  { value: 'Pomocnik',                  label: 'Pomocnik',                  poziom: 1  },
  { value: 'Pomocnik bez doświadczenia', label: 'Pomocnik bez doświadczenia', poziom: 1  },
  { value: 'Magazynier',                label: 'Magazynier',                poziom: 2  },
];
