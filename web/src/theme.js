// ARBOR-OS — ciemny motyw: głębokie zielenie + akcent szmaragd (spójne z index.css)
export const COLORS = {
  bg:          '#07100c',
  bgCard:      '#101b13',
  bgCard2:     '#142219',
  bgAlt:       '#050906',
  sidebar:     '#06110b',

  accent:      '#9bd957',
  accentDark:  '#5fa832',
  accentLight: '#c7f08d',
  accentBg:    'rgba(155,217,87,0.12)',

  text:        '#f1f8ee',
  textSub:     '#cbd8c4',
  textMuted:   '#91a38d',
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
  borderLight: 'rgba(155,217,87,0.28)',
  shadow:      'rgba(0,0,0,0.72)',

  primary:        '#9bd957',
  primaryDark:    '#5fa832',
  primaryLight:   '#c7f08d',
  primaryVeryLight:'rgba(155,217,87,0.12)',
  primaryBorder:  'rgba(155,217,87,0.28)',
  secondary:      '#06110b',
};

export const SHADOWS = {
  sm: '0 1px 0 rgba(255,255,255,0.05) inset, 0 4px 24px rgba(0,0,0,0.5)',
  md: '0 10px 36px rgba(0,0,0,0.58)',
  lg: '0 24px 64px rgba(0,0,0,0.75)',
};

export const getRolaColor = (rola) => {
  const map = {
    'Prezes':                      '#eab308',
    'Dyrektor':                    '#f59e0b',
    'Dyrektor Sprzedazy':           '#fb7185',
    'Dyrektor Sprzedaży':           '#fb7185',
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
  { value: 'Prezes',                     label: 'Prezes',                     poziom: 11 },
  { value: 'Dyrektor',                   label: 'Dyrektor',                   poziom: 10 },
  { value: 'Dyrektor Sprzedaży',          label: 'Dyrektor sprzedaży',          poziom: 8  },
  { value: 'Administrator',              label: 'Administrator',              poziom: 9  },
  { value: 'Kierownik',                  label: 'Kierownik',                  poziom: 5  },
  { value: 'Brygadzista',               label: 'Brygadzista',               poziom: 3  },
  { value: 'Specjalista',               label: 'Specjalista',               poziom: 3  },
  { value: 'Wyceniający',               label: 'Wyceniający',               poziom: 2  },
  { value: 'Pomocnik',                  label: 'Pomocnik',                  poziom: 1  },
  { value: 'Pomocnik bez doświadczenia', label: 'Pomocnik bez doświadczenia', poziom: 1  },
  { value: 'Magazynier',                label: 'Magazynier',                poziom: 2  },
];
