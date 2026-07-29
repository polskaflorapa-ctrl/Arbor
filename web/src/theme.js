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
  bg: '#f0ebdd',
  bgCard: '#ffffff',
  bgCard2: '#f0ebdd',
  bgAlt: '#f0ebdd',
  sidebar: BRAND_COLORS.darkBrown,

  accent: BRAND_COLORS.primaryGreen,
  accentDark: '#5d6a0b',
  accentLight: BRAND_COLORS.lightGreen,
  accentBg: 'rgba(160,175,20,0.12)',

  text: BRAND_COLORS.darkBrown,
  textSub: '#995510',
  textMuted: BRAND_COLORS.lightBrown,
  white: '#FFFFFF',

  success: '#5d6a0b',
  successBg: 'rgba(160,175,20,0.14)',
  warning: '#995510',
  warningBg: 'rgba(189,112,30,0.13)',
  danger: '#c0492f',
  dangerBg: 'rgba(192, 73, 47, 0.09)',
  info: BRAND_COLORS.lightBrown,
  infoBg: 'rgba(118,100,64,0.12)',
  purple: '#5a5040',
  purpleBg: 'rgba(103,93,122,0.1)',

  border: 'rgba(59,42,24,0.14)',
  borderLight: 'rgba(160,175,20,0.28)',
  shadow: 'rgba(59,42,24,0.14)',

  primary: BRAND_COLORS.primaryGreen,
  primaryDark: '#5d6a0b',
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
  'Prezes':                      '#bd701e',
  'Dyrektor':                    '#bd701e',
  'Dyrektor Sprzedazy':           '#c0492f',
  'Dyrektor Sprzedaży':           '#c0492f',
  'Dyrektor dzialu sprzedaz':     '#c0492f',
  'Dyrektor działu sprzedaż':     '#c0492f',
  'Administrator':               '#766440',
  'Kierownik':                   '#766440',
  'Dyspozytor':                  '#f1f3d6',
  'Brygadzista':                 '#7f8c12',
  'Specjalista':                 '#766440',
  'Wyceniający':                 '#995510',
  'Wyceniajacy':                 '#995510',
  'Handlowiec':                  '#f1f3d6',
  'Pracownik biurowy':           '#f1f3d6',
  'Pomocnik':                    '#9a907a',
  'Pomocnik bez doświadczenia':  '#8a8069',
  'Magazynier':                  '#bd701e',
};

export const getRolaColor = (rola) => ROLA_COLORS[rola] || '#8a8069';

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
