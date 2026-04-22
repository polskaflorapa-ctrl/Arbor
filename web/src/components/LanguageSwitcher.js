import { useTranslation } from 'react-i18next';

const baseBtn = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text-muted)',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
  transition: 'all 0.15s',
};

const activeBtn = {
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
  background: 'rgba(52,211,153,0.12)',
};

export default function LanguageSwitcher({ compact = false, style = {} }) {
  const { t, i18n } = useTranslation();
  const cur = (i18n.resolvedLanguage || i18n.language || 'pl').split('-')[0];
  const codes = ['pl', 'uk', 'ru'];

  return (
    <div
      role="group"
      aria-label={t('lang.switcherAria')}
      style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', ...style }}
    >
      {codes.map((code) => {
        const active = cur === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => i18n.changeLanguage(code)}
            style={{ ...baseBtn, ...(active ? activeBtn : {}) }}
            aria-pressed={active}
          >
            {compact ? code.toUpperCase() : t(`lang.${code}`)}
          </button>
        );
      })}
    </div>
  );
}
