import { useCallback, useEffect, useMemo, useState } from 'react';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import MailOutlineOutlined from '@mui/icons-material/MailOutlineOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ACTION_FILTERS = [
  { value: '', label: 'Wszystkie decyzje' },
  { value: 'risk_resend_sms', label: 'Zadarma/SMS' },
  { value: 'risk_queue_call', label: 'Telefon Zadarma' },
  { value: 'risk_acknowledge', label: 'Potwierdzenie ownera' },
  { value: 'risk_owner_auto_remediate', label: 'Auto-remediacja ownera' },
  { value: 'risk_owner_remediation_blocked', label: 'Blokady remediacji' },
  { value: 'risk_reassign_team', label: 'Przepiecie ekipy' },
  { value: 'risk_replace_equipment', label: 'Przepiecie sprzetu' },
  { value: 'mark_reason', label: 'Powod odchylenia' },
  { value: 'set_duration', label: 'Czas planu' },
];

const OWNER_ACK_FILTERS = [
  { value: '', label: 'Wszystkie ryzyka' },
  { value: 'all', label: 'Wszystkie potwierdzenia' },
  { value: 'kommo_sync', label: 'Kommo sync' },
  { value: 'sms_delivery', label: 'SMS delivery' },
];

export default function KontrolaOperacyjna() {
  const currentUser = getLocalStorageJson('user', null) || {};
  const canChooseBranch = ['Prezes', 'Dyrektor', 'Administrator'].includes(currentUser?.rola);
  const [date, setDate] = useState(todayIso());
  const [range, setRange] = useState('week');
  const [oddzialId, setOddzialId] = useState('');
  const [actionType, setActionType] = useState('');
  const [ownerAckFilter, setOwnerAckFilter] = useState('');
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState([]);
  const [history, setHistory] = useState({ items: [], summary: { actions: [], issues: [] }, total: 0 });
  const [openOwnerAlerts, setOpenOwnerAlerts] = useState({ items: [], summary: {}, total: 0 });
  const [ownerRemediationReport, setOwnerRemediationReport] = useState({ items: [], summary: {} });
  const [digest, setDigest] = useState(null);
  const [digestHistory, setDigestHistory] = useState({ items: [], total: 0 });
  const [digestSettings, setDigestSettings] = useState([]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    branch_id: '',
    enabled: true,
    send_time: '06:00',
    email_enabled: false,
    horizon_days: 3,
    fleet_lookahead_days: 14,
    recipient_user_ids: '',
    extra_emails: '',
  });
  const [loading, setLoading] = useState(false);
  const [ownerAlertsLoading, setOwnerAlertsLoading] = useState(false);
  const [ownerBulkAction, setOwnerBulkAction] = useState('');
  const [digestLoading, setDigestLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const ownerAckActive = ownerAckFilter && ownerAckFilter !== '';
    return {
      date,
      range,
      limit: 80,
      ...(oddzialId ? { oddzial_id: oddzialId } : {}),
      ...(ownerAckActive ? { action_type: 'risk_acknowledge' } : actionType ? { action_type: actionType } : {}),
      ...(ownerAckFilter && ownerAckFilter !== 'all' ? { risk_type: ownerAckFilter } : {}),
      ...(query.trim() ? { q: query.trim() } : {}),
    };
  }, [actionType, date, oddzialId, ownerAckFilter, query, range]);

  const loadBranches = useCallback(async () => {
    if (!canChooseBranch) return;
    try {
      const token = getStoredToken();
      const res = await api.get('/oddzialy', { headers: authHeaders(token) });
      const raw = res.data;
      setBranches(Array.isArray(raw) ? raw : raw?.oddzialy || []);
    } catch {
      setBranches([]);
    }
  }, [canChooseBranch]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = getStoredToken();
      const res = await api.get('/ops/action-history', { params, headers: authHeaders(token) });
      setHistory(res.data || { items: [], summary: { actions: [], issues: [] }, total: 0 });
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie wczytac historii decyzji operacyjnych.'));
    } finally {
      setLoading(false);
    }
  }, [params]);

  const loadOpenOwnerAlerts = useCallback(async () => {
    setOwnerAlertsLoading(true);
    try {
      const token = getStoredToken();
      const res = await api.get('/ops/owner-alerts/open', {
        params: {
          date,
          limit: 20,
          ...(oddzialId ? { oddzial_id: oddzialId } : {}),
        },
        headers: authHeaders(token),
      });
      setOpenOwnerAlerts(res.data || { items: [], summary: {}, total: 0 });
    } catch {
      setOpenOwnerAlerts({ items: [], summary: {}, total: 0 });
    } finally {
      setOwnerAlertsLoading(false);
    }
  }, [date, oddzialId]);

  const loadOwnerRemediationReport = useCallback(async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/ops/owner-alerts/remediation-report', {
        params: {
          date,
          range,
          ...(oddzialId ? { oddzial_id: oddzialId } : {}),
        },
        headers: authHeaders(token),
      });
      setOwnerRemediationReport(res.data || { items: [], summary: {} });
    } catch {
      setOwnerRemediationReport({ items: [], summary: {} });
    }
  }, [date, oddzialId, range]);

  const loadDigestHistory = useCallback(async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/automations/daily-digest/history', {
        params: {
          limit: 6,
          ...(oddzialId ? { oddzial_id: oddzialId } : {}),
        },
        headers: authHeaders(token),
      });
      setDigestHistory(res.data || { items: [], total: 0 });
    } catch {
      setDigestHistory({ items: [], total: 0 });
    }
  }, [oddzialId]);

  const loadDigestSettings = useCallback(async () => {
    if (!canChooseBranch) return;
    try {
      const token = getStoredToken();
      const res = await api.get('/automations/daily-digest/settings', { headers: authHeaders(token) });
      const settings = res.data?.settings || [];
      setDigestSettings(settings);
      const active = settings.find((item) => String(item.branch_id || '') === String(oddzialId || ''))
        || settings.find((item) => item.scope === 'global')
        || settings[0];
      if (active) {
        setSettingsForm({
          branch_id: active.branch_id || '',
          enabled: active.enabled !== false,
          send_time: active.send_time || '06:00',
          email_enabled: active.email_enabled === true,
          horizon_days: active.horizon_days || 3,
          fleet_lookahead_days: active.fleet_lookahead_days || 14,
          recipient_user_ids: (active.recipient_user_ids || []).join(', '),
          extra_emails: (active.extra_emails || []).join(', '),
        });
      }
    } catch {
      setDigestSettings([]);
    }
  }, [canChooseBranch, oddzialId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadOpenOwnerAlerts();
  }, [loadOpenOwnerAlerts]);

  useEffect(() => {
    loadOwnerRemediationReport();
  }, [loadOwnerRemediationReport]);

  useEffect(() => {
    loadDigestHistory();
  }, [loadDigestHistory]);

  useEffect(() => {
    loadDigestSettings();
  }, [loadDigestSettings]);

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const token = getStoredToken();
      const res = await api.get('/ops/action-history', {
        params: { ...params, format: 'csv', limit: 1000 },
        headers: authHeaders(token),
      });
      downloadCsv(res.data || '', `arbor-decyzje-operacyjne-${date}.csv`);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie pobrac CSV.'));
    } finally {
      setExporting(false);
    }
  };

  const printPdf = () => {
    window.print();
  };

  const loadDigest = async () => {
    setDigestLoading(true);
    setError('');
    try {
      const token = getStoredToken();
      const res = await api.get('/automations/daily-digest/preview', {
        params: {
          date,
          horizon_days: 3,
          fleet_lookahead_days: 14,
          ...(oddzialId ? { oddzial_id: oddzialId } : {}),
        },
        headers: authHeaders(token),
      });
      setDigest(res.data || null);
      await loadDigestHistory();
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie zbudowac digestu dyrektora.'));
    } finally {
      setDigestLoading(false);
    }
  };

  const saveDigestConfig = async (event) => {
    event.preventDefault();
    setSettingsSaving(true);
    setError('');
    try {
      const token = getStoredToken();
      await api.put('/automations/daily-digest/settings', {
        branch_id: settingsForm.branch_id || null,
        enabled: settingsForm.enabled,
        send_time: settingsForm.send_time,
        email_enabled: settingsForm.email_enabled,
        horizon_days: Number(settingsForm.horizon_days || 3),
        fleet_lookahead_days: Number(settingsForm.fleet_lookahead_days || 14),
        recipient_user_ids: String(settingsForm.recipient_user_ids || '').split(/[,\n;]/).map((item) => item.trim()).filter(Boolean),
        extra_emails: String(settingsForm.extra_emails || '').split(/[,\n;]/).map((item) => item.trim()).filter(Boolean),
      }, { headers: authHeaders(token) });
      await loadDigestSettings();
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie zapisac konfiguracji digestu.'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const runOwnerBulkAction = async (action) => {
    const selected = openOwnerItems.slice(0, 20);
    if (!selected.length) return;
    setOwnerBulkAction(action);
    setError('');
    try {
      const token = getStoredToken();
      const normalizedAction = action === 'acknowledge' ? 'bulk_acknowledge' : 'bulk_escalate';
      await api.post('/ops/owner-alerts/actions', {
        action: normalizedAction,
        note: normalizedAction === 'bulk_acknowledge'
          ? 'Masowe potwierdzenie z kontroli operacyjnej'
          : 'Masowa eskalacja z kontroli operacyjnej',
        items: selected.map((item) => ({
          risk_id: item.risk_id,
          risk_type: item.risk_type || item.type,
          task_id: item.task_id || null,
          escalation: item.escalation_level || item.escalation || null,
          sla_status: item.sla_status || null,
          source: item.source || null,
        })),
      }, { headers: authHeaders(token) });
      await Promise.all([loadOpenOwnerAlerts(), loadOwnerRemediationReport(), loadHistory()]);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie zapisac akcji ownerow.'));
    } finally {
      setOwnerBulkAction('');
    }
  };

  const items = history.items || [];
  const actionSummary = history.summary?.actions || [];
  const issueSummary = history.summary?.issues || [];
  const ownerAckCount = actionSummary
    .filter((item) => item.action_type === 'risk_acknowledge')
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  const ownerAckRows = items.filter((item) => item.action_type === 'risk_acknowledge');
  const openOwnerItems = openOwnerAlerts.items || [];
  const openOwnerSummary = openOwnerAlerts.summary || {};
  const ownerRemediationSummary = ownerRemediationReport.summary || {};
  const ownerRemediationItems = ownerRemediationReport.items || [];
  const kommoSmsAckCount = ownerAckRows.filter((item) => ['kommo_sync', 'sms_delivery'].includes(item.risk_type)).length;
  const zadarmaCount = actionSummary
    .filter((item) => ['risk_queue_call', 'risk_resend_sms'].includes(item.action_type))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);

  return (
    <div className="app-shell kontrola-shell" style={s.layout}>
      <Sidebar />
      <main className="app-main kontrola-main" style={s.main}>
        <PageHeader
          variant="hero"
          title="Kontrola operacyjna"
          subtitle="Historia decyzji kierownikow: ryzyka dnia, Zadarma, przepiecia ekip i sprzetu."
          icon={<AssessmentOutlined />}
          actions={(
            <div style={s.headerActions}>
              <button type="button" style={s.secondaryBtn} onClick={printPdf}>
                <PrintOutlined style={{ fontSize: 18 }} /> Druk/PDF
              </button>
              <button type="button" style={s.secondaryBtn} onClick={loadDigest} disabled={digestLoading}>
                <MailOutlineOutlined style={{ fontSize: 18 }} /> {digestLoading ? 'Digest...' : 'Digest'}
              </button>
              <button type="button" style={s.primaryBtn} onClick={exportCsv} disabled={exporting}>
                <DownloadOutlined style={{ fontSize: 18 }} /> {exporting ? 'Eksport...' : 'CSV'}
              </button>
              <button type="button" style={s.iconBtn} onClick={loadHistory} disabled={loading} aria-label="Odswiez">
                <RefreshOutlined style={{ fontSize: 19 }} />
              </button>
            </div>
          )}
        />

        {error ? <StatusMessage tone="error" message={error} /> : null}

        <section className="kontrola-filters" style={s.filters}>
          <label style={s.field}>
            <span style={s.label}>Data koncowa</span>
            <input style={s.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label style={s.field}>
            <span style={s.label}>Zakres</span>
            <select style={s.input} value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="today">Dzis</option>
              <option value="week">7 dni</option>
            </select>
          </label>
          {canChooseBranch ? (
            <label style={s.field}>
              <span style={s.label}>Oddzial</span>
              <select style={s.input} value={oddzialId} onChange={(e) => setOddzialId(e.target.value)}>
                <option value="">Wszystkie</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.nazwa || `Oddzial #${branch.id}`}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label style={s.field}>
            <span style={s.label}>Typ decyzji</span>
            <select
              style={s.input}
              value={actionType}
              onChange={(e) => {
                setActionType(e.target.value);
                if (e.target.value) setOwnerAckFilter('');
              }}
              disabled={Boolean(ownerAckFilter)}
            >
              {ACTION_FILTERS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label style={s.field}>
            <span style={s.label}>Potwierdzenia ownerow</span>
            <select
              style={s.input}
              value={ownerAckFilter}
              onChange={(e) => {
                setOwnerAckFilter(e.target.value);
                if (e.target.value) setActionType('');
              }}
              aria-label="Filtr potwierdzen ownerow"
            >
              {OWNER_ACK_FILTERS.map((option) => (
                <option key={option.value || 'all-risk'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label style={{ ...s.field, minWidth: 220, flex: '1 1 220px' }}>
            <span style={s.label}>Szukaj</span>
            <input style={s.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zlecenie, klient, notatka..." />
          </label>
        </section>

        <section className="kontrola-kpis" style={s.kpis}>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Decyzje</span>
            <strong style={s.kpiValue}>{history.total || items.length}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Zadarma/SMS</span>
            <strong style={s.kpiValue}>{zadarmaCount}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Potwierdzenia ownerow</span>
            <strong style={s.kpiValue}>{ownerAckCount || kommoSmsAckCount}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Niedomkniete P1/P2</span>
            <strong style={s.kpiValue}>{(openOwnerSummary.p1 || 0) + (openOwnerSummary.p2 || 0)}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Remediacje ownerow</span>
            <strong style={s.kpiValue}>{ownerRemediationSummary.success || 0}/{ownerRemediationSummary.total || 0}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Blokady limitu</span>
            <strong style={s.kpiValue}>{ownerRemediationSummary.limit_blocks || 0}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Typy akcji</span>
            <strong style={s.kpiValue}>{actionSummary.length}</strong>
          </div>
          <div style={s.kpi}>
            <span style={s.kpiLabel}>Ryzyka</span>
            <strong style={s.kpiValue}>{issueSummary.length}</strong>
          </div>
        </section>

        <section className="kontrola-panel kontrola-owner-open-alerts" style={s.digestPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.h2}>Niedomkniete alerty ownerow</h2>
              <p style={s.muted}>Kommo/SMS bez potwierdzenia ownera, z agingiem SLA i eskalacja P1/P2.</p>
            </div>
            <div style={s.panelActions}>
              <button
                type="button"
                style={s.secondaryBtn}
                onClick={() => runOwnerBulkAction('escalate')}
                disabled={!openOwnerItems.length || Boolean(ownerBulkAction)}
              >
                {ownerBulkAction === 'escalate' ? 'Eskalacja...' : 'Eskaluj widoczne'}
              </button>
              <button
                type="button"
                style={s.primaryBtn}
                onClick={() => runOwnerBulkAction('acknowledge')}
                disabled={!openOwnerItems.length || Boolean(ownerBulkAction)}
              >
                {ownerBulkAction === 'acknowledge' ? 'Potwierdzanie...' : 'Potwierdz widoczne'}
              </button>
              <span style={s.badge}>{ownerAlertsLoading ? 'Ladowanie' : `${openOwnerSummary.open_total ?? openOwnerItems.length} otwarte`}</span>
            </div>
          </div>
          <div style={s.ownerAlertSummary}>
            <div style={s.digestMetric}><span>Kommo</span><strong>{openOwnerSummary.kommo_sync || 0}</strong></div>
            <div style={s.digestMetric}><span>SMS</span><strong>{openOwnerSummary.sms_delivery || 0}</strong></div>
            <div style={s.digestMetric}><span>P1</span><strong>{openOwnerSummary.p1 || 0}</strong></div>
            <div style={s.digestMetric}><span>P2</span><strong>{openOwnerSummary.p2 || 0}</strong></div>
            <div style={s.digestMetric}><span>Po SLA</span><strong>{openOwnerSummary.overdue || 0}</strong></div>
          </div>
          <div style={s.ownerAckList}>
            {openOwnerItems.slice(0, 8).map((item) => (
              <div key={item.id || item.risk_id} style={s.ownerAckItem}>
                <div>
                  <strong>{item.escalation_level || item.escalation || 'P2'} / {item.type || item.risk_type || 'alert'} / {item.sla_status || 'ok'}</strong>
                  <div style={s.subLine}>{item.owner_label || 'Owner: operacje'} / {item.aging_minutes ?? item.age_minutes ?? '-'} min / {item.risk_id || '-'}</div>
                </div>
                <div style={s.ownerAckMeta}>
                  <span>{item.numer || '-'}</span>
                  <span>{item.klient_nazwa || '-'}</span>
                </div>
              </div>
            ))}
            {!ownerAlertsLoading && !openOwnerItems.length ? (
              <div style={s.emptyLine}>Brak niedomknietych alertow ownerow Kommo/SMS.</div>
            ) : null}
          </div>
        </section>

        <section className="kontrola-panel kontrola-owner-remediation" style={s.digestPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.h2}>Skutecznosc remediacji ownerow</h2>
              <p style={s.muted}>Retry Kommo i ponowienia SMS uruchomione po eskalacji ownera, z blokadami limitu dziennego.</p>
            </div>
            <span style={s.badge}>{ownerRemediationSummary.success || 0} skutecznych</span>
          </div>
          <div style={s.ownerAlertSummary}>
            <div style={s.digestMetric}><span>Retry Kommo</span><strong>{ownerRemediationSummary.retry_kommo || 0}</strong></div>
            <div style={s.digestMetric}><span>Ponowienia SMS</span><strong>{ownerRemediationSummary.resend_sms || 0}</strong></div>
            <div style={s.digestMetric}><span>Sukcesy</span><strong>{ownerRemediationSummary.success || 0}</strong></div>
            <div style={s.digestMetric}><span>Bledy</span><strong>{ownerRemediationSummary.failed || 0}</strong></div>
            <div style={s.digestMetric}><span>Limit</span><strong>{ownerRemediationSummary.limit_blocks || 0}</strong></div>
            <div style={s.digestMetric}><span>Nierozwiazane P1/P2</span><strong>{(openOwnerSummary.p1 || 0) + (openOwnerSummary.p2 || 0)}</strong></div>
          </div>
          <div style={s.ownerAckList}>
            {ownerRemediationItems.slice(0, 6).map((item) => (
              <div key={`rem-${item.id}`} style={s.ownerAckItem}>
                <div>
                  <strong>{item.remediation_action || item.action_type} / {item.blocked ? 'blokada' : item.success ? 'sukces' : 'blad'}</strong>
                  <div style={s.subLine}>{item.risk_type || '-'} / {item.risk_id || '-'} / {formatDateTime(item.created_at)}</div>
                </div>
                <div style={s.ownerAckMeta}>
                  <span>{item.numer || '-'}</span>
                  <span>{item.block_reason || item.klient_nazwa || '-'}</span>
                </div>
              </div>
            ))}
            {!ownerRemediationItems.length ? <div style={s.emptyLine}>Brak auto-remediacji ownerow w wybranym zakresie.</div> : null}
          </div>
        </section>

        <section className="kontrola-panel kontrola-owner-acks" style={s.digestPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.h2}>Rejestr potwierdzen ownerow</h2>
              <p style={s.muted}>Potwierdzenia alertow Kommo/SMS zapisane w `ops_action_events` z ownerem, ryzykiem i oddzialem.</p>
            </div>
            <span style={s.badge}>{ownerAckRows.length} potwierdzen</span>
          </div>
          <div style={s.ownerAckList}>
            {ownerAckRows.slice(0, 8).map((item) => (
              <div key={`ack-${item.id}`} style={s.ownerAckItem}>
                <div>
                  <strong>{item.risk_type || item.issue_label || 'risk_report'}</strong>
                  <div style={s.subLine}>{item.actor_name || '-'} / {item.oddzial_nazwa || item.oddzial_id || 'global'} / {formatDateTime(item.created_at)}</div>
                </div>
                <div style={s.ownerAckMeta}>
                  <span>{item.risk_id || '-'}</span>
                  <span>{item.numer || '-'}</span>
                </div>
              </div>
            ))}
            {!ownerAckRows.length ? <div style={s.emptyLine}>Brak potwierdzen ownerow dla wybranych filtrow.</div> : null}
          </div>
        </section>

        {digest ? (
          <section className="kontrola-panel kontrola-digest-preview" style={s.digestPanel}>
            <div style={s.panelHeader}>
              <div>
                <h2 style={s.h2}>Digest dyrektora</h2>
                <p style={s.muted}>Dzienny skrot alertow, decyzji operacyjnych i akcji Zadarma dla daty {digest.date}.</p>
              </div>
              <span style={s.badge}>{digest.summary?.high_alerts || 0} pilne / {digest.summary?.medium_alerts || 0} uwaga</span>
            </div>
            <div style={s.digestGrid}>
              <div style={s.digestMetric}><span>Zlecenia dzis</span><strong>{digest.summary?.today_tasks || 0}</strong></div>
              <div style={s.digestMetric}><span>Ryzyka marzy</span><strong>{digest.summary?.margin_risks || 0}</strong></div>
              <div style={s.digestMetric}><span>Decyzje oper.</span><strong>{digest.summary?.operational_decisions || 0}</strong></div>
              <div style={s.digestMetric}><span>Zadarma/SMS</span><strong>{digest.summary?.zadarma_actions || 0}</strong></div>
              <div style={s.digestMetric}>
                <span>Potwierdzenia ownerow</span>
                <strong>{digest.summary?.owner_acknowledgements || 0}</strong>
                <small style={s.subLine}>Kommo {digest.summary?.kommo_owner_acknowledgements || 0} / SMS {digest.summary?.sms_owner_acknowledgements || 0}</small>
              </div>
              <div style={s.digestMetric}>
                <span>Nierozwiazane P1/P2 po remediacji</span>
                <strong>{digest.summary?.owner_unresolved_after_remediation || 0}</strong>
                <small style={s.subLine}>P1 {digest.summary?.owner_unresolved_p1 || 0} / P2 {digest.summary?.owner_unresolved_p2 || 0}</small>
              </div>
            </div>
            <div style={s.digestList}>
              {(digest.alerts || []).slice(0, 5).map((alert) => (
                <div key={`${alert.type}-${alert.title}`} style={s.digestAlert}>
                  <strong>{alert.title}: {alert.count}</strong>
                  <span>{alert.action}</span>
                </div>
              ))}
              {!(digest.alerts || []).length ? <div style={s.emptyLine}>Brak krytycznych alertow w digestcie.</div> : null}
            </div>
          </section>
        ) : null}

        {canChooseBranch ? (
          <section className="kontrola-panel kontrola-digest-config" style={s.digestPanel}>
            <div style={s.panelHeader}>
              <div>
                <h2 style={s.h2}>Konfiguracja digestu</h2>
                <p style={s.muted}>Odbiorcy, godzina i tryb email dla automatycznego raportu operacyjnego.</p>
              </div>
              <span style={s.badge}>{digestSettings.length || 1} konfiguracji</span>
            </div>
            <form style={s.settingsForm} onSubmit={saveDigestConfig}>
              <label style={s.field}>
                <span style={s.label}>Zakres</span>
                <select style={s.input} value={settingsForm.branch_id} onChange={(e) => setSettingsForm((f) => ({ ...f, branch_id: e.target.value }))}>
                  <option value="">Globalny</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.nazwa || `Oddzial #${branch.id}`}</option>
                  ))}
                </select>
              </label>
              <label style={s.field}>
                <span style={s.label}>Godzina</span>
                <input style={s.input} type="time" value={settingsForm.send_time} onChange={(e) => setSettingsForm((f) => ({ ...f, send_time: e.target.value }))} />
              </label>
              <label style={s.checkField}>
                <input type="checkbox" checked={settingsForm.enabled} onChange={(e) => setSettingsForm((f) => ({ ...f, enabled: e.target.checked }))} />
                Wlaczony
              </label>
              <label style={s.checkField}>
                <input type="checkbox" checked={settingsForm.email_enabled} onChange={(e) => setSettingsForm((f) => ({ ...f, email_enabled: e.target.checked }))} />
                Email
              </label>
              <label style={s.field}>
                <span style={s.label}>Horyzont dni</span>
                <input style={s.input} type="number" min="1" max="14" value={settingsForm.horizon_days} onChange={(e) => setSettingsForm((f) => ({ ...f, horizon_days: e.target.value }))} />
              </label>
              <label style={s.field}>
                <span style={s.label}>Flota dni</span>
                <input style={s.input} type="number" min="1" max="90" value={settingsForm.fleet_lookahead_days} onChange={(e) => setSettingsForm((f) => ({ ...f, fleet_lookahead_days: e.target.value }))} />
              </label>
              <label style={{ ...s.field, minWidth: 220, flex: '1 1 260px' }}>
                <span style={s.label}>ID odbiorcow</span>
                <input style={s.input} value={settingsForm.recipient_user_ids} onChange={(e) => setSettingsForm((f) => ({ ...f, recipient_user_ids: e.target.value }))} placeholder="np. 1, 7, 12" />
              </label>
              <label style={{ ...s.field, minWidth: 260, flex: '1 1 300px' }}>
                <span style={s.label}>Dodatkowe emaile</span>
                <input style={s.input} value={settingsForm.extra_emails} onChange={(e) => setSettingsForm((f) => ({ ...f, extra_emails: e.target.value }))} placeholder="dyrektor@firma.pl" />
              </label>
              <button type="submit" style={s.primaryBtn} disabled={settingsSaving}>{settingsSaving ? 'Zapis...' : 'Zapisz konfiguracje'}</button>
            </form>
          </section>
        ) : null}

        <section className="kontrola-panel kontrola-digest-history" style={s.digestPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.h2}>Historia digestu</h2>
              <p style={s.muted}>Ostatnie uruchomienia automatycznego raportu dla dyrekcji i oddzialow.</p>
            </div>
            <span style={s.badge}>{digestHistory.total || 0} zapisow</span>
          </div>
          <div style={s.runList}>
            {(digestHistory.items || []).map((run) => (
              <div key={run.id} style={s.runItem}>
                <div>
                  <strong>{formatDateTime(run.created_at)}</strong>
                  <div style={s.subLine}>{run.scope === 'branch' ? (run.branch_name || `Oddzial #${run.branch_id}`) : 'Globalny'} / {run.trigger_type || 'manual'}</div>
                </div>
                <div style={s.runNumbers}>
                  <span>{run.high_alerts || 0} pilne</span>
                  <span>{run.recipients || 0} odb.</span>
                  <span>{run.emails_sent || 0} email</span>
                </div>
              </div>
            ))}
            {!(digestHistory.items || []).length ? <div style={s.emptyLine}>Brak zapisanej historii digestu.</div> : null}
          </div>
        </section>

        <section className="kontrola-panel kontrola-register" style={s.panel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.h2}>Rejestr decyzji</h2>
              <p style={s.muted}>Pokazuje realne akcje wykonane z raportu ryzyk dnia oraz plan-vs-real.</p>
            </div>
            <span style={s.badge}>{loading ? 'Ladowanie' : `${items.length} wierszy`}</span>
          </div>

          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Data</th>
                  <th style={s.th}>Oddzial</th>
                  <th style={s.th}>Operator</th>
                  <th style={s.th}>Decyzja</th>
                  <th style={s.th}>Zlecenie</th>
                  <th style={s.th}>Wynik</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={s.tr}>
                    <td style={s.td}>{formatDateTime(item.created_at)}</td>
                    <td style={s.td}>{item.oddzial_nazwa || item.oddzial_id || '-'}</td>
                    <td style={s.td}>{item.actor_name || '-'}</td>
                    <td style={s.td}>
                      <strong>{item.action_label || item.action_type}</strong>
                      <div style={s.subLine}>{item.risk_type || item.issue_label || '-'}</div>
                    </td>
                    <td style={s.td}>
                      <a style={s.link} href={`#${item.action_path || `/zlecenia/${item.task_id}`}`}>{item.numer || '-'}</a>
                      <div style={s.subLine}>{item.klient_nazwa || '-'}</div>
                    </td>
                    <td style={s.td}>{item.outcome || item.note || '-'}</td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td style={s.empty} colSpan={6}>Brak decyzji dla wybranych filtrow.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

const s = {
  layout: { display: 'flex', minHeight: '100vh', background: 'linear-gradient(135deg, #f6faf7 0%, #ffffff 46%, #eaf4ee 100%)' },
  main: { flex: 1, width: '100%', maxWidth: 1480, margin: '0 auto', padding: '22px clamp(16px, 2.4vw, 30px) 32px', minWidth: 0 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid rgba(20,131,79,0.24)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', borderRadius: 8, padding: '9px 13px', fontWeight: 850, cursor: 'pointer', boxShadow: '0 8px 18px rgba(20,131,79,0.16)' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid rgba(15,95,58,0.16)', background: '#ffffff', color: 'var(--text)', borderRadius: 8, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  iconBtn: { width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(15,95,58,0.16)', background: '#ffffff', color: 'var(--text)', borderRadius: 8, cursor: 'pointer' },
  filters: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 18, padding: 16, border: '1px solid rgba(15,95,58,0.13)', background: 'linear-gradient(90deg, rgba(15,107,63,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(15,107,63,0.035) 1px, transparent 1px), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,249,244,0.94))', backgroundSize: '32px 32px, 32px 32px, auto', borderRadius: 8, boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 },
  label: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' },
  input: { minHeight: 40, border: '1px solid rgba(15,95,58,0.16)', borderRadius: 8, background: '#ffffff', color: 'var(--text)', padding: '0 10px', fontSize: 14 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 },
  kpi: { border: '1px solid rgba(15,95,58,0.13)', background: '#ffffff', borderRadius: 8, padding: 15, boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  kpiLabel: { display: 'block', color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 },
  kpiValue: { fontSize: 28, lineHeight: 1, color: 'var(--text)' },
  digestPanel: { border: '1px solid rgba(15,95,58,0.13)', background: '#ffffff', borderRadius: 8, overflow: 'hidden', marginBottom: 18, boxShadow: '0 12px 30px rgba(31,79,50,0.065)' },
  digestGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, padding: 16, borderBottom: '1px solid rgba(15,95,58,0.1)' },
  digestMetric: { border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, padding: 12, background: 'rgba(241,249,244,0.68)' },
  digestList: { display: 'grid', gap: 8, padding: 16 },
  digestAlert: { display: 'grid', gap: 4, padding: 12, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: 'rgba(241,249,244,0.58)' },
  ownerAlertSummary: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, padding: 16, borderBottom: '1px solid rgba(15,95,58,0.1)' },
  settingsForm: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', padding: 16 },
  checkField: { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40, color: 'var(--text)', fontWeight: 700 },
  runList: { display: 'grid', gap: 8, padding: 16 },
  runItem: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: 12, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: 'rgba(241,249,244,0.5)' },
  runNumbers: { display: 'flex', gap: 8, flexWrap: 'wrap', color: 'var(--text-sub)', fontSize: 12, fontWeight: 700 },
  ownerAckList: { display: 'grid', gap: 8, padding: 16 },
  ownerAckItem: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: 12, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: 'rgba(241,249,244,0.5)' },
  ownerAckMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, justifyContent: 'flex-end' },
  emptyLine: { color: 'var(--text-sub)', fontSize: 13 },
  panel: { border: '1px solid rgba(15,95,58,0.13)', background: '#ffffff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 30px rgba(31,79,50,0.065)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 18, borderBottom: '1px solid rgba(15,95,58,0.1)' },
  panelActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' },
  h2: { margin: 0, fontSize: 19 },
  muted: { margin: '5px 0 0', color: 'var(--text-sub)', fontSize: 13 },
  badge: { border: '1px solid rgba(15,95,58,0.14)', borderRadius: 999, padding: '5px 10px', fontSize: 12, color: 'var(--accent)', background: 'var(--accent-surface)', fontWeight: 800, whiteSpace: 'nowrap' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 860 },
  th: { textAlign: 'left', padding: '11px 14px', fontSize: 12, color: 'var(--text-sub)', textTransform: 'uppercase', borderBottom: '1px solid rgba(15,95,58,0.1)', background: 'rgba(241,249,244,0.76)' },
  tr: { borderBottom: '1px solid rgba(15,95,58,0.09)' },
  td: { padding: '13px 14px', verticalAlign: 'top', color: 'var(--text)', fontSize: 14 },
  subLine: { marginTop: 3, color: 'var(--text-sub)', fontSize: 12 },
  link: { color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' },
  empty: { padding: 30, textAlign: 'center', color: 'var(--text-sub)' },
};
