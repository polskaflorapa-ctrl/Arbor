import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

const baseBtn = {
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-sub)',
  borderRadius: 6,
  padding: '6px 9px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 800,
  lineHeight: 1,
  transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
};

const activeBtn = {
  border: '1px solid var(--border2)',
  color: 'var(--text)',
  background: 'var(--bg-card)',
  boxShadow: 'var(--shadow-sm)',
};

export default function LanguageSwitcher({ compact = false, tone = 'light', style = {} }) {
  const { t, i18n } = useTranslation();
  const cur = (i18n.resolvedLanguage || i18n.language || 'pl').split('-')[0];
  const codes = ['pl', 'en', 'uk', 'ru'];
  const dark = tone === 'dark';
  const groupStyle = dark
    ? {
        border: '1px solid rgba(255, 255, 255, 0.12)',
        background: 'rgba(255, 255, 255, 0.08)',
      }
    : {
        border: '1px solid var(--border)',
        background: 'var(--bg-card2)',
      };
  const darkBtn = dark ? { color: 'rgba(255, 255, 255, 0.72)' } : {};
  const darkActiveBtn = dark
    ? {
        border: '1px solid rgba(255, 255, 255, 0.22)',
        color: 'var(--brand-dark-brown, #3b2a18)',
        background: 'var(--brand-white, #ffffff)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.16)',
      }
    : {};

  return (
    <div
      role="group"
      aria-label={t('lang.switcherAria')}
      style={{
        display: 'inline-flex',
        gap: 2,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: 3,
        borderRadius: 8,
        ...groupStyle,
        ...style,
      }}
    >
      {codes.map((code) => {
        const active = cur === code;
        const label = t(`lang.${code}`);
        return (
          <Button
            key={code}
            variant={active ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => i18n.changeLanguage(code)}
            style={{ ...baseBtn, ...darkBtn, ...(active ? { ...activeBtn, ...darkActiveBtn } : {}) }}
            aria-pressed={active}
            aria-label={label}
            title={label}
          >
            {compact ? code.toUpperCase() : label}
          </Button>
        );
      })}
    </div>
  );
}
