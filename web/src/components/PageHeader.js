import ChevronLeft from '@mui/icons-material/ChevronLeft';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Spójny nagłówek widoku (tytuł + opcjonalnie podtytuł, ikona, akcje, wstecz).
 *
 * @param {object} props
 * @param {'plain'|'hero'} [props.variant]
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {import('react').ReactNode} [props.icon] — np. ikona MUI w kolorze dziedziczonym
 * @param {import('react').ReactNode} [props.actions]
 * @param {{ onClick: () => void, label?: string, ariaLabel?: string } | false} [props.back] — `false` wyłącza przycisk
 * @param {boolean} [props.showBack] — gdy `true` (domyślnie), pokazuj „Powrót” (history -1) poza ekranem logowania
 */
export default function PageHeader({ variant = 'plain', title, subtitle, icon, actions, back, showBack = true }) {
  const isHero = variant === 'hero';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const isLogin = pathname === '/';
  const defaultBack = showBack && !isLogin
    ? { onClick: () => navigate(-1), label: t('common.back', { defaultValue: 'Powrót' }) }
    : null;
  const resolvedBack = back === false ? null : back || defaultBack;

  return (
    <header
      className={isHero ? 'ios-glass-panel' : undefined}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: isHero ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
        ...(isHero
          ? {
              padding: '22px 26px',
              borderRadius: 16,
              background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-deep) 48%, var(--bg-card2) 100%)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-sm)',
            }
          : {
              paddingBottom: 16,
              borderBottom: '1px solid var(--border)',
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
        {resolvedBack ? (
          <button
            type="button"
            onClick={resolvedBack.onClick}
            aria-label={resolvedBack.ariaLabel || resolvedBack.label || 'Powrót'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              marginTop: 2,
              padding: '6px 10px',
              borderRadius: 10,
              border: isHero ? '1px solid rgba(255,255,255,0.18)' : '1px solid var(--border)',
              background: isHero ? 'rgba(255,255,255,0.08)' : 'var(--bg-card2)',
              color: isHero ? 'rgba(255,255,255,0.92)' : 'var(--text-sub)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: isHero ? 'none' : 'var(--shadow-sm)',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            <ChevronLeft style={{ fontSize: 22, margin: '-2px -4px -2px -6px' }} aria-hidden />
            {resolvedBack.label != null ? resolvedBack.label : ''}
          </button>
        ) : null}
        {icon ? (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: isHero ? 'rgba(255,255,255,0.1)' : 'var(--bg-card2)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: isHero ? 'rgba(255,255,255,0.18)' : 'var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isHero ? '#fff' : 'var(--text-sub)',
              flexShrink: 0,
              boxShadow: isHero ? 'none' : 'var(--shadow-sm)',
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
              fontWeight: isHero ? 700 : 600,
              letterSpacing: '-0.02em',
              color: isHero ? '#fff' : 'var(--text)',
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
