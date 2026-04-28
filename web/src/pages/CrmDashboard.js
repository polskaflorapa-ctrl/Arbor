import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('pl-PL')} PLN`;
}

export default function CrmDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [oddzialy, setOddzialy] = useState([]);
  const [oddzialId, setOddzialId] = useState('');
  const [overview, setOverview] = useState({
    kpis: {},
    pipeline: [],
    sources: [],
    callbacks: [],
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setMsg('');
      const token = getStoredToken();
      const headers = authHeaders(token);
      const params = oddzialId ? { oddzial_id: oddzialId } : {};
      const [overviewRes, oddzialyRes] = await Promise.all([
        api.get('/crm/overview', { headers, params }),
        api.get('/oddzialy', { headers }).catch(() => ({ data: [] })),
      ]);
      setOverview(overviewRes.data || { kpis: {}, pipeline: [], sources: [], callbacks: [] });
      setOddzialy(Array.isArray(oddzialyRes.data) ? oddzialyRes.data : []);
    } catch (e) {
      const base = getApiErrorMessage(e, t('crm.dashboard.loadError', { defaultValue: 'Nie udało się pobrać dashboardu CRM' }));
      const path = e?.requestDebug?.urlPath || '';
      const isOverview404 = e?.response?.status === 404 && String(path).includes('crm/overview');
      setMsg(
        isOverview404
          ? `${base} ${t('crm.dashboard.overview404Hint', {
              defaultValue:
                'Upewnij się, że działa aktualny backend z tego repozytorium: w katalogu `web` uruchom `npm run server` (domyślnie :3001) i zrestartuj go po aktualizacji kodu. W `.env.local` możesz ustawić `ARBOR_API_PROXY_TARGET`, jeśli API jest na innym hoście.',
            })}`
          : base
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddzialId]);

  const kpiCards = useMemo(() => {
    const k = overview.kpis || {};
    return [
      { key: 'clients_total', label: t('crm.dashboard.clientsTotal', { defaultValue: 'Klienci łącznie' }), value: k.clients_total || 0 },
      { key: 'clients_new_30d', label: t('crm.dashboard.clientsNew30', { defaultValue: 'Nowi klienci (30 dni)' }), value: k.clients_new_30d || 0 },
      { key: 'tasks_total', label: t('crm.dashboard.tasksTotal', { defaultValue: 'Szanse / zlecenia' }), value: k.tasks_total || 0 },
      { key: 'tasks_won_30d', label: t('crm.dashboard.tasksWon30', { defaultValue: 'Wygrane (30 dni)' }), value: k.tasks_won_30d || 0 },
      { key: 'calls_30d', label: t('crm.dashboard.calls30', { defaultValue: 'Połączenia (30 dni)' }), value: k.calls_30d || 0 },
      { key: 'callbacks_open', label: t('crm.dashboard.callbacksOpen', { defaultValue: 'Follow-up otwarte' }), value: k.callbacks_open || 0 },
    ];
  }, [overview.kpis, t]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <PageHeader
          title={t('crm.dashboard.title', { defaultValue: 'CRM Dashboard' })}
          subtitle={t('crm.dashboard.subtitle', { defaultValue: 'Pipeline, źródła leadów i follow-up w jednym miejscu.' })}
          variant="hero"
        />
        <div className="app-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />
          <section className="ios-inset" style={{ marginBottom: 12, padding: 12 }}>
            <button className="ios-btn ios-btn-primary" type="button" onClick={() => navigate('/crm/pipeline')}>
              {t('crm.dashboard.openPipeline', { defaultValue: 'Otwórz pipeline leadów' })}
            </button>
          </section>

          <section className="ios-inset" style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {t('crm.dashboard.filterBranch', { defaultValue: 'Oddział' })}
              </span>
              <select
                className="ios-field"
                value={oddzialId}
                onChange={(e) => setOddzialId(e.target.value)}
                style={{ maxWidth: 260 }}
              >
                <option value="">{t('crm.dashboard.allBranches', { defaultValue: 'Wszystkie oddziały' })}</option>
                {oddzialy.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nazwa || `#${o.id}`}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
              marginBottom: 12,
            }}
          >
            {kpiCards.map((k) => (
              <div key={k.key} className="ios-inset" style={{ padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{k.value}</div>
              </div>
            ))}
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
            <section className="ios-inset" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                {t('crm.dashboard.pipeline', { defaultValue: 'Pipeline' })}
              </div>
              <div className="ios-inset-list">
                {(overview.pipeline || []).map((p) => (
                  <div key={p.stage} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.stage}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('crm.dashboard.items', { defaultValue: 'Pozycji' })}: {p.count}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{formatCurrency(p.value)}</div>
                  </div>
                ))}
                {!loading && (!overview.pipeline || overview.pipeline.length === 0) ? (
                  <div className="ios-inset-row muted">
                    {t('crm.dashboard.emptyPipeline', { defaultValue: 'Brak danych pipeline.' })}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="ios-inset" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                {t('crm.dashboard.sources', { defaultValue: 'Źródła leadów' })}
              </div>
              <div className="ios-inset-list">
                {(overview.sources || []).slice(0, 8).map((s) => (
                  <div key={s.source} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{s.source}</span>
                    <strong>{s.count}</strong>
                  </div>
                ))}
                {!loading && (!overview.sources || overview.sources.length === 0) ? (
                  <div className="ios-inset-row muted">
                    {t('crm.dashboard.emptySources', { defaultValue: 'Brak danych źródeł.' })}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="ios-inset" style={{ marginTop: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>
                {t('crm.dashboard.followups', { defaultValue: 'Najbliższe follow-up' })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('crm.dashboard.overdue', { defaultValue: 'Przeterminowane' })}: {overview.kpis?.callbacks_overdue || 0}
              </div>
            </div>
            <div className="ios-inset-list">
              {(overview.callbacks || []).map((c) => (
                <div key={c.id} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.lead_name || c.phone || `#${c.id}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    <div>{c.due_at ? new Date(c.due_at).toLocaleString() : '—'}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{c.status || 'open'}</div>
                  </div>
                </div>
              ))}
              {!loading && (!overview.callbacks || overview.callbacks.length === 0) ? (
                <div className="ios-inset-row muted">
                  {t('crm.dashboard.emptyFollowups', { defaultValue: 'Brak otwartych follow-up.' })}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
