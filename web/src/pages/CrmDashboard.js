import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, PhoneCall, RefreshCw, Target, UserPlus, XCircle } from 'lucide-react';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { Button } from '../components/ui/Button';
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
  const [commandCenter, setCommandCenter] = useState({ summary: {}, priorities: [] });
  const [messageQueue, setMessageQueue] = useState([]);
  const [messageProviders, setMessageProviders] = useState({ worker: {}, channels: [] });
  const [queueStatus, setQueueStatus] = useState('all');
  const [queueSavingId, setQueueSavingId] = useState(null);
  const [queueProcessing, setQueueProcessing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setMsg('');
      const token = getStoredToken();
      const headers = authHeaders(token);
      const params = oddzialId ? { oddzial_id: oddzialId } : {};
      const queueParams = { ...params, status: queueStatus, limit: 12 };
      const [overviewRes, oddzialyRes, queueRes, providersRes, commandRes] = await Promise.all([
        api.get('/crm/overview', { headers, params }),
        api.get('/oddzialy', { headers }).catch(() => ({ data: [] })),
        api.get('/crm/messages/queue', { headers, params: queueParams }).catch(() => ({ data: [] })),
        api.get('/crm/messages/providers', { headers }).catch(() => ({ data: { worker: {}, channels: [] } })),
        api.get('/crm/command-center', { headers, params: { ...params, limit: 8 } }).catch(() => ({ data: { summary: {}, priorities: [] } })),
      ]);
      setOverview(overviewRes.data || { kpis: {}, pipeline: [], sources: [], callbacks: [] });
      setOddzialy(Array.isArray(oddzialyRes.data) ? oddzialyRes.data : []);
      setMessageQueue(Array.isArray(queueRes.data) ? queueRes.data : []);
      setMessageProviders(providersRes.data || { worker: {}, channels: [] });
      setCommandCenter(commandRes.data || { summary: {}, priorities: [] });
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
  }, [oddzialId, queueStatus]);

  const updateQueueMessage = async (messageId, status) => {
    try {
      setQueueSavingId(messageId);
      setMsg('');
      const token = getStoredToken();
      await api.patch(
        `/crm/messages/${messageId}/status`,
        { status, error: status === 'failed' ? 'Oznaczone recznie w CRM' : undefined },
        { headers: authHeaders(token) }
      );
      await loadData();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.dashboard.queueUpdateError', { defaultValue: 'Nie udalo sie zaktualizowac kolejki wysylki' })));
    } finally {
      setQueueSavingId(null);
    }
  };

  const processQueue = async () => {
    try {
      setQueueProcessing(true);
      setMsg('');
      const token = getStoredToken();
      const res = await api.post('/crm/messages/queue/process', { limit: 10 }, { headers: authHeaders(token) });
      const data = res.data || {};
      await loadData();
      setMsg(t('crm.dashboard.queueProcessed', {
        defaultValue: `Kolejka przetworzona: ${data.sent || 0} wyslane, ${data.failed || 0} bledy.`,
      }));
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('crm.dashboard.queueProcessError', { defaultValue: 'Nie udalo sie uruchomic kolejki wysylki' })));
    } finally {
      setQueueProcessing(false);
    }
  };

  const kpiCards = useMemo(() => {
    const k = overview.kpis || {};
    return [
      { key: 'clients_total', label: t('crm.dashboard.clientsTotal', { defaultValue: 'Klienci łącznie' }), value: k.clients_total || 0 },
      { key: 'clients_new_30d', label: t('crm.dashboard.clientsNew30', { defaultValue: 'Nowi klienci (30 dni)' }), value: k.clients_new_30d || 0 },
      { key: 'tasks_total', label: t('crm.dashboard.tasksTotal', { defaultValue: 'Szanse / zlecenia' }), value: k.tasks_total || 0 },
      { key: 'tasks_won_30d', label: t('crm.dashboard.tasksWon30', { defaultValue: 'Wygrane (30 dni)' }), value: k.tasks_won_30d || 0 },
      { key: 'technical_leads', label: t('crm.dashboard.technicalLeads', { defaultValue: 'Lejek techniczny' }), value: k.technical_leads || 0 },
      { key: 'calls_30d', label: t('crm.dashboard.calls30', { defaultValue: 'Połączenia (30 dni)' }), value: k.calls_30d || 0 },
      { key: 'callbacks_open', label: t('crm.dashboard.callbacksOpen', { defaultValue: 'Follow-up otwarte' }), value: k.callbacks_open || 0 },
      { key: 'lead_win_rate', label: t('crm.dashboard.leadWinRate', { defaultValue: 'Konwersja leadów' }), value: `${k.lead_win_rate || 0}%` },
      { key: 'nps_score', label: t('crm.dashboard.npsScore', { defaultValue: 'NPS (30 dni)' }), value: k.nps_responses_30d ? k.nps_score || 0 : '—' },
    ];
  }, [overview.kpis, t]);

  const conversion = overview.analytics?.conversion || {};
  const owners = overview.analytics?.owners || [];
  const nps = overview.analytics?.nps || {};
  const commandSummary = commandCenter.summary || {};
  const commandPriorities = Array.isArray(commandCenter.priorities) ? commandCenter.priorities : [];
  const queueCounts = messageQueue.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="app-shell crm-dashboard-shell">
      <CommandSidebar active="crm" />
      <main className="app-main crm-dashboard-main">
        <PageHeader
          title={t('crm.dashboard.title', { defaultValue: 'CRM Dashboard' })}
          subtitle={t('crm.dashboard.subtitle', { defaultValue: 'Pipeline, źródła leadów i follow-up w jednym miejscu.' })}
          variant="hero"
        />
        <div className="app-content crm-dashboard-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />
          <section className="ios-inset crm-dashboard-action" style={{ marginBottom: 12, padding: 12 }}>
            <Button rightIcon={ArrowRight} onClick={() => navigate('/crm/pipeline')}>
              {t('crm.dashboard.openPipeline', { defaultValue: 'Otwórz pipeline leadów' })}
            </Button>
          </section>

          <section className="ios-inset crm-dashboard-command-center" style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {t('crm.dashboard.commandCenter', { defaultValue: 'Co zrobić teraz' })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('crm.dashboard.commandCenterHint', { defaultValue: 'Najważniejsze leady według ryzyka, wartości i zaległych akcji.' })}
                </div>
              </div>
              <Button size="sm" variant="outline" rightIcon={ArrowRight} onClick={() => navigate('/crm/pipeline')}>
                {t('crm.dashboard.commandCenterOpenPipeline', { defaultValue: 'Pracuj w pipeline' })}
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
              {[
                { key: 'critical', icon: AlertTriangle, label: t('crm.dashboard.commandCritical', { defaultValue: 'Krytyczne' }), value: commandSummary.critical || 0 },
                { key: 'unassigned', icon: UserPlus, label: t('crm.dashboard.commandUnassigned', { defaultValue: 'Bez ownera' }), value: commandSummary.unassigned || 0 },
                { key: 'phone_unassigned', icon: PhoneCall, label: t('crm.dashboard.commandPhoneUnassigned', { defaultValue: 'Tel. bez ownera' }), value: commandSummary.phone_unassigned || 0 },
                { key: 'phone_followups', icon: PhoneCall, label: t('crm.dashboard.commandPhoneFollowups', { defaultValue: 'Po rozmowach' }), value: commandSummary.phone_followups || 0 },
                { key: 'value', icon: Target, label: t('crm.dashboard.commandValueAtRisk', { defaultValue: 'Wartość zagrożona' }), value: formatCurrency(commandSummary.value_at_risk || 0) },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.key} className="ios-inset-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={18} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.label}</div>
                      <strong style={{ fontSize: 18 }}>{item.value}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ios-inset-list">
              {commandPriorities.map((lead) => (
                <div key={lead.id} className="ios-inset-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ overflowWrap: 'anywhere' }}>{lead.title || `Lead #${lead.id}`}</strong>
                      <span style={{ fontSize: 12, color: lead.priority === 'critical' ? 'var(--danger, #b91c1c)' : 'var(--text-muted)' }}>
                        {lead.priority} · {lead.score}/100
                      </span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{lead.next_best_action}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(lead.reasons || []).map((r) => r.label).join(' · ') || lead.stage}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" rightIcon={ArrowRight} onClick={() => navigate(`/crm/pipeline?lead_id=${lead.id}`)}>
                    {t('crm.dashboard.commandOpenLead', { defaultValue: 'Otwórz' })}
                  </Button>
                </div>
              ))}
              {!loading && commandPriorities.length === 0 ? (
                <div className="ios-inset-row muted">
                  {t('crm.dashboard.commandEmpty', { defaultValue: 'Brak pilnych leadów. CRM jest czysty.' })}
                </div>
              ) : null}
            </div>
          </section>

          <section className="ios-inset crm-dashboard-filters" style={{ marginBottom: 12, padding: 12 }}>
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
            className="crm-dashboard-kpis"
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

          <div className="crm-dashboard-grid crm-dashboard-grid-primary" style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
            <section className="ios-inset crm-dashboard-panel" style={{ padding: 12 }}>
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
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.source}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('crm.dashboard.sourceWonLost', { defaultValue: 'Wygrane/przegrane' })}: {s.won || 0}/{s.lost || 0}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong>{s.count}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.conversion_rate || 0}%</div>
                    </div>
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

          <div className="crm-dashboard-grid crm-dashboard-grid-secondary" style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 12, marginTop: 12 }}>
            <section className="ios-inset crm-dashboard-panel" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                {t('crm.dashboard.conversion', { defaultValue: 'Konwersja CRM' })}
              </div>
              <div className="ios-inset-list">
                {[
                  [t('crm.dashboard.openLeads', { defaultValue: 'Otwarte' }), conversion.open || 0, conversion.open_rate || 0],
                  [t('crm.dashboard.wonLeads', { defaultValue: 'Wygrane' }), conversion.won || 0, conversion.win_rate || 0],
                  [t('crm.dashboard.lostLeads', { defaultValue: 'Przegrane' }), conversion.lost || 0, conversion.loss_rate || 0],
                  [t('crm.dashboard.technicalLeads', { defaultValue: 'Techniczne' }), conversion.technical || 0, null],
                ].map(([label, count, rate]) => (
                  <div key={label} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{label}</span>
                    <strong>{count}{rate == null ? '' : ` (${rate}%)`}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="ios-inset crm-dashboard-panel" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                {t('crm.dashboard.ownerPerformance', { defaultValue: 'Aktywność ownerów' })}
              </div>
              <div className="ios-inset-list">
                {owners.map((o) => (
                  <div key={o.owner_user_id || 'none'} className="ios-inset-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{o.owner_name || t('crm.pipeline.noOwner', { defaultValue: 'Bez ownera' })}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('crm.dashboard.ownerOpenWonLost', { defaultValue: 'Otwarte/wygrane/przegrane' })}: {o.open || 0}/{o.won || 0}/{o.lost || 0}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong>{o.conversion_rate || 0}%</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatCurrency(o.won_value || 0)}</div>
                    </div>
                  </div>
                ))}
                {!loading && owners.length === 0 ? (
                  <div className="ios-inset-row muted">
                    {t('crm.dashboard.emptyOwners', { defaultValue: 'Brak danych ownerów.' })}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="ios-inset crm-dashboard-panel crm-dashboard-nps" style={{ marginTop: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>
                {t('crm.dashboard.npsTitle', { defaultValue: 'Satysfakcja klientów' })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('crm.dashboard.npsResponses', { defaultValue: 'Odpowiedzi' })}: {nps.responses || 0}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              {[
                [t('crm.dashboard.npsScore', { defaultValue: 'NPS' }), nps.responses ? nps.score || 0 : '—'],
                [t('crm.dashboard.npsAverage', { defaultValue: 'Średnia ocena' }), nps.responses ? nps.avg_score || 0 : '—'],
                [t('crm.dashboard.npsPromoters', { defaultValue: 'Promotorzy' }), nps.promoters || 0],
                [t('crm.dashboard.npsPassives', { defaultValue: 'Pasywni' }), nps.passives || 0],
                [t('crm.dashboard.npsDetractors', { defaultValue: 'Krytycy' }), nps.detractors || 0],
              ].map(([label, value]) => (
                <div key={label} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="ios-inset crm-dashboard-panel crm-dashboard-queue" style={{ marginTop: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {t('crm.dashboard.messageQueue', { defaultValue: 'Kolejka wysylki' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('crm.dashboard.messageQueueMeta', { defaultValue: 'Do wyslania' })}: {queueCounts.queued || 0} · {t('crm.dashboard.messageQueueFailed', { defaultValue: 'Bledy' })}: {queueCounts.failed || 0}
                </div>
              </div>
              <select
                className="ios-field"
                value={queueStatus}
                onChange={(e) => setQueueStatus(e.target.value)}
                style={{ maxWidth: 180 }}
                aria-label={t('crm.dashboard.messageQueueFilter', { defaultValue: 'Status kolejki wysylki' })}
              >
                <option value="all">{t('crm.dashboard.queueAll', { defaultValue: 'Otwarte i bledy' })}</option>
                <option value="queued">{t('crm.dashboard.queueQueued', { defaultValue: 'Do wyslania' })}</option>
                <option value="failed">{t('crm.dashboard.queueFailed', { defaultValue: 'Bledy' })}</option>
                <option value="sent">{t('crm.dashboard.queueSent', { defaultValue: 'Wyslane' })}</option>
              </select>
              <Button loading={queueProcessing} leftIcon={RefreshCw} disabled={queueProcessing} onClick={processQueue}>
                {queueProcessing
                  ? t('crm.dashboard.queueProcessing', { defaultValue: 'Przetwarzam...' })
                  : t('crm.dashboard.queueProcessNow', { defaultValue: 'Uruchom kolejke' })}
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
              {(messageProviders.channels || []).slice(0, 6).map((provider) => (
                <div key={provider.channel} className="ios-inset-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{provider.channel}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {provider.provider || provider.note || 'brak'}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: provider.ready ? 'var(--success, #16794a)' : 'var(--text-muted)' }}>
                    {provider.ready
                      ? t('crm.dashboard.providerReady', { defaultValue: 'gotowy' })
                      : t('crm.dashboard.providerMissing', { defaultValue: 'brak' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="ios-inset-list">
              {messageQueue.map((m) => (
                <div key={m.id} className="ios-inset-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong>{m.lead_title || m.client_name || `#${m.lead_id}`}</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.channel} · {m.status}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.subject ? `${m.subject}: ` : ''}{m.body}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {t('crm.dashboard.queueRetryCount', { defaultValue: 'Proby' })}: {m.retry_count || 0}
                      {m.last_error ? ` · ${m.last_error}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {m.status === 'failed' ? (
                      <Button size="sm" variant="outline" leftIcon={RefreshCw} disabled={queueSavingId === m.id} onClick={() => updateQueueMessage(m.id, 'queued')}>
                        {t('crm.dashboard.queueRetry', { defaultValue: 'Ponow' })}
                      </Button>
                    ) : null}
                    {m.status === 'queued' || m.status === 'failed' ? (
                      <>
                        <Button size="sm" leftIcon={Check} disabled={queueSavingId === m.id} onClick={() => updateQueueMessage(m.id, 'sent')}>
                          {t('crm.dashboard.queueMarkSent', { defaultValue: 'Wyslane' })}
                        </Button>
                        <Button size="sm" variant="danger" leftIcon={XCircle} disabled={queueSavingId === m.id} onClick={() => updateQueueMessage(m.id, 'failed')}>
                          {t('crm.dashboard.queueMarkFailed', { defaultValue: 'Blad' })}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {!loading && messageQueue.length === 0 ? (
                <div className="ios-inset-row muted">
                  {t('crm.dashboard.emptyMessageQueue', { defaultValue: 'Brak wiadomosci w kolejce.' })}
                </div>
              ) : null}
            </div>
          </section>

          <section className="ios-inset crm-dashboard-panel crm-dashboard-followups" style={{ marginTop: 12, padding: 12 }}>
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
