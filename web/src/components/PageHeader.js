import ChevronLeft from '@mui/icons-material/ChevronLeft';

/**
 * Spójny nagłówek widoku (tytuł + opcjonalnie podtytuł, ikona, akcje, wstecz).
 *
 * @param {object} props
 * @param {'plain'|'hero'} [props.variant]
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {import('react').ReactNode} [props.icon] — np. ikona MUI w kolorze dziedziczonym
 * @param {import('react').ReactNode} [props.actions]
 * @param {{ onClick: () => void, label?: string, ariaLabel?: string }} [props.back]
 */
export default function PageHeader({ variant = 'plain', title, subtitle, icon, actions, back }) {
  const isHero = variant === 'hero';

  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: isHero ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
        ...(isHero
          ? {
              padding: '24px 28px',
              borderRadius: 20,
              background: 'linear-gradient(135deg, var(--sidebar) 0%, var(--bg-deep) 52%, var(--bg-card) 100%)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--border2)',
              boxShadow: 'var(--shadow-md)',
            }
          : {
              paddingBottom: 20,
              borderBottom: '1px solid var(--border2)',
            }),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          minWidth: 0,
          flex: '1 1 220px',
        }}
      >
        {back ? (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={back.ariaLabel || back.label || 'Powrót'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              marginTop: 2,
              padding: '6px 10px',
              borderRadius: 10,
              border: isHero ? '1px solid rgba(255,255,255,0.22)' : '1px solid var(--border2)',
              background: isHero ? 'rgba(255,255,255,0.08)' : 'var(--bg-card2)',
              color: isHero ? 'rgba(255,255,255,0.92)' : 'var(--accent)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: 'var(--shadow-sm)',
              transition: 'transform 0.18s ease, filter 0.18s ease',
            }}
          >
            <ChevronLeft style={{ fontSize: 22, margin: '-2px -4px -2px -6px' }} aria-hidden />
            {back.label != null ? back.label : ''}
          </button>
        ) : null}
        {icon ? (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: isHero ? 'rgba(255,255,255,0.1)' : 'var(--logo-tint-bg)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: isHero ? 'rgba(255,255,255,0.22)' : 'var(--border2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isHero ? '#fff' : 'var(--accent)',
              flexShrink: 0,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {icon}
          </div>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: isHero ? 26 : 'clamp(22px, 4vw, 28px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: isHero ? '#fff' : 'var(--accent)',
              lineHeight: 1.2,
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 14,
                lineHeight: 1.45,
                color: isHero ? 'rgba(232,237,244,0.78)' : 'var(--text-muted)',
                maxWidth: 720,
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginLeft: 'auto',
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
