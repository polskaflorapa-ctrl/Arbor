import { getRoleDisplayName } from './utils/roleDisplay';

// ARBOR-OS — ciemny motyw: głębokie zielenie + akcent szmaragd (spójne z index.css)
export const COLORS = {
  bg: '#f4faf5',
  bgCard: '#ffffff',
  bgCard2: '#f9fdfb',
  bgAlt: '#eef8f1',
  sidebar: '#06331f',

  accent: '#14834f',
  accentDark: '#0f6b3f',
  accentLight: '#28b66c',
  accentBg: 'rgba(20,131,79,0.1)',

  text: '#102218',
  textSub: '#3f5f4b',
  textMuted: '#6a7c70',
  white: '#FFFFFF',

  success: '#14834f',
  successBg: 'rgba(20,131,79,0.1)',
  warning: '#b7791f',
  warningBg: 'rgba(183,121,31,0.11)',
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.09)',
  info: '#177eaa',
  infoBg: 'rgba(23,126,170,0.11)',
  purple: '#5f6faf',
  purpleBg: 'rgba(95,111,175,0.1)',

  border: 'rgba(15,95,58,0.12)',
  borderLight: 'rgba(40,182,108,0.24)',
  shadow: 'rgba(15,95,58,0.13)',

  primary: '#14834f',
  primaryDark: '#0f6b3f',
  primaryLight: '#28b66c',
  primaryVeryLight: 'rgba(20,131,79,0.1)',
  primaryBorder: 'rgba(40,182,108,0.24)',
  secondary: '#06331f',
};

export const SHADOWS = {
  sm: '0 12px 32px rgba(16,34,24,0.08)',
  md: '0 18px 44px rgba(15,95,58,0.12)',
  lg: '0 28px 68px rgba(15,95,58,0.16)',
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
