function normalizeStatus(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '_');
}

export function getTelemetryTone(value) {
  const status = normalizeStatus(value);
  if (
    status.includes('zakoncz') ||
    status.includes('done') ||
    status.includes('success') ||
    status.includes('aktywn') ||
    status.includes('oplacona') ||
    status.includes('opłacona') ||
    status.includes('ok')
  ) return 'success';
  if (
    status.includes('problem') ||
    status.includes('awaria') ||
    status.includes('warning') ||
    status.includes('opozn') ||
    status.includes('piln') ||
    status.includes('wysoki') ||
    status.includes('zaplanow')
  ) return 'warning';
  if (
    status.includes('anul') ||
    status.includes('danger') ||
    status.includes('blad') ||
    status.includes('błąd') ||
    status.includes('kryty') ||
    status.includes('nieoplac') ||
    status.includes('nieopłac') ||
    status.includes('przeterman') ||
    status.includes('przetermino')
  ) return 'danger';
  return 'info';
}

/* Flat coloured chip — like Gemini HTML .m-status */
const CHIP_COLOURS = {
  success: {
    background: 'rgba(20, 131, 79, 0.12)',
    color: '#456b1f',
    border: '1px solid rgba(20, 131, 79, 0.22)',
  },
  warning: {
    background: 'rgba(183, 121, 31, 0.13)',
    color: '#995510',
    border: '1px solid rgba(183, 121, 31, 0.22)',
  },
  danger: {
    background: 'rgba(220, 38, 38, 0.1)',
    color: '#a3402a',
    border: '1px solid rgba(220, 38, 38, 0.2)',
  },
  info: {
    background: 'rgba(23, 126, 170, 0.11)',
    color: '#5d6a0b',
    border: '1px solid rgba(23, 126, 170, 0.2)',
  },
};

const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 24,
  maxWidth: '100%',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 850,
  lineHeight: 1.1,
  letterSpacing: 0,
  whiteSpace: 'nowrap',
};

export default function TelemetryStatus({ state, label, value, style, className = '' }) {
  const tone = state || getTelemetryTone(value || label);
  const text = String(label || value || '').replace(/_/g, ' ');
  const chip = CHIP_COLOURS[tone] || CHIP_COLOURS.info;

  return (
    <span
      className={`m-status m-status--${tone} ${className}`}
      style={{ ...CHIP_BASE, ...chip, ...style }}
    >
      {text.toUpperCase()}
    </span>
  );
}
