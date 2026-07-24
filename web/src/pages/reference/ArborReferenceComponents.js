import './arbor-reference-pages.css';

export const logoPath =
  'M356.69 402.64l-39.89 0 0 -64.68 114.04 -65.02 0 -45.49 -114.04 65.02 0 -45.49 114.04 -65.02 0 -181.96 -153.68 87.62 0 91.28 -114.05 -65.02 0 181.96 114.05 65.02 0 41.78 -74.42 0 0 39.63 267.73 0 0 -127.24 -36.78 -20.97 -39.9 22.74 37.04 21.12 0 64.72 -34.52 0 0 -38.57 -39.63 0 0 38.57zm-39.89 -201.15l0 -90.98 74.41 -42.43 0 90.98 -74.41 42.43zm-39.63 22.89l0 90.98 -74.42 -42.43 0 -90.98 74.42 42.43z';

export function ArborLogo({ sub = 'Arbor OS', compact = false }) {
  return (
    <div className={`ref-logo ${compact ? 'is-compact' : ''}`}>
      <span className="ref-logo-mark" aria-hidden="true">
        <svg viewBox="155 -8 323 458" focusable="false">
          <path d={logoPath} />
        </svg>
      </span>
      {!compact ? (
        <span className="ref-logo-copy">
          <strong>POLSKA FLORA</strong>
          <small>{sub}</small>
        </span>
      ) : null}
    </div>
  );
}

export function Icon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    clipboard: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2.5h6V4M9 10h6M9 14h4" />
      </>
    ),
    map: (
      <>
        <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" />
        <path d="M9 3v16M15 5v16" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </>
    ),
    user: (
      <>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </>
    ),
    phone: <path d="M4 5l3-1 2 4-2 1a11 11 0 0 0 5 5l1-2 4 2-1 3a2 2 0 0 1-2 1A15 15 0 0 1 3 7a2 2 0 0 1 1-2Z" />,
    file: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
      </>
    ),
    check: <path d="M5 12l5 5L20 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V5" />
        <path d="M8 17v-6M13 17V8M18 17v-3" />
      </>
    ),
    camera: (
      <>
        <path d="M4 8h4l2-3h4l2 3h4v11H4Z" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
  };

  return (
    <svg className="ref-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {paths[name] || paths.grid}
    </svg>
  );
}

export function StatusPill({ children, tone = 'olive' }) {
  return <span className={`ref-pill tone-${tone}`}>{children}</span>;
}

export function ProgressBar({ value = 68 }) {
  return (
    <span className="ref-progress" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function RefCard({ title, children, className = '' }) {
  return (
    <section className={`ref-card ${className}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function RefSidebar({ active = 'Pulpit' }) {
  const items = [
    ['Pulpit', 'grid'],
    ['Zlecenia', 'clipboard', '12'],
    ['Mapa', 'map'],
    ['Grafik', 'calendar'],
    ['Klienci', 'user'],
    ['Raporty', 'chart'],
  ];
  return (
    <aside className="ref-sidebar">
      <ArborLogo />
      <nav>
        {items.map(([label, icon, badge]) => (
          <button key={label} className={label === active ? 'is-active' : ''} type="button">
            <Icon name={icon} />
            <span>{label}</span>
            {badge ? <b>{badge}</b> : null}
          </button>
        ))}
      </nav>
      <div className="ref-sidebar-foot">
        <small>System</small>
        <strong>Online</strong>
      </div>
    </aside>
  );
}

export function Money({ children }) {
  return <span className="ref-money">{children}</span>;
}
