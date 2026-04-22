// ARBOR-OS — paleta zgodna z `index.css` (slate + emerald)
export const COLORS = {
  bg:          '#0a0e14',
  bgCard:      '#121a24',
  bgCard2:     '#1a2330',
  bgAlt:       '#0e1218',
  sidebar:     '#070a0f',

  accent:      '#10b981',
  accentDark:  '#059669',
  accentLight: '#34d399',
  accentBg:    'rgba(16,185,129,0.12)',

  text:        '#e8edf4',
  textSub:     '#94a3b8',
  textMuted:   '#64748b',
  white:       '#FFFFFF',

  success:     '#10b981',
  successBg:   'rgba(16,185,129,0.12)',
  warning:     '#FBBF24',
  warningBg:   'rgba(251,191,36,0.12)',
  danger:      '#F87171',
  dangerBg:    'rgba(248,113,113,0.12)',
  info:        '#60A5FA',
  infoBg:      'rgba(96,165,250,0.12)',
  purple:      '#A78BFA',
  purpleBg:    'rgba(167,139,250,0.12)',

  border:      'rgba(148,163,184,0.14)',
  borderLight: 'rgba(148,163,184,0.22)',
  shadow:      'rgba(0,0,0,0.45)',

  primary:        '#10b981',
  primaryDark:    '#059669',
  primaryLight:   '#34d399',
  primaryVeryLight:'rgba(16,185,129,0.12)',
  primaryBorder:  'rgba(148,163,184,0.2)',
  secondary:      '#070a0f',
};

export const SHADOWS = {
  sm: '0 1px 2px rgba(0,0,0,0.35)',
  md: '0 4px 20px rgba(0,0,0,0.35)',
  lg: '0 16px 48px rgba(0,0,0,0.55)',
};

export const getRolaColor = (rola) => {
  const map = {
    'Dyrektor':                    '#8B5CF6',
    'Administrator':               '#F59E0B',
    'Kierownik':                   '#3B82F6',
    'Brygadzista':                 '#10B981',
    'Specjalista':                 '#06B6D4',
    'Wyceniający':                 '#A78BFA',
    'Pomocnik':                    '#94A3B8',
    'Pomocnik bez doświadczenia':  '#64748B',
    'Magazynier':                  '#F97316',
  };
  return map[rola] || '#10b981';
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

