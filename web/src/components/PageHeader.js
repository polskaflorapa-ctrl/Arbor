import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from './ui/Button';

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
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const isLogin = pathname === '/';
  const compact = viewportWidth < 720;
  const defaultBack = showBack && !isLogin
    ? { onClick: () => navigate(-1), label: t('common.back', { defaultValue: 'Powrót' }) }
    : null;
  const resolvedBack = back === false ? null : back || defaultBack;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <header
      className={`module-page-header ${isHero ? 'module-page-header-hero ios-glass-panel' : 'module-page-header-plain'}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: isHero ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        gap: compact ? 12 : 16,
        marginBottom: 24,
        boxSizing: 'border-box',
        width: '100%',
        ...(isHero
          ? {
              padding: '18px 20px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
              border: '1px solid var(--glass-border)',
              boxShadow: 'var(--shadow-sm)',
            }
          : {
              paddingBottom: 16,
              borderBottom: '1px solid var(--glass-border)',
            }),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: compact ? 12 : 16,
          minWidth: 0,
          flex: compact ? '1 1 100%' : '1 1 220px',
          width: compact ? '100%' : undefined,
        }}
      >
        {resolvedBack ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={resolvedBack.onClick}
            aria-label={resolvedBack.ariaLabel || resolvedBack.label || 'Powrót'}
            leftIcon={ArrowLeft}
            style={{
              gap: 2,
              marginTop: 2,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-field)',
              color: 'var(--text-sub)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: isHero ? 'none' : 'var(--shadow-sm)',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {resolvedBack.label != null ? resolvedBack.label : ''}
          </Button>
        ) : null}
        {icon ? (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'var(--surface-field)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              flexShrink: 0,
              boxShadow: isHero ? 'none' : 'var(--shadow-sm)',
            }}
          >
            {icon}
          </div>
        ) : null}
        <div style={{ minWidth: 0, flex: '1 1 0', maxWidth: '100%' }}>
          {isHero ? (
            <div
              style={{
                marginBottom: 6,
                color: 'var(--accent)',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: 0,
                textTransform: 'uppercase',
              }}
            >
              ARBOR Operations
            </div>
          ) : null}
          <h1
            style={{
              margin: 0,
              fontSize: isHero ? 25 : 'clamp(22px, 4vw, 28px)',
              fontWeight: isHero ? 900 : 800,
              letterSpacing: 0,
              color: 'var(--text)',
              lineHeight: 1.2,
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: compact ? 13 : 14,
                lineHeight: 1.45,
                color: 'var(--text-muted)',
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
            marginLeft: compact ? 0 : 'auto',
            width: compact ? '100%' : undefined,
            justifyContent: compact ? 'flex-start' : undefined,
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
