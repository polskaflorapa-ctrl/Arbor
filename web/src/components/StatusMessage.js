import { formatStatusMessage } from '../utils/statusMessage';

const PALETTE = {
  success: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  warning: {
    backgroundColor: '#451A03',
    color: '#FCD34D',
    borderColor: '#F59E0B',
  },
  error: {
    backgroundColor: '#4B1515',
    color: '#FCA5A5',
    borderColor: '#EF5350',
  },
  neutral: {
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    borderColor: 'var(--border)',
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
        borderWidth: 1,
        borderStyle: 'solid',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 13,
        fontWeight: 600,
        ...style,
      }}
    >
      {text}
    </div>
  );
}
