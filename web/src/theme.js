// ARBOR-OS — ciemny motyw: głębokie zielenie + akcent szmaragd (spójne z index.css)
export const COLORS = {
  bg:          '#060908',
  bgCard:      '#0f1512',
  bgCard2:     '#141b17',
  bgAlt:       '#080b09',
  sidebar:     '#070b09',

  accent:      '#5eea9f',
  accentDark:  '#34d399',
  accentLight: '#86efac',
  accentBg:    'rgba(94,234,159,0.1)',

  text:        '#eef7f1',
  textSub:     '#c0cdc6',
  textMuted:   '#8a9b90',
  white:       '#FFFFFF',

  success:     '#34d399',
  successBg:   'rgba(52,211,153,0.14)',
  warning:     '#fbbf24',
  warningBg:   'rgba(251,191,36,0.12)',
  danger:      '#f87171',
  dangerBg:    'rgba(248,113,113,0.12)',
  info:        '#38bdf8',
  infoBg:      'rgba(56,189,248,0.12)',
  purple:      '#94a3b8',
  purpleBg:    'rgba(148,163,184,0.12)',

  border:      'rgba(255,255,255,0.09)',
  borderLight: 'rgba(94,234,159,0.22)',
  shadow:      'rgba(0,0,0,0.72)',

  primary:        '#5eea9f',
  primaryDark:    '#34d399',
  primaryLight:   '#86efac',
  primaryVeryLight:'rgba(94,234,159,0.1)',
  primaryBorder:  'rgba(94,234,159,0.22)',
  secondary:      '#070b09',
};

export const SHADOWS = {
  sm: '0 1px 0 rgba(255,255,255,0.05) inset, 0 4px 24px rgba(0,0,0,0.5)',
  md: '0 10px 36px rgba(0,0,0,0.58)',
  lg: '0 24px 64px rgba(0,0,0,0.75)',
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
