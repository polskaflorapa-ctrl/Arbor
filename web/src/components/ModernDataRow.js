import TelemetryStatus from './TelemetryStatus';

function DefaultActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h4l2.5-6 4 12 2.5-6h3" />
    </svg>
  );
}

function toneClass(tone) {
  if (tone === 'success') return 'modern-data-row--success';
  if (tone === 'warning') return 'modern-data-row--warning';
  if (tone === 'danger') return 'modern-data-row--danger';
  return 'modern-data-row--info';
}

export function ModernMetric({ label, value, tone, mono = true }) {
  const renderedValue = value === null || value === undefined || value === '' ? '-' : value;
  return (
    <div className="modern-data-row__metric">
      <span className="modern-data-row__metric-label">{label}</span>
      <span className={`modern-data-row__metric-value ${mono ? 'modern-data-row__metric-value--mono' : ''} ${tone ? `modern-data-row__metric-value--${tone}` : ''}`}>
        {renderedValue}
      </span>
    </div>
  );
}

export function ModernIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function ModernDataRow({
  idLabel = 'System ID',
  idValue,
  title,
  subtitle,
  metrics = [],
  status,
  statusValue,
  statusState,
  actions,
  icon,
  tone = 'info',
  onClick,
  className = '',
}) {
  return (
    <div
      className={`modern-data-row ${toneClass(statusState || tone)} ${onClick ? 'modern-data-row--clickable' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(event);
        }
      }}
    >
      <div className="modern-data-row__identity">
        <div className="modern-data-row__icon">
          {icon || <DefaultActivityIcon />}
        </div>
        <div className="modern-data-row__id-copy">
          <span className="modern-data-row__id-label">{idLabel}</span>
          <span className="modern-data-row__id-value">{idValue || '-'}</span>
          {title ? <span className="modern-data-row__title">{title}</span> : null}
          {subtitle ? <span className="modern-data-row__subtitle">{subtitle}</span> : null}
        </div>
      </div>

      <div className="modern-data-row__metric-grid">
        {metrics.map((metric, index) => (
          <ModernMetric
            key={`${metric.label}-${index}`}
            label={metric.label}
            value={metric.value}
            tone={metric.tone}
            mono={metric.mono}
          />
        ))}
      </div>

      <div className="modern-data-row__right">
        {status || statusValue ? (
          <TelemetryStatus state={statusState} value={statusValue || status} label={status} />
        ) : null}
        {actions ? <div className="modern-data-row__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
