// ARBOR-OS — paleta Platinum Chrome (głęboka czerń, akcent metalowy — bez fioletu)
export const COLORS = {
  bg:          '#030303',
  bgCard:      '#0f0f0f',
  bgCard2:     '#141414',
  bgAlt:       '#080808',
  sidebar:     '#050505',

  accent:      '#e8e8ed',
  accentDark:  '#a1a1aa',
  accentLight: '#fafafa',
  accentBg:    'rgba(255,255,255,0.08)',

  text:        '#f4f4f5',
  textSub:     '#c4c4cc',
  textMuted:   '#8b8b96',
  white:       '#FFFFFF',

  success:     '#34d399',
  successBg:   'rgba(52,211,153,0.12)',
  warning:     '#fbbf24',
  warningBg:   'rgba(251,191,36,0.12)',
  danger:      '#f87171',
  dangerBg:    'rgba(248,113,113,0.12)',
  info:        '#38bdf8',
  infoBg:      'rgba(56,189,248,0.12)',
  purple:      '#a1a1aa',
  purpleBg:    'rgba(161,161,170,0.12)',

  border:      'rgba(255,255,255,0.08)',
  borderLight: 'rgba(255,255,255,0.14)',
  shadow:      'rgba(0,0,0,0.65)',

  primary:        '#e8e8ed',
  primaryDark:    '#a1a1aa',
  primaryLight:   '#fafafa',
  primaryVeryLight:'rgba(255,255,255,0.08)',
  primaryBorder:  'rgba(255,255,255,0.16)',
  secondary:      '#050505',
};

export const SHADOWS = {
  sm: '0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 20px rgba(0,0,0,0.45)',
  md: '0 8px 32px rgba(0,0,0,0.55)',
  lg: '0 24px 64px rgba(0,0,0,0.72)',
};

export const getRolaColor = (rola) => {
  const map = {
    'Dyrektor':                    '#f59e0b',
    'Administrator':               '#fbbf24',
    'Kierownik':                   '#38bdf8',
    'Brygadzista':                 '#34d399',
    'Specjalista':                 '#22d3ee',
    'Wyceniający':                 '#94a3b8',
    'Pomocnik':                    '#94a3b8',
    'Pomocnik bez doświadczenia':  '#64748b',
    'Magazynier':                  '#fb923c',
  };
  return map[rola] || '#94a3b8';
};

// Wszystkie dostępne role (do dropdownów)
export const WSZYSTKIE_ROLE = [
  { value: 'Dyrektor',                   label: 'Dyrektor',                   poziom: 10 },
  { value: 'Administrator',              label: 'Administrator',              poziom: 9  },
  { value: 'Kierownik',                  label: 'Kierownik',                  poziom: 5  },
  { value: 'Brygadzista',               label: 'Brygadzista',               poziom: 3  },
  { value: 'Specjalista',               label: 'Specjalista',               poziom: 3  },
  { value: 'Wyceniający',               label: 'Wyceniający',               poziom: 2  },
  { value: 'Pomocnik',                  label: 'Pomocnik',                  poziom: 1  },
  { value: 'Pomocnik bez doświadczenia', label: 'Pomocnik bez doświadczenia', poziom: 1  },
  { value: 'Magazynier',                label: 'Magazynier',                poziom: 2  },
];
