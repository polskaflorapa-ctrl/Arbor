import { formatStatusMessage } from '../utils/statusMessage';

const PALETTE = {
  success: {
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent-dk)',
    border: '1px solid var(--logo-tint-border)',
  },
  warning: {
    backgroundColor: 'rgba(248, 201, 107, 0.12)',
    color: 'var(--warning)',
    border: '1px solid rgba(248, 201, 107, 0.4)',
  },
  error: {
    backgroundColor: 'rgba(255, 127, 169, 0.12)',
    color: 'var(--danger)',
    border: '1px solid rgba(255, 127, 169, 0.42)',
  },
  neutral: {
    backgroundColor: 'var(--bg-card2)',
    color: 'var(--text-sub)',
    border: '1px solid var(--border2)',
  },
};

/**
 * @param {object} props
 * @param {string|{ tone: string, text: string }|null|undefined} props.message
 * @param {import('react').CSSProperties} [props.style]
 * @param {'success'|'warning'|'error'|'neutral'} [props.tone] — nadpisuje wykryty ton
 */
export default function StatusMessage({ message, style, tone: toneOverride }) {
  const { tone: inferred, text } = formatStatusMessage(message);
  const tone = toneOverride || inferred;
  if (!text) return null;

  const p = PALETTE[tone] || PALETTE.neutral;

  return (
    <div
      style={{
        ...p,
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      {text}
    </div>
  );
}
