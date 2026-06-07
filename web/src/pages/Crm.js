import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ExternalLink } from 'lucide-react';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/ui/Button';
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
      { path: '/crm/inbox', title: 'Unified Inbox', desc: 'Wspolna skrzynka WhatsApp, SMS, e-mail i webchat.' },
      { path: '/crm/pipeline', titleKey: 'crm.cardPipeline', descKey: 'crm.cardPipelineDesc' },
    ],
    []
  );

  return (
    <div className="app-shell crm-command-shell">
      <CommandSidebar active="crm" />
      <main className="app-main crm-command-main">
        <PageHeader
          title={t('crm.title')}
          subtitle={t('crm.subtitle')}
          variant="hero"
          actions={(
            <Button type="button" rightIcon={ArrowRight} onClick={() => navigate('/crm/pipeline')}>
              Pipeline
            </Button>
          )}
        />
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
              <Button
                key={c.path}
                variant="secondary"
                className="ios-inset"
                onClick={() => navigate(c.path)}
                rightIcon={ArrowRight}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  cursor: 'pointer',
                  borderRadius: 12,
                  color: 'var(--text)',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ display: 'block', fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>{c.title || t(c.titleKey)}</span>
                <span style={{ display: 'block', fontSize: 13, lineHeight: 1.45, color: 'var(--text-sub)' }}>{c.desc || t(c.descKey)}</span>
              </Button>
            ))}
          </div>

          <section className="ios-inset" style={{ padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('crm.kommoTitle')}</div>
            <p className="muted" style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5 }}>
              {t('crm.kommoBody')}
            </p>
            {KOMMO_URL ? (
              <Button
                rightIcon={ExternalLink}
                onClick={() => window.open(KOMMO_URL, '_blank', 'noopener,noreferrer')}
              >
                {t('crm.openKommo')}
              </Button>
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
