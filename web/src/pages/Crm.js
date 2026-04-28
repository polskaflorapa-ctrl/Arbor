import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import { getStoredToken } from '../utils/storedToken';

const KOMMO_URL = (process.env.REACT_APP_KOMMO_APP_URL || '').trim();

export default function Crm() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!getStoredToken()) navigate('/');
  }, [navigate]);

  const cards = useMemo(
    () => [
      { path: '/klienci', titleKey: 'crm.cardClients', descKey: 'crm.cardClientsDesc' },
      { path: '/wycena-kalendarz', titleKey: 'crm.cardQuotes', descKey: 'crm.cardQuotesDesc' },
      { path: '/ogledziny', titleKey: 'crm.cardInspections', descKey: 'crm.cardInspectionsDesc' },
      { path: '/telefonia', titleKey: 'crm.cardTelephony', descKey: 'crm.cardTelephonyDesc' },
      { path: '/integracje', titleKey: 'crm.cardIntegrations', descKey: 'crm.cardIntegrationsDesc' },
      { path: '/crm/dashboard', titleKey: 'crm.cardDashboard', descKey: 'crm.cardDashboardDesc' },
      { path: '/crm/pipeline', titleKey: 'crm.cardPipeline', descKey: 'crm.cardPipelineDesc' },
    ],
    []
  );

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <PageHeader title={t('crm.title')} subtitle={t('crm.subtitle')} variant="hero" />
        <div
          className="app-content"
          style={{
            width: '100%',
            maxWidth: 1100,
            margin: '0 auto',
            boxSizing: 'border-box',
            paddingLeft: 'clamp(12px, 3vw, 20px)',
            paddingRight: 'clamp(12px, 3vw, 20px)',
          }}
        >
          <section className="ios-inset" style={{ marginBottom: 16, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('crm.hubTitle')}</div>
            <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
              {t('crm.hubBody')}
            </p>
          </section>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {cards.map((c) => (
              <button
                key={c.path}
                type="button"
                className="ios-inset"
                onClick={() => navigate(c.path)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  cursor: 'pointer',
                  borderRadius: 12,
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>{t(c.titleKey)}</div>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-sub)' }}>{t(c.descKey)}</div>
              </button>
            ))}
          </div>

          <section className="ios-inset" style={{ padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('crm.kommoTitle')}</div>
            <p className="muted" style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5 }}>
              {t('crm.kommoBody')}
            </p>
            {KOMMO_URL ? (
              <a
                href={KOMMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ios-btn ios-btn-primary"
                style={{ display: 'inline-flex', textDecoration: 'none' }}
              >
                {t('crm.openKommo')}
              </a>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t('crm.kommoEnvHint')}
              </p>
            )}
            <p className="muted" style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.45 }}>
              {t('crm.kommoOwnSetupHint')}
            </p>
          </section>

          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5 }}>
            {t('crm.releaseChecklistHint')}
          </p>
        </div>
      </main>
    </div>
  );
}
