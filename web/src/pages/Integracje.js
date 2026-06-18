import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const EMPTY_STATS = { total: 0, sent_demo: 0, byChannel: { sms: 0, email: 0, push: 0 } };
const ROLLBACK_MAX_AGE_DAYS = 14;
const CRM_REACTION_AUDIT_MAX_AGE_DAYS = 30;
const CRM_CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Facebook Messenger' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'E-mail' },
  { value: 'webchat', label: 'Webchat' },
];
const KOMMO_DEFAULT_CONFIG = {
  account_key: 'default',
  status_map: {},
  field_aliases: {},
  options: {
    auto_geocode: true,
    save_remote_attachments_as_documents: true,
    copy_attachment_binaries_to_storage: false,
  },
};

function parseJsonObject(text, fallback = {}) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function Integracje() {
  const navigate = useNavigate();
  const { message, showMessage } = useTimedMessage();
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ channel: '', status: '', task_id: '' });
  const [selectedLogIds, setSelectedLogIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [retryAudit, setRetryAudit] = useState([]);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTs, setNowTs] = useState(Date.now());
  const [security, setSecurity] = useState({ denylist: { users: [], channels: [] }, denylist_history: [] });
  const [users, setUsers] = useState([]);
  const [securityForm, setSecurityForm] = useState({ users: [], channels: [] });
  const [historyFilters, setHistoryFilters] = useState({ actor: '', action: '' });
  const [rollbackConfirmId, setRollbackConfirmId] = useState(null);
  const [crmApps, setCrmApps] = useState([]);
  const [crmEvents, setCrmEvents] = useState([]);
  const [crmIntegrationAudits, setCrmIntegrationAudits] = useState([]);
  const [branchSetupStatuses, setBranchSetupStatuses] = useState([]);
  const [crmAppForm, setCrmAppForm] = useState({ name: 'Landing widget', type: 'widget', oddzial_id: '' });
  const [crmChannelForm, setCrmChannelForm] = useState({
    channel: 'whatsapp',
    provider: 'meta',
    oddzial_id: '',
    handle: '',
  });
  const [latestCrmChannelPackage, setLatestCrmChannelPackage] = useState('');
  const [crmChannelTestingId, setCrmChannelTestingId] = useState(null);
  const [crmChannelTogglingId, setCrmChannelTogglingId] = useState(null);
  const [branchInboxCreatingId, setBranchInboxCreatingId] = useState(null);
  const [branchSetupFilter, setBranchSetupFilter] = useState('todo');
  const [branchSetupShowAll, setBranchSetupShowAll] = useState(false);
  const [expandedBranchHistoryId, setExpandedBranchHistoryId] = useState(null);
  const [kommoBranchFilter, setKommoBranchFilter] = useState('');
  const [kommoAckSavingId, setKommoAckSavingId] = useState(null);
  const [kommoSync, setKommoSync] = useState({ queue: [], inbound_events: [], summary: {} });
  const [kommoConfig, setKommoConfig] = useState(KOMMO_DEFAULT_CONFIG);
  const [kommoConfigForm, setKommoConfigForm] = useState({
    account_key: 'default',
    status_map: '{}',
    field_aliases: '{}',
    options: JSON.stringify(KOMMO_DEFAULT_CONFIG.options, null, 2),
  });

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const headers = authHeaders(token);
      const query = new URLSearchParams();
      if (filters.channel) query.set('channel', filters.channel);
      if (filters.status) query.set('status', filters.status);
      if (filters.task_id) query.set('task_id', filters.task_id);
      query.set('page', String(page));
      query.set('page_size', String(pageSize));
      query.set('sort_by', sortBy);
      query.set('sort_dir', sortDir);
      const [sRes, lRes] = await Promise.all([
        api.get('/integrations/stats', { headers }),
        api.get(`/integrations/logs${query.toString() ? `?${query.toString()}` : ''}`, { headers }),
      ]);
      const aRes = await api.get('/integrations/retry-audit', { headers });
      const [secRes, usersRes] = await Promise.all([
        api.get('/integrations/security', { headers }).catch(() => ({ data: { denylist: { users: [], channels: [] }, denylist_history: [] } })),
        api.get('/uzytkownicy', { headers }).catch(() => ({ data: [] })),
      ]);
      const [crmAppsRes, crmEventsRes] = await Promise.all([
        api.get('/crm/integrations/apps', { headers, params: { include_inactive: true } }).catch(() => ({ data: [] })),
        api.get('/crm/integrations/events', { headers }).catch(() => ({ data: [] })),
      ]);
      const [crmBranchAuditRes, crmAppAuditRes] = await Promise.all([
        api.get('/audit', { headers, params: { entity_type: 'crm_branch_setup', limit: 100 } }).catch(() => ({ data: { items: [] } })),
        api.get('/audit', { headers, params: { entity_type: 'crm_integration_app', limit: 100 } }).catch(() => ({ data: { items: [] } })),
      ]);
      const branchSetupRes = await api.get('/telephony/voice-agent/polska-flora/integrations/status', { headers }).catch(() => ({
        data: { items: [] },
      }));
      const kommoParams = kommoBranchFilter ? { oddzial_id: Number(kommoBranchFilter) } : {};
      const kommoSyncRes = await api.get('/tasks/kommo-sync/diagnostics', { headers, params: kommoParams }).catch(() => ({
        data: { queue: [], inbound_events: [], summary: {} },
      }));
      const kommoConfigRes = await api.get('/kommo/config?account_key=default', { headers }).catch(() => ({
        data: KOMMO_DEFAULT_CONFIG,
      }));
      setStats(sRes.data || EMPTY_STATS);
      const items = Array.isArray(lRes.data?.items) ? lRes.data.items : [];
      setLogs(items);
      setTotalPages(Number(lRes.data?.total_pages) || 1);
      setTotalRows(Number(lRes.data?.total) || 0);
      setRetryAudit(Array.isArray(aRes.data) ? aRes.data : []);
      setSecurity(secRes.data || { denylist: { users: [], channels: [] }, denylist_history: [] });
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setSecurityForm({
        users: Array.isArray(secRes.data?.denylist?.users) ? secRes.data.denylist.users : [],
        channels: Array.isArray(secRes.data?.denylist?.channels) ? secRes.data.denylist.channels : [],
      });
      setCrmApps(Array.isArray(crmAppsRes.data) ? crmAppsRes.data : []);
      setCrmEvents(Array.isArray(crmEventsRes.data) ? crmEventsRes.data : []);
      const mergedAudits = [
        ...(Array.isArray(crmBranchAuditRes.data?.items) ? crmBranchAuditRes.data.items : []),
        ...(Array.isArray(crmAppAuditRes.data?.items) ? crmAppAuditRes.data.items : []),
      ];
      setCrmIntegrationAudits(Array.from(new Map(mergedAudits.map((item) => [
        item.id != null ? `id:${item.id}` : `${item.entity_type || ''}:${item.entity_id || ''}:${item.action || ''}:${item.created_at || ''}`,
        item,
      ])).values()).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
      setBranchSetupStatuses(Array.isArray(branchSetupRes.data?.items) ? branchSetupRes.data.items : []);
      setKommoSync({
        queue: Array.isArray(kommoSyncRes.data?.queue) ? kommoSyncRes.data.queue : [],
        inbound_events: Array.isArray(kommoSyncRes.data?.inbound_events) ? kommoSyncRes.data.inbound_events : [],
        summary: kommoSyncRes.data?.summary || {},
      });
      const nextKommoConfig = kommoConfigRes.data && !Array.isArray(kommoConfigRes.data)
        ? { ...KOMMO_DEFAULT_CONFIG, ...kommoConfigRes.data }
        : KOMMO_DEFAULT_CONFIG;
      setKommoConfig(nextKommoConfig);
      setKommoConfigForm({
        account_key: nextKommoConfig.account_key || 'default',
        status_map: JSON.stringify(nextKommoConfig.status_map || {}, null, 2),
        field_aliases: JSON.stringify(nextKommoConfig.field_aliases || {}, null, 2),
        options: JSON.stringify(nextKommoConfig.options || KOMMO_DEFAULT_CONFIG.options, null, 2),
      });
      setSelectedLogIds([]);
    } catch (err) {
      showMessage(errorMessage('Błąd ładowania integracji'));
    } finally {
      setLoading(false);
    }
  }, [filters.channel, filters.status, filters.task_id, kommoBranchFilter, page, pageSize, sortBy, sortDir, navigate, showMessage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => {
      loadData();
    }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, loadData]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const retryLog = async (id) => {
    try {
      const token = getStoredToken();
      await api.post(`/integrations/logs/${id}/retry`, {}, { headers: authHeaders(token) });
      showMessage(successMessage('Retry wysłany (demo).'));
      loadData();
    } catch (err) {
      const retryAfter = Number(err?.response?.data?.retry_after_ms || 0);
      if (err?.response?.status === 429 && retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter);
        showMessage(errorMessage(`Rate limit retry. Spróbuj ponownie za ${Math.ceil(retryAfter / 1000)}s.`));
        return;
      }
      showMessage(errorMessage('Błąd retry logu'));
    }
  };

  const retryBatch = async () => {
    if (!selectedLogIds.length) {
      showMessage(errorMessage('Zaznacz logi do retry.'));
      return;
    }
    try {
      const token = getStoredToken();
      const res = await api.post('/integrations/logs/retry-batch', { ids: selectedLogIds }, { headers: authHeaders(token) });
      if (res.data?.rate_limited && Number(res.data?.retry_after_ms || 0) > 0) {
        setCooldownUntil(Date.now() + Number(res.data.retry_after_ms));
      }
      showMessage(successMessage(`Retry batch wykonany: ${res.data?.retried || 0}`));
      loadData();
    } catch (err) {
      const retryAfter = Number(err?.response?.data?.retry_after_ms || 0);
      if (err?.response?.status === 429 && retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter);
        showMessage(errorMessage(`Rate limit retry. Spróbuj ponownie za ${Math.ceil(retryAfter / 1000)}s.`));
        return;
      }
      showMessage(errorMessage('Błąd retry batch'));
    }
  };

  const exportCsv = () => {
    const token = getStoredToken();
    if (!token) return;
    const q = new URLSearchParams();
    if (filters.channel) q.set('channel', filters.channel);
    if (filters.status) q.set('status', filters.status);
    if (filters.task_id) q.set('task_id', filters.task_id);
    api.get(`/integrations/logs/export${q.toString() ? `?${q.toString()}` : ''}`, { headers: authHeaders(token), responseType: 'blob' })
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `integracje-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => showMessage(errorMessage('Błąd eksportu CSV')));
  };

  const saveDenylist = async () => {
    try {
      const token = getStoredToken();
      await api.patch('/integrations/security/denylist', securityForm, { headers: authHeaders(token) });
      showMessage(successMessage('Denylist zapisana.'));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Brak uprawnień lub błąd zapisu denylisty.'));
    }
  };

  const acknowledgeKommoRisk = async (row, source = 'queue') => {
    const id = `${source}:${row.id}`;
    setKommoAckSavingId(id);
    try {
      const token = getStoredToken();
      const riskType = source === 'inbound' ? 'kommo_inbound' : 'kommo_sync';
      await api.post('/ops/risk-report/actions', {
        action: 'acknowledge',
        risk_type: riskType,
        risk_id: `${riskType}:${row.id}`,
        task_id: row.task_id || undefined,
        note: `${row.owner_label || 'Owner Kommo'} potwierdzil alert w panelu Integracje.`,
      }, { headers: authHeaders(token) });
      showMessage(successMessage('Alert Kommo potwierdzony i zapisany w decyzjach operacyjnych.'));
      await loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie potwierdzic alertu Kommo.'));
    } finally {
      setKommoAckSavingId(null);
    }
  };

  const createCrmApp = async () => {
    try {
      const token = getStoredToken();
      const body = {
        name: crmAppForm.name,
        type: crmAppForm.type,
        oddzial_id: crmAppForm.oddzial_id ? Number(crmAppForm.oddzial_id) : undefined,
        config: { source: crmAppForm.name },
      };
      const res = await api.post('/crm/integrations/apps', body, { headers: authHeaders(token) });
      showMessage(successMessage(`Utworzono integrację CRM. Token: ${res.data?.token || ''}`));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udało się utworzyć integracji CRM.'));
    }
  };

  const buildCrmChannelPackage = (app, form = crmChannelForm) => JSON.stringify({
    channel: form.channel,
    provider: form.provider || 'external',
    oddzial_id: form.oddzial_id ? Number(form.oddzial_id) : null,
    handle: form.handle || null,
    webhook: {
      url: app?.webhook_path || '',
      method: 'POST',
      token: app?.token || '',
      token_note: app?.token ? 'Token zwrocony przy tworzeniu kanalu.' : 'Token jest zaszyty w URL webhooka albo do pobrania przez administratora.',
    },
    unified_inbox_payload: {
      event_type: 'message.received',
      external_id: 'provider-message-id',
      channel: form.channel,
      title: 'Nowa rozmowa z klientem',
      client_name: 'Jan Kowalski',
      phone: '+48123123123',
      email: form.channel === 'email' ? 'jan@example.com' : '',
      sender_name: 'Jan Kowalski',
      sender_handle: '+48123123123',
      message: 'Prosze o kontakt w sprawie wyceny.',
      source: `${form.channel}.${form.provider || 'external'}`,
      tags: ['unified-inbox', form.channel],
    },
    notes: [
      'Kazdy oddzial moze miec osobny webhook/token dla tego samego kanalu.',
      'Wysylaj inbound message na webhook po odebraniu wiadomosci od klienta.',
      'Pole channel decyduje, w ktorej sciezce Unified Inbox pojawi sie rozmowa.',
      'external_id powinien byc unikalny po stronie providera.',
    ],
  }, null, 2);

  const copyCrmChannelPackage = async (text = latestCrmChannelPackage) => {
    if (!text) {
      showMessage(errorMessage('Najpierw utworz kanal Unified Inbox.'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showMessage(successMessage('Paczka kanalu skopiowana.'));
    } catch {
      showMessage(errorMessage('Nie udalo sie skopiowac paczki kanalu.'));
    }
  };

  const getCrmChannelFormFromApp = (app) => {
    const config = app?.config && typeof app.config === 'object' ? app.config : {};
    return {
      channel: String(config.channel || 'webchat').toLowerCase(),
      provider: config.provider || app?.type || 'external',
      oddzial_id: app?.oddzial_id ? String(app.oddzial_id) : '',
      handle: config.handle || '',
    };
  };

  const copyCrmChannelPackageForApp = async (app) => {
    const pack = buildCrmChannelPackage(app, getCrmChannelFormFromApp(app));
    setLatestCrmChannelPackage(pack);
    await copyCrmChannelPackage(pack);
  };

  const formatCrmAppHealth = (app) => {
    const count = Number(app?.event_count || 0);
    if (!count) return 'brak eventow';
    const lastAt = app?.last_event_at ? new Date(app.last_event_at).toLocaleString('pl-PL') : 'brak daty';
    const status = app?.last_event_status || 'status nieznany';
    return `${count} eventow / ostatni: ${status} / ${lastAt}`;
  };

  const formatCrmAuditAction = (action) => ({
    'crm.integration.app_created': 'Utworzono kanal',
    'crm.integration.app_enabled': 'Wlaczono kanal',
    'crm.integration.app_paused': 'Wstrzymano kanal',
    'crm.integration.branch_inbox_created_and_tested': 'Utworzono i przetestowano Inbox',
    'crm.integration.branch_history_copied': 'Skopiowano historie',
    'crm.integration.branch_package_copied': 'Skopiowano komplet',
    'crm.integration.branch_packages_copied': 'Skopiowano komplety',
  }[action] || action || 'Brak audytu');

  const logCrmIntegrationAudit = async ({ action, entityType = 'crm_branch_setup', entityId, metadata }) => {
    try {
      const token = getStoredToken();
      if (!token) return;
      await api.post('/audit/client-event', {
        action,
        entity_type: entityType,
        entity_id: entityId != null ? String(entityId) : null,
        metadata,
      }, { headers: authHeaders(token) });
    } catch {
      // Audyt panelowy nie blokuje pracy operatora.
    }
  };

  const branchSetupRows = useMemo(() => branchSetupStatuses.map((branch) => {
    const oddzialId = Number(branch.oddzial_id || 0);
    const crmChannels = crmApps.filter((app) => app?.config?.unified_inbox && Number(app.oddzial_id || 0) === oddzialId);
    const activeCrmChannels = crmChannels.filter((app) => app.active === true);
    const channelIds = new Set(crmChannels.map((app) => String(app.id)));
    const audits = crmIntegrationAudits.filter((item) => {
      const metaOddzial = item?.metadata?.oddzial_id ?? item?.oddzial_id;
      if (String(metaOddzial || '') === String(oddzialId)) return true;
      return item?.entity_type === 'crm_integration_app' && channelIds.has(String(item.entity_id || ''));
    });
    const lastAudit = audits[0] || (
      crmChannels[0]
        ? {
          action: 'crm.integration.app_created',
          created_at: crmChannels[0].created_at || crmChannels[0].updated_at || null,
        }
        : null
    );
    const lastAuditAtMs = lastAudit?.created_at ? new Date(lastAudit.created_at).getTime() : 0;
    const auditIsStale = !lastAuditAtMs || Number.isNaN(lastAuditAtMs) || (Date.now() - lastAuditAtMs > CRM_REACTION_AUDIT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const hasAgent = branch.integration_status === 'active';
    const hasPhone = Boolean(String(branch.telefon || '').trim());
    const hasSms = Boolean(String(branch.sms_sender_id || branch.telefon || '').trim());
    const rawLastTest = String(branch.last_test_log_status || branch.last_test_status || '').toLowerCase();
    const lastTestOk = rawLastTest === 'ok';
    const testStatusLabel = lastTestOk ? 'Test wyslany' : (rawLastTest ? 'Test nieudany' : 'Brak testu');
    const testStatusTone = lastTestOk ? 'success' : (rawLastTest ? 'danger' : 'warning');
    const blockers = [
      hasAgent ? null : 'agent AI',
      hasPhone ? null : 'telefon oddzialu',
      hasSms ? null : 'SMS sender',
      activeCrmChannels.length ? null : 'kanal inbox',
      lastTestOk ? null : 'test',
    ].filter(Boolean);
    const reactionReasons = [
      ...blockers,
      crmChannels.length > activeCrmChannels.length ? 'kanal w pauzie' : null,
      auditIsStale ? 'audyt podpiecia' : null,
    ].filter(Boolean);
    const ready = blockers.length === 0;
    return {
      ...branch,
      ready,
      blockers,
      crmChannels,
      activeCrmChannels,
      audits,
      lastAudit,
      reactionReasons,
      requiresReaction: reactionReasons.length > 0,
      readyCount: [hasAgent, hasPhone, hasSms, activeCrmChannels.length > 0, lastTestOk].filter(Boolean).length,
      testStatusLabel,
      testStatusTone,
    };
  }).sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? 1 : -1;
    if (a.readyCount !== b.readyCount) return a.readyCount - b.readyCount;
    if (a.blockers.length !== b.blockers.length) return b.blockers.length - a.blockers.length;
    return String(a.oddzial_name || '').localeCompare(String(b.oddzial_name || ''), 'pl');
  }), [branchSetupStatuses, crmApps, crmIntegrationAudits]);

  const branchSetupSummary = useMemo(() => branchSetupRows.reduce((acc, row) => {
    acc.total += 1;
    if (row.ready) acc.ready += 1;
    else acc.todo += 1;
    if (row.blockers.includes('kanal inbox')) acc.missingInbox += 1;
    if (row.blockers.includes('test')) acc.missingTest += 1;
    if (row.requiresReaction) acc.requiresReaction += 1;
    return acc;
  }, { total: 0, ready: 0, todo: 0, missingInbox: 0, missingTest: 0, requiresReaction: 0 }), [branchSetupRows]);

  const filteredBranchSetupRows = useMemo(() => {
    if (branchSetupFilter === 'ready') return branchSetupRows.filter((row) => row.ready);
    if (branchSetupFilter === 'todo') return branchSetupRows.filter((row) => !row.ready);
    if (branchSetupFilter === 'requires_reaction') return branchSetupRows.filter((row) => row.requiresReaction);
    if (branchSetupFilter === 'missing_inbox') return branchSetupRows.filter((row) => row.blockers.includes('kanal inbox'));
    if (branchSetupFilter === 'missing_test') return branchSetupRows.filter((row) => row.blockers.includes('test'));
    return branchSetupRows;
  }, [branchSetupFilter, branchSetupRows]);

  const visibleBranchSetupRows = branchSetupShowAll ? filteredBranchSetupRows : filteredBranchSetupRows.slice(0, 8);

  const copyBranchSetupGaps = async () => {
    const rows = filteredBranchSetupRows.filter((row) => !row.ready);
    if (!rows.length) {
      showMessage(successMessage('Brak brakow w aktualnym filtrze.'));
      return;
    }
    const text = [
      'Checklisty podpiecia oddzialow - braki',
      `Filtr: ${branchSetupFilter}`,
      ...rows.map((row) => [
        '',
        `${row.oddzial_name || `Oddzial #${row.oddzial_id}`}`,
        `- Gotowe: ${row.readyCount}/5`,
        `- Braki: ${row.blockers.join(', ')}`,
        `- Inbox: ${row.activeCrmChannels.length}/${row.crmChannels.length}`,
        `- Agent: ${row.integration_status || 'brak'}`,
        `- Ostatni test: ${row.last_test_log_status || row.last_test_status || 'brak'}`,
      ].join('\n')),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showMessage(successMessage('Braki oddzialow skopiowane.'));
    } catch {
      showMessage(errorMessage('Nie udalo sie skopiowac brakow oddzialow.'));
    }
  };

  const buildBranchSetupPackage = (row) => {
    const channels = row.crmChannels.length
      ? row.crmChannels.map((app) => {
        const config = app?.config && typeof app.config === 'object' ? app.config : {};
        return `- ${app.name || config.channel || 'kanal'} / ${app.active ? 'aktywny' : 'pauza'} / ${app.webhook_path || 'brak webhooka'}`;
      })
      : ['- brak kanalow Unified Inbox'];
    return [
      `Paczka podpiecia oddzialu: ${row.oddzial_name || `Oddzial #${row.oddzial_id}`}`,
      `Oddzial ID: ${row.oddzial_id || '-'}`,
      `Status: ${row.ready ? 'gotowy' : 'do dopiecia'}`,
      `Gotowe: ${row.readyCount}/5`,
      `Braki: ${row.blockers.length ? row.blockers.join(', ') : 'brak'}`,
      `Telefon oddzialu: ${row.telefon || 'brak'}`,
      `SMS sender: ${row.sms_sender_id || row.telefon || 'brak'}`,
      `Agent AI: ${row.integration_status || 'brak'}`,
      `Test: ${row.testStatusLabel}`,
      `Ostatni test techniczny: ${row.last_test_log_status || row.last_test_status || 'brak'}`,
      '',
      'Kanaly Unified Inbox:',
      ...channels,
      '',
      'Nastepne kroki:',
      ...(row.blockers.length ? row.blockers.map((item) => `- Dopiac: ${item}`) : ['- Oddzial gotowy do pracy end-to-end']),
    ].join('\n');
  };

  const buildBranchSetupHistory = (row) => {
    if (!row) return '';
    const auditLines = row.audits.length
      ? row.audits.map((item) => [
        `- ${item.created_at ? new Date(item.created_at).toLocaleString('pl-PL') : 'brak daty'} / ${formatCrmAuditAction(item.action)}`,
        `  Uzytkownik: ${item.user_login || item.user_id || 'system'}`,
        item.metadata?.webhook_path ? `  Webhook: ${item.metadata.webhook_path}` : null,
        item.metadata?.lead_id ? `  Lead testowy: #${item.metadata.lead_id}` : null,
        item.metadata?.blockers ? `  Braki: ${Array.isArray(item.metadata.blockers) ? item.metadata.blockers.join(', ') : item.metadata.blockers}` : null,
      ].filter(Boolean).join('\n'))
      : ['- Brak historii audytu dla oddzialu'];
    return [
      `Historia podpiecia: ${row.oddzial_name || `Oddzial #${row.oddzial_id}`}`,
      `Oddzial ID: ${row.oddzial_id || '-'}`,
      `Status teraz: ${row.ready ? 'gotowy' : 'do dopiecia'}`,
      `Reakcja: ${row.requiresReaction ? row.reactionReasons.join(', ') : 'nie wymaga'}`,
      '',
      ...auditLines,
    ].join('\n');
  };

  const copyBranchSetupHistory = async (row) => {
    const text = buildBranchSetupHistory(row);
    try {
      await navigator.clipboard.writeText(text);
      await logCrmIntegrationAudit({
        action: 'crm.integration.branch_history_copied',
        entityId: row.oddzial_id,
        metadata: {
          oddzial_id: row.oddzial_id,
          oddzial_name: row.oddzial_name || null,
          audit_count: row.audits.length,
        },
      });
      showMessage(successMessage(`Historia podpiecia skopiowana dla ${row.oddzial_name || 'oddzialu'}.`));
    } catch {
      showMessage(errorMessage('Nie udalo sie skopiowac historii podpiecia oddzialu.'));
    }
  };

  const copyBranchSetupPackage = async (row) => {
    if (!row) return;
    const text = buildBranchSetupPackage(row);
    try {
      await navigator.clipboard.writeText(text);
      await logCrmIntegrationAudit({
        action: 'crm.integration.branch_package_copied',
        entityId: row.oddzial_id,
        metadata: {
          oddzial_id: row.oddzial_id,
          oddzial_name: row.oddzial_name || null,
          ready: row.ready,
          ready_count: row.readyCount,
          blockers: row.blockers,
          channels: row.crmChannels.map((app) => ({ id: app.id, name: app.name, active: app.active, webhook_path: app.webhook_path })),
        },
      });
      showMessage(successMessage(`Paczka podpiecia skopiowana dla ${row.oddzial_name || 'oddzialu'}.`));
    } catch {
      showMessage(errorMessage('Nie udalo sie skopiowac paczki podpiecia oddzialu.'));
    }
  };

  const copyVisibleBranchSetupPackages = async () => {
    const rows = visibleBranchSetupRows;
    if (!rows.length) {
      showMessage(errorMessage('Brak widocznych oddzialow do skopiowania.'));
      return;
    }
    const text = [
      'Zbiorcze paczki podpiecia oddzialow',
      `Filtr: ${branchSetupFilter}`,
      `Widoczne oddzialy: ${rows.length}/${filteredBranchSetupRows.length}`,
      '',
      ...rows.map(buildBranchSetupPackage),
    ].join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      await logCrmIntegrationAudit({
        action: 'crm.integration.branch_packages_copied',
        entityId: 'visible',
        metadata: {
          filter: branchSetupFilter,
          visible_count: rows.length,
          total_in_filter: filteredBranchSetupRows.length,
          oddzial_ids: rows.map((row) => row.oddzial_id),
        },
      });
      showMessage(successMessage(`Skopiowano komplety podpiecia dla ${rows.length} oddzialow.`));
    } catch {
      showMessage(errorMessage('Nie udalo sie skopiowac kompletow podpiecia oddzialow.'));
    }
  };

  const exportBranchSetupCsv = () => {
    const rows = filteredBranchSetupRows;
    if (!rows.length) {
      showMessage(errorMessage('Brak danych checklisty do eksportu.'));
      return;
    }
    const header = ['oddzial_id', 'oddzial', 'gotowe', 'status', 'braki', 'inbox_aktywny', 'inbox_wszystkie', 'agent', 'telefon', 'sms_sender', 'ostatni_test'];
    const lines = [
      header.map(csvCell).join(';'),
      ...rows.map((row) => [
        row.oddzial_id,
        row.oddzial_name || '',
        `${row.readyCount}/5`,
        row.ready ? 'gotowy' : 'do_dopiecia',
        row.blockers.join(', '),
        row.activeCrmChannels.length,
        row.crmChannels.length,
        row.integration_status || '',
        row.telefon || '',
        row.sms_sender_id || '',
        row.last_test_log_status || row.last_test_status || '',
      ].map(csvCell).join(';')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklista-oddzialow-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showMessage(successMessage('Eksport checklisty gotowy.'));
  };

  const prepareInboxChannelForBranch = (row) => {
    setCrmChannelForm((prev) => ({
      ...prev,
      channel: 'whatsapp',
      provider: prev.provider || 'meta',
      oddzial_id: row?.oddzial_id ? String(row.oddzial_id) : '',
      handle: row?.telefon || prev.handle || '',
    }));
    showMessage(successMessage(`Formularz kanalu Inbox ustawiony dla ${row?.oddzial_name || 'oddzialu'}.`));
  };

  const createCrmChannelApp = async () => {
    try {
      const token = getStoredToken();
      const channelLabel = CRM_CHANNEL_OPTIONS.find((item) => item.value === crmChannelForm.channel)?.label || crmChannelForm.channel;
      const body = {
        name: `${channelLabel} / ${crmChannelForm.handle || 'Unified Inbox'}`,
        type: 'webhook',
        oddzial_id: crmChannelForm.oddzial_id ? Number(crmChannelForm.oddzial_id) : undefined,
        config: {
          source: 'unified-inbox-channel-wizard',
          channel: crmChannelForm.channel,
          provider: crmChannelForm.provider || 'external',
          handle: crmChannelForm.handle || null,
          unified_inbox: true,
        },
      };
      const res = await api.post('/crm/integrations/apps', body, { headers: authHeaders(token) });
      const pack = buildCrmChannelPackage(res.data, crmChannelForm);
      setLatestCrmChannelPackage(pack);
      await navigator.clipboard.writeText(pack).catch(() => {});
      showMessage(successMessage(`Kanal ${channelLabel} utworzony. Paczka do providera jest gotowa.`));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie utworzyc kanalu Unified Inbox.'));
    }
  };

  const createInboxChannelForBranch = async (row) => {
    if (!row?.oddzial_id) return;
    const form = {
      channel: 'whatsapp',
      provider: 'meta',
      oddzial_id: String(row.oddzial_id),
      handle: row.telefon || '',
    };
    setBranchInboxCreatingId(row.oddzial_id);
    try {
      const token = getStoredToken();
      const body = {
        name: `WhatsApp / ${row.telefon || row.oddzial_name || 'Unified Inbox'}`,
        type: 'webhook',
        oddzial_id: Number(row.oddzial_id),
        config: {
          source: 'unified-inbox-channel-wizard',
          channel: form.channel,
          provider: form.provider,
          handle: form.handle || null,
          unified_inbox: true,
        },
      };
      const res = await api.post('/crm/integrations/apps', body, { headers: authHeaders(token) });
      const createdApp = {
        ...res.data,
        name: body.name,
        type: body.type,
        config: body.config,
      };
      const pack = buildCrmChannelPackage(createdApp, form);
      const webhookPath = String(createdApp.webhook_path || '').replace(/^\/api(?=\/|$)/, '');
      const testRes = webhookPath ? await api.post(webhookPath, buildCrmChannelTestPayload(createdApp)) : null;
      setCrmChannelForm(form);
      setLatestCrmChannelPackage(pack);
      await navigator.clipboard.writeText(pack).catch(() => {});
      await logCrmIntegrationAudit({
        action: 'crm.integration.branch_inbox_created_and_tested',
        entityId: row.oddzial_id,
        metadata: {
          oddzial_id: row.oddzial_id,
          oddzial_name: row.oddzial_name || null,
          app_id: createdApp.id || null,
          webhook_path: createdApp.webhook_path || null,
          lead_id: testRes?.data?.lead_id || null,
          channel: form.channel,
          provider: form.provider,
        },
      });
      showMessage(successMessage(`Kanal Inbox utworzony i przetestowany dla ${row.oddzial_name || 'oddzialu'}. Lead #${testRes?.data?.lead_id || '-'}. Paczka skopiowana.`));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie utworzyc albo przetestowac kanalu Inbox dla oddzialu.'));
    } finally {
      setBranchInboxCreatingId(null);
    }
  };

  const buildCrmChannelTestPayload = (app) => {
    const config = app?.config && typeof app.config === 'object' ? app.config : {};
    const channel = String(config.channel || 'webchat').toLowerCase();
    const handle = config.handle || (channel === 'email' ? 'jan.test@example.com' : '+48123123123');
    return {
      event_type: 'message.received',
      external_id: `test-${channel}-${Date.now()}`,
      channel,
      title: `Test ${channel} / ${app?.name || 'Unified Inbox'}`,
      client_name: 'Jan Testowy',
      phone: channel === 'email' ? '' : '+48123123123',
      email: channel === 'email' ? handle : '',
      sender_name: 'Jan Testowy',
      sender_handle: handle,
      message: `Testowa wiadomosc z kanalu ${channel}.`,
      source: `${channel}.${config.provider || app?.type || 'webhook'}.test`,
      tags: ['unified-inbox', 'test', channel],
    };
  };

  const sendCrmChannelTest = async (app) => {
    if (!app?.webhook_path) {
      showMessage(errorMessage('Brak webhooka dla kanalu.'));
      return;
    }
    setCrmChannelTestingId(app.id);
    try {
      const webhookPath = String(app.webhook_path).replace(/^\/api(?=\/|$)/, '');
      const payload = buildCrmChannelTestPayload(app);
      const res = await api.post(webhookPath, payload);
      showMessage(successMessage(`Test wyslany do Unified Inbox. Lead #${res.data?.lead_id || '-'}.`));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie wyslac testowej wiadomosci do Unified Inbox.'));
    } finally {
      setCrmChannelTestingId(null);
    }
  };

  const toggleCrmChannelApp = async (app) => {
    if (!app?.id) return;
    setCrmChannelTogglingId(app.id);
    try {
      const token = getStoredToken();
      await api.patch(`/crm/integrations/apps/${app.id}`, { active: app.active !== true }, { headers: authHeaders(token) });
      showMessage(successMessage(app.active ? 'Kanal Unified Inbox zatrzymany.' : 'Kanal Unified Inbox wlaczony.'));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie zmienic statusu kanalu Unified Inbox.'));
    } finally {
      setCrmChannelTogglingId(null);
    }
  };

  const saveKommoConfig = async () => {
    try {
      const token = getStoredToken();
      const body = {
        account_key: kommoConfigForm.account_key || 'default',
        status_map: parseJsonObject(kommoConfigForm.status_map),
        field_aliases: parseJsonObject(kommoConfigForm.field_aliases),
        options: parseJsonObject(kommoConfigForm.options, KOMMO_DEFAULT_CONFIG.options),
      };
      const res = await api.put('/kommo/config', body, { headers: authHeaders(token) });
      const next = { ...KOMMO_DEFAULT_CONFIG, ...(res.data || body) };
      setKommoConfig(next);
      setKommoConfigForm({
        account_key: next.account_key || 'default',
        status_map: JSON.stringify(next.status_map || {}, null, 2),
        field_aliases: JSON.stringify(next.field_aliases || {}, null, 2),
        options: JSON.stringify(next.options || KOMMO_DEFAULT_CONFIG.options, null, 2),
      });
      showMessage(successMessage('Konfiguracja Kommo zapisana.'));
    } catch (err) {
      showMessage(errorMessage('Nie udalo sie zapisac konfiguracji Kommo.'));
    }
  };

  const applyDenylistPreset = async (preset) => {
    try {
      const token = getStoredToken();
      await api.post('/integrations/security/denylist/preset', { preset }, { headers: authHeaders(token) });
      showMessage(successMessage('Preset denylisty zastosowany.'));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Błąd zastosowania presetu denylisty.'));
    }
  };

  const rollbackDenylist = async (historyId) => {
    if (rollbackConfirmId !== historyId) {
      setRollbackConfirmId(historyId);
      showMessage(errorMessage('Kliknij ponownie "Cofnij do tego", aby potwierdzić rollback.'));
      return;
    }
    try {
      const token = getStoredToken();
      await api.post(`/integrations/security/denylist/rollback/${historyId}`, {}, { headers: authHeaders(token) });
      showMessage(successMessage('Rollback denylisty wykonany.'));
      setRollbackConfirmId(null);
      loadData();
    } catch (err) {
      setRollbackConfirmId(null);
      const apiMsg = String(err?.response?.data?.error || '').trim();
      showMessage(errorMessage(apiMsg || 'Błąd rollback denylisty.'));
    }
  };

  const exportDenylistHistoryCsv = () => {
    const rows = filteredDenylistHistory;
    const header = ['id', 'created_at', 'action', 'actor_user_name', 'next_channels', 'next_users'];
    const csv = [
      header.join(','),
      ...rows.map((h) =>
        [
          h.id,
          h.created_at,
          h.action,
          h.actor_user_name || h.actor_user_id || '',
          (h.next?.channels || []).join('|'),
          (h.next?.users || []).join('|'),
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `denylist-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const metrics = useMemo(() => [
    { label: 'Wszystkie logi', value: stats.total || 0 },
    { label: 'Wysłane (demo)', value: stats.sent_demo || 0 },
    { label: 'SMS', value: stats.byChannel?.sms || 0 },
    { label: 'E-mail', value: stats.byChannel?.email || 0 },
    { label: 'Push', value: stats.byChannel?.push || 0 },
  ], [stats]);

  const trend = useMemo(() => {
    const map = new Map();
    for (const l of logs) {
      const day = new Date(l.created_at).toISOString().slice(0, 10);
      map.set(day, (map.get(day) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([day, count]) => ({ day, count }));
  }, [logs]);
  const maxTrend = Math.max(1, ...trend.map((x) => x.count));
  const cooldownMsLeft = Math.max(0, cooldownUntil - nowTs);
  const retryLocked = cooldownMsLeft > 0;
  const filteredDenylistHistory = useMemo(() => {
    const actorQ = historyFilters.actor.trim().toLowerCase();
    const actionQ = historyFilters.action.trim().toLowerCase();
    return (security.denylist_history || []).filter((h) => {
      const actorName = String(h.actor_user_name || h.actor_user_id || '').toLowerCase();
      const action = String(h.action || '').toLowerCase();
      const actorOk = !actorQ || actorName.includes(actorQ);
      const actionOk = !actionQ || action.includes(actionQ);
      return actorOk && actionOk;
    });
  }, [security.denylist_history, historyFilters.actor, historyFilters.action]);

  const isRollbackAllowed = (item) => {
    const createdAtMs = new Date(item?.created_at || 0).getTime();
    if (!createdAtMs) return false;
    const maxAgeMs = ROLLBACK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - createdAtMs <= maxAgeMs;
  };
  const failedLogs = logs.filter((log) => ['error', 'failed', 'blocked'].includes(String(log.status || '').toLowerCase())).length;
  const activeCrmApps = crmApps.filter((app) => app.active !== false).length;
  const blockedEntries = (security.denylist?.users?.length || 0) + (security.denylist?.channels?.length || 0);
  const kommoQueueCount = kommoSync.queue.length;
  const branchSetupTodo = branchSetupStatuses.filter((item) => {
    const status = String(item.status || item.state || item.health || '').toLowerCase();
    return !['ok', 'ready', 'done', 'active', 'connected'].includes(status);
  }).length;

  return (
    <div className="integrations-shell" style={styles.container}>
      <CommandSidebar active="dashboard" />
      <div className="app-main command-content-main integrations-main" style={styles.main}>
        <PageHeader title="Integracje" subtitle="Globalny dashboard logów i retry" />
        <StatusMessage message={message} />

        <section className="integrations-command-strip">
          <div className="integrations-command-lead">
            <span>Centrum polaczen</span>
            <strong>{totalRows || logs.length}</strong>
            <small>logi i zdarzenia w aktualnym widoku</small>
          </div>
          <div className={`integrations-command-card ${failedLogs > 0 ? 'is-danger' : 'is-good'}`}>
            <span>Bledy wysylek</span>
            <strong>{failedLogs}</strong>
            <small>status error / failed / blocked</small>
          </div>
          <div className={`integrations-command-card ${retryLocked ? 'is-warning' : 'is-good'}`}>
            <span>Retry</span>
            <strong>{retryLocked ? `${Math.ceil(cooldownMsLeft / 1000)}s` : 'OK'}</strong>
            <small>{retryAudit.length} wpisow audytu</small>
          </div>
          <div className={`integrations-command-card ${blockedEntries > 0 ? 'is-warning' : 'is-good'}`}>
            <span>Bezpieczenstwo</span>
            <strong>{blockedEntries}</strong>
            <small>blokady uzytkownikow i kanalow</small>
          </div>
          <div className={`integrations-command-card ${kommoQueueCount + branchSetupTodo > 0 ? 'is-warning' : 'is-good'}`}>
            <span>CRM / Kommo</span>
            <strong>{activeCrmApps}</strong>
            <small>{kommoQueueCount} w kolejce / {branchSetupTodo} oddzialy do setupu</small>
          </div>
        </section>

        <div className="integrations-metrics" style={styles.metrics}>
          {metrics.map((m) => (
            <div className="integrations-metric-card" key={m.label} style={styles.metricCard}>
              <div style={styles.metricValue}>{m.value}</div>
              <div style={styles.metricLabel}>{m.label}</div>
            </div>
          ))}
        </div>

        <div style={styles.tableWrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800 }}>CRM API / widgety</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Publiczne webhooki do tworzenia leadów i wiadomości z landingów, formularzy lub własnych widgetów.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                style={styles.input}
                placeholder="Nazwa aplikacji"
                value={crmAppForm.name}
                onChange={(e) => setCrmAppForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <select style={styles.input} value={crmAppForm.type} onChange={(e) => setCrmAppForm((prev) => ({ ...prev, type: e.target.value }))}>
                <option value="widget">Widget</option>
                <option value="webhook">Webhook</option>
                <option value="api">API</option>
              </select>
              <input
                style={styles.input}
                placeholder="Oddział ID"
                value={crmAppForm.oddzial_id}
                onChange={(e) => setCrmAppForm((prev) => ({ ...prev, oddzial_id: e.target.value }))}
              />
              <button type="button" style={styles.btn} onClick={createCrmApp}>Dodaj CRM app</button>
            </div>
          </div>
          <div style={styles.grid2}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Aplikacje</div>
              {crmApps.length === 0 ? <div style={styles.empty}>Brak aplikacji CRM.</div> : crmApps.map((app) => (
                <ModernDataRow
                  key={app.id}
                  title={app.name}
                  subtitle={`${app.type} / ${app.active ? 'aktywna' : 'pauza'} / ${formatCrmAppHealth(app)} / ${app.webhook_path}`}
                  meta={`oddział ${app.oddzial_id || 'global'}`}
                  actions={app.config?.unified_inbox ? (
                    <>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => sendCrmChannelTest(app)}
                      disabled={crmChannelTestingId === app.id || app.active !== true}
                    >
                      {crmChannelTestingId === app.id ? 'Wysylam...' : 'Wyslij test'}
                    </button>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => toggleCrmChannelApp(app)}
                      disabled={crmChannelTogglingId === app.id}
                    >
                      {crmChannelTogglingId === app.id ? 'Zapis...' : app.active ? 'Pauzuj' : 'Wlacz'}
                    </button>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => copyCrmChannelPackageForApp(app)}
                    >
                      Kopiuj paczke
                    </button>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => navigate('/crm/inbox')}
                    >
                      Otworz Inbox
                    </button>
                    </>
                  ) : null}
                />
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Ostatnie eventy</div>
              {crmEvents.length === 0 ? <div style={styles.empty}>Brak eventów CRM.</div> : crmEvents.slice(0, 6).map((event) => (
                <ModernDataRow
                  key={event.id}
                  title={`${event.event_type} · ${event.status}`}
                  subtitle={event.app_name || `app #${event.app_id || '-'}`}
                  meta={event.lead_id ? `lead #${event.lead_id}` : ''}
                />
              ))}
            </div>
          </div>
          <div style={{ ...styles.tableWrap, marginTop: 12, boxShadow: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>Unified Inbox: kanaly per oddzial</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Kreator tworzy osobny webhook dla WhatsApp, Instagrama, Messengera, Telegrama, e-maila lub webchatu.
                </div>
              </div>
              <button type="button" style={styles.btn} onClick={createCrmChannelApp}>Utworz kanal</button>
            </div>
            <div style={styles.grid3}>
              <label style={styles.fieldBlock}>
                <span style={styles.fieldLabel}>Kanal</span>
                <select
                  style={styles.input}
                  value={crmChannelForm.channel}
                  onChange={(e) => setCrmChannelForm((prev) => ({ ...prev, channel: e.target.value }))}
                >
                  {CRM_CHANNEL_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldBlock}>
                <span style={styles.fieldLabel}>Provider</span>
                <input
                  style={styles.input}
                  value={crmChannelForm.provider}
                  onChange={(e) => setCrmChannelForm((prev) => ({ ...prev, provider: e.target.value }))}
                  placeholder="meta, twilio, sendgrid, telegram..."
                />
              </label>
              <label style={styles.fieldBlock}>
                <span style={styles.fieldLabel}>Oddzial ID</span>
                <input
                  style={styles.input}
                  value={crmChannelForm.oddzial_id}
                  onChange={(e) => setCrmChannelForm((prev) => ({ ...prev, oddzial_id: e.target.value }))}
                  placeholder="np. 2"
                />
              </label>
              <label style={styles.fieldBlock}>
                <span style={styles.fieldLabel}>Numer / handle</span>
                <input
                  style={styles.input}
                  value={crmChannelForm.handle}
                  onChange={(e) => setCrmChannelForm((prev) => ({ ...prev, handle: e.target.value }))}
                  placeholder="+48..., @profil, email@firma.pl"
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <span style={styles.statusPill}>
                {crmApps.filter((app) => app.config?.unified_inbox).length} aktywnych kanalow Unified Inbox
              </span>
              <button type="button" style={styles.btn} onClick={() => copyCrmChannelPackage()} disabled={!latestCrmChannelPackage}>
                Kopiuj ostatnia paczke
              </button>
            </div>
            {latestCrmChannelPackage ? (
              <label style={{ ...styles.fieldBlock, marginTop: 10 }}>
                <span style={styles.fieldLabel}>Ostatnia paczka do providera</span>
                <textarea style={styles.textarea} value={latestCrmChannelPackage} readOnly />
              </label>
            ) : null}
          </div>
          <div style={{ ...styles.tableWrap, marginTop: 12, boxShadow: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>Checklisty podpiecia oddzialow</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Telefonia, Agent AI, SMS i kanaly Unified Inbox w jednym miejscu.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={styles.statusPill}>Gotowe: {branchSetupSummary.ready}/{branchSetupSummary.total}</span>
                <span style={styles.statusPill}>Wymaga reakcji: {branchSetupSummary.requiresReaction}</span>
                <span style={styles.statusPill}>Do dopiecia: {branchSetupSummary.todo}</span>
                <span style={styles.statusPill}>Brak Inbox: {branchSetupSummary.missingInbox}</span>
                <span style={styles.statusPill}>Brak testu: {branchSetupSummary.missingTest}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select
                style={styles.input}
                value={branchSetupFilter}
                onChange={(e) => {
                  setBranchSetupFilter(e.target.value);
                  setBranchSetupShowAll(false);
                }}
              >
                <option value="todo">Tylko do dopiecia</option>
                <option value="requires_reaction">Wymaga reakcji</option>
                <option value="all">Wszystkie oddzialy</option>
                <option value="ready">Gotowe</option>
                <option value="missing_inbox">Brak Inbox</option>
                <option value="missing_test">Brak testu</option>
              </select>
              <button type="button" style={styles.btn} onClick={copyBranchSetupGaps}>
                Kopiuj braki
              </button>
              <button type="button" style={styles.btn} onClick={copyVisibleBranchSetupPackages} disabled={!visibleBranchSetupRows.length}>
                Kopiuj komplety
              </button>
              <button type="button" style={styles.btn} onClick={exportBranchSetupCsv}>
                Eksport CSV
              </button>
              <button type="button" style={styles.btn} onClick={() => setBranchSetupShowAll((prev) => !prev)} disabled={filteredBranchSetupRows.length <= 8}>
                {branchSetupShowAll ? 'Pokaz mniej' : `Pokaz wszystkie (${filteredBranchSetupRows.length})`}
              </button>
            </div>
            {filteredBranchSetupRows.length ? (
              <div style={styles.grid2}>
                {visibleBranchSetupRows.map((row) => (
                  <div key={row.oddzial_id} style={styles.branchHistoryWrap}>
                    <ModernDataRow
                      title={row.oddzial_name || `Oddzial #${row.oddzial_id}`}
                      subtitle={`${row.readyCount}/5 gotowe / Inbox: ${row.activeCrmChannels.length}/${row.crmChannels.length} / Agent: ${row.integration_status || 'brak'}`}
                      meta={row.ready ? 'Gotowy do pracy' : `Braki: ${row.blockers.join(', ')}`}
                      metrics={[
                        {
                          label: row.ready ? 'Status' : 'Braki:',
                          value: row.ready ? 'Gotowy do pracy' : row.blockers.join(', '),
                          tone: row.ready ? 'success' : 'warning',
                          mono: false,
                        },
                        {
                          label: 'Test',
                          value: row.testStatusLabel,
                          tone: row.testStatusTone,
                          mono: false,
                        },
                        {
                          label: 'Ostatnia akcja',
                          value: row.lastAudit
                            ? `${formatCrmAuditAction(row.lastAudit.action)} / ${row.lastAudit.created_at ? new Date(row.lastAudit.created_at).toLocaleString('pl-PL') : 'brak daty'}`
                            : 'Brak audytu',
                          tone: row.lastAudit ? 'info' : 'warning',
                          mono: false,
                        },
                        {
                          label: 'Reakcja',
                          value: row.requiresReaction ? row.reactionReasons.join(', ') : 'Nie wymaga',
                          tone: row.requiresReaction ? 'danger' : 'success',
                          mono: false,
                        },
                      ]}
                      tone={row.ready ? 'success' : 'warning'}
                      status={row.ready ? 'Gotowy' : 'Do dopiecia'}
                      statusValue={row.ready ? 'ok' : 'todo'}
                      statusState={row.ready ? 'success' : 'warning'}
                      actions={(
                        <>
                          {row.blockers.includes('kanal inbox') ? (
                            <button
                              type="button"
                              style={styles.btn}
                              onClick={() => createInboxChannelForBranch(row)}
                              disabled={branchInboxCreatingId === row.oddzial_id}
                            >
                              {branchInboxCreatingId === row.oddzial_id ? 'Tworze i testuje...' : 'Utworz i testuj Inbox'}
                            </button>
                          ) : null}
                          {row.blockers.includes('kanal inbox') ? (
                            <button type="button" style={styles.btn} onClick={() => prepareInboxChannelForBranch(row)}>
                              Formularz
                            </button>
                          ) : null}
                          <button type="button" style={styles.btn} onClick={() => setExpandedBranchHistoryId((prev) => (prev === row.oddzial_id ? null : row.oddzial_id))}>
                            Historia
                          </button>
                          <button type="button" style={styles.btn} onClick={() => copyBranchSetupPackage(row)}>
                            Kopiuj komplet
                          </button>
                          <button type="button" style={styles.btn} onClick={() => navigate('/telefonia?tab=agent')}>
                            Telefonia
                          </button>
                          <button type="button" style={styles.btn} onClick={() => navigate('/crm/inbox')}>
                            Inbox
                          </button>
                        </>
                      )}
                    />
                    {expandedBranchHistoryId === row.oddzial_id ? (
                      <div style={styles.branchHistoryPanel}>
                        <div style={styles.branchHistoryHeader}>
                          <strong>Historia podpiecia</strong>
                          <button type="button" style={styles.btn} onClick={() => copyBranchSetupHistory(row)}>
                            Kopiuj historie
                          </button>
                        </div>
                        {row.audits.length ? row.audits.slice(0, 8).map((item) => (
                          <div key={item.id || `${item.action}-${item.created_at}`} style={styles.branchHistoryItem}>
                            <div style={{ fontWeight: 800 }}>{formatCrmAuditAction(item.action)}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {(item.created_at ? new Date(item.created_at).toLocaleString('pl-PL') : 'brak daty')} / {item.user_login || item.user_id || 'system'}
                            </div>
                            {item.metadata?.webhook_path ? <div style={styles.branchHistoryMeta}>Webhook: {item.metadata.webhook_path}</div> : null}
                            {item.metadata?.lead_id ? <div style={styles.branchHistoryMeta}>Lead testowy: #{item.metadata.lead_id}</div> : null}
                            {item.metadata?.blockers ? <div style={styles.branchHistoryMeta}>Braki: {Array.isArray(item.metadata.blockers) ? item.metadata.blockers.join(', ') : item.metadata.blockers}</div> : null}
                          </div>
                        )) : (
                          <div style={styles.empty}>Brak historii audytu dla oddzialu.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.empty}>
                {branchSetupRows.length ? 'Brak oddzialow w tym filtrze.' : 'Brak statusow oddzialow. Odswiez integracje albo sprawdz uprawnienia.'}
              </div>
            )}
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800 }}>Kommo task.sync</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Outbound retry/dead-letter oraz inbound konflikty statusow z Kommo.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                style={styles.input}
                value={kommoBranchFilter}
                onChange={(e) => setKommoBranchFilter(e.target.value)}
                aria-label="Filtr oddzialu Kommo"
              >
                <option value="">Wszystkie oddzialy</option>
                {branchSetupRows.map((row) => (
                  <option key={row.oddzial_id} value={row.oddzial_id}>
                    {`Kommo: ${row.oddzial_name || `Oddzial #${row.oddzial_id}`}`}
                  </option>
                ))}
              </select>
              <span style={styles.statusPill}>Bledy: {kommoSync.summary?.queue_errors || 0}</span>
              <span style={styles.statusPill}>Konflikty: {kommoSync.summary?.inbound_conflicts || 0}</span>
            </div>
          </div>
          <div style={styles.grid2}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Kolejka wysylki</div>
              {kommoSync.queue.length === 0 ? <div style={styles.empty}>Brak wpisow task.sync w kolejce.</div> : kommoSync.queue.slice(0, 6).map((row) => (
                <ModernDataRow
                  key={`queue-${row.id}`}
                  title={`#${row.task_id} ${row.klient_nazwa || ''}`.trim()}
                  subtitle={row.last_error || row.task_status || 'Brak bledu'}
                  tone={row.status === 'dead_letter' ? 'danger' : row.status === 'failed' ? 'warning' : 'success'}
                  status={row.status}
                  statusValue={row.status}
                  metrics={[
                    { label: 'Retry', value: row.retry_count || 0 },
                    { label: 'Owner', value: row.owner_label || row.owner_role || 'Dyspozytor/Admin', mono: false },
                    { label: 'Eskalacja', value: row.escalation || 'monitoruj', mono: false, tone: row.status === 'dead_letter' ? 'danger' : undefined },
                    { label: 'Oddzial', value: row.oddzial_id || 'brak' },
                  ]}
                  actions={
                    ['failed', 'dead_letter'].includes(String(row.status || '')) ? (
                      <button
                        type="button"
                        style={styles.retryBtn}
                        disabled={kommoAckSavingId === `queue:${row.id}`}
                        onClick={() => acknowledgeKommoRisk(row, 'queue')}
                      >
                        {kommoAckSavingId === `queue:${row.id}` ? 'Zapisuje...' : 'Potwierdz'}
                      </button>
                    ) : null
                  }
                />
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Inbound z Kommo</div>
              {kommoSync.inbound_events.length === 0 ? <div style={styles.empty}>Brak zdarzen inbound.</div> : kommoSync.inbound_events.slice(0, 6).map((event) => (
                <ModernDataRow
                  key={`inbound-${event.id}`}
                  title={`#${event.task_id || '-'} ${event.incoming_status || 'bez statusu'}`}
                  subtitle={event.conflict_reason || event.klient_nazwa || event.event_key}
                  tone={event.status === 'conflict' || event.status === 'error' ? 'danger' : 'success'}
                  status={event.status}
                  statusValue={event.status}
                  metrics={[
                    { label: 'Owner', value: event.owner_label || event.owner_role || 'Dyspozytor/Admin', mono: false },
                    { label: 'Eskalacja', value: event.escalation || 'monitoruj', mono: false, tone: event.status === 'conflict' ? 'danger' : undefined },
                    { label: 'Oddzial', value: event.oddzial_id || 'brak' },
                  ]}
                  actions={
                    event.status === 'conflict' || event.status === 'error' ? (
                      <button
                        type="button"
                        style={styles.retryBtn}
                        disabled={kommoAckSavingId === `inbound:${event.id}`}
                        onClick={() => acknowledgeKommoRisk(event, 'inbound')}
                      >
                        {kommoAckSavingId === `inbound:${event.id}` ? 'Zapisuje...' : 'Potwierdz'}
                      </button>
                    ) : null
                  }
                />
              ))}
            </div>
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800 }}>Mapowanie Kommo -&gt; Polska Flora</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Aktualne konto: {kommoConfig.account_key || 'default'} · statusy {Object.keys(kommoConfig.status_map || {}).length} · pola {Object.keys(kommoConfig.field_aliases || {}).length}
              </div>
            </div>
            <button type="button" style={styles.btn} onClick={saveKommoConfig}>Zapisz mapowanie</button>
          </div>
          <div style={styles.grid3}>
            <label style={styles.fieldBlock}>
              <span style={styles.fieldLabel}>Konto Kommo</span>
              <input
                style={styles.input}
                value={kommoConfigForm.account_key}
                onChange={(e) => setKommoConfigForm((prev) => ({ ...prev, account_key: e.target.value }))}
                placeholder="default lub account_id"
              />
            </label>
            <label style={styles.fieldBlock}>
              <span style={styles.fieldLabel}>Status map JSON</span>
              <textarea
                style={styles.textarea}
                value={kommoConfigForm.status_map}
                onChange={(e) => setKommoConfigForm((prev) => ({ ...prev, status_map: e.target.value }))}
              />
            </label>
            <label style={styles.fieldBlock}>
              <span style={styles.fieldLabel}>Field aliases JSON</span>
              <textarea
                style={styles.textarea}
                value={kommoConfigForm.field_aliases}
                onChange={(e) => setKommoConfigForm((prev) => ({ ...prev, field_aliases: e.target.value }))}
              />
            </label>
            <label style={styles.fieldBlock}>
              <span style={styles.fieldLabel}>Opcje importu JSON</span>
              <textarea
                style={styles.textarea}
                value={kommoConfigForm.options}
                onChange={(e) => setKommoConfigForm((prev) => ({ ...prev, options: e.target.value }))}
              />
            </label>
          </div>
        </div>
        <div style={{ marginBottom: 10, color: retryLocked ? '#EF5350' : 'var(--text-muted)', fontSize: 12 }}>
          {retryLocked ? `Retry cooldown: ${Math.ceil(cooldownMsLeft / 1000)}s` : 'Retry gotowe'}
        </div>

        <div className="integrations-filters" style={styles.filters}>
          <input
            style={styles.input}
            placeholder="ID zlecenia"
            value={filters.task_id}
            onChange={(e) => setFilters((f) => ({ ...f, task_id: e.target.value }))}
          />
          <select style={styles.input} value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}>
            <option value="">Wszystkie kanały</option>
            <option value="sms">SMS</option>
            <option value="email">E-mail</option>
            <option value="push">Push</option>
          </select>
          <select style={styles.input} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Wszystkie statusy</option>
            <option value="sent_demo">sent_demo</option>
          </select>
          <button type="button" style={styles.btn} onClick={loadData}>Odśwież</button>
          <button type="button" style={styles.btn} onClick={exportCsv}>Eksport CSV</button>
          <button type="button" style={styles.btn} onClick={retryBatch} disabled={retryLocked}>Retry batch</button>
          <label style={{ ...styles.input, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh 10s
          </label>
          <select style={styles.input} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="created_at">Sort: data</option>
            <option value="channel">Sort: kanał</option>
            <option value="status">Sort: status</option>
            <option value="task_id">Sort: zlecenie</option>
          </select>
          <select style={styles.input} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="desc">Malejąco</option>
            <option value="asc">Rosnąco</option>
          </select>
          <select style={styles.input} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value) || 25); setPage(1); }}>
            <option value={10}>10 / strona</option>
            <option value={25}>25 / strona</option>
            <option value={50}>50 / strona</option>
            <option value={100}>100 / strona</option>
          </select>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Trend dzienny (ostatnie 10 dni)</div>
          <div style={styles.trendRow}>
            {trend.length === 0 ? (
              <div style={styles.empty}>Brak danych trendu.</div>
            ) : trend.map((p) => (
              <div key={p.day} style={styles.trendCol}>
                <div style={{ ...styles.trendBar, height: `${Math.max(8, Math.round((p.count / maxTrend) * 90))}px` }} />
                <div style={styles.trendCount}>{p.count}</div>
                <div style={styles.trendLabel}>{p.day.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Wyniki: {totalRows}</span>
            <span>Strona {page} / {totalPages}</span>
          </div>
          {loading ? (
            <div style={styles.empty}>?adowanie...</div>
          ) : logs.length === 0 ? (
            <div style={styles.empty}>Brak log?w</div>
          ) : (
            <div className="modern-data-stack">
              {logs.map((l) => (
                <ModernDataRow
                  key={l.id}
                  idLabel="Integration Log"
                  idValue={`LOG-${l.id}`}
                  title={l.title}
                  subtitle={`${String(l.channel || '').toUpperCase()} ? #${l.task_id || '-'}`}
                  tone={l.status === 'ok' || l.status === 'sent' ? 'success' : l.status === 'error' ? 'danger' : 'info'}
                  status={l.status || 'brak'}
                  statusValue={l.status || 'brak'}
                  statusState={l.status === 'ok' || l.status === 'sent' ? 'success' : l.status === 'error' ? 'danger' : 'info'}
                  metrics={[
                    { label: 'Data', value: l.created_at ? new Date(l.created_at).toLocaleString('pl-PL') : 'brak' },
                    { label: 'Kana?', value: String(l.channel || '').toUpperCase() || 'brak' },
                    { label: 'Zlecenie', value: l.task_id ? `#${l.task_id}` : 'brak', tone: l.task_id ? 'info' : undefined },
                  ]}
                  actions={
                    <>
                      <label style={styles.checkboxAction}>
                        <input
                          type="checkbox"
                          checked={selectedLogIds.includes(l.id)}
                          onChange={(e) => {
                            setSelectedLogIds((prev) => (
                              e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id)
                            ));
                          }}
                        />
                        Select
                      </label>
                      <button type="button" style={styles.retryBtn} onClick={() => retryLog(l.id)} disabled={retryLocked}>Retry</button>
                    </>
                  }
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" style={styles.btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Poprzednia</button>
            <button type="button" style={styles.btn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Następna</button>
          </div>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Audit retry (ostatnie akcje)</div>
          {retryAudit.length === 0 ? (
            <div style={styles.empty}>Brak wpis?w audytu.</div>
          ) : (
            <div className="modern-data-stack">
              {retryAudit.slice(0, 20).map((a) => (
                <ModernDataRow
                  key={a.id}
                  idLabel="Retry Audit"
                  idValue={`AUD-${a.id}`}
                  title={a.actor_user_name || `User #${a.actor_user_id}`}
                  subtitle={a.created_at ? new Date(a.created_at).toLocaleString('pl-PL') : 'brak daty'}
                  tone="info"
                  status={a.mode || 'retry'}
                  statusValue={a.mode || 'retry'}
                  statusState="info"
                  metrics={[
                    { label: '?r?d?o logu', value: a.source_log_id ? `#${a.source_log_id}` : 'brak' },
                    { label: 'Nowy log', value: a.created_log_id ? `#${a.created_log_id}` : 'brak', tone: 'success' },
                    { label: 'IP', value: a.ip || 'brak' },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Retry by user (top)</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(stats.retry_by_user || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([name, cnt]) => (
                <div key={name} style={styles.workflowStatRow}>
                  <span>{name}</span>
                  <strong>{cnt}</strong>
                </div>
              ))}
            {Object.keys(stats.retry_by_user || {}).length === 0 && <div style={styles.empty}>Brak danych.</div>}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Denylist kanałów: {(stats.denylist?.channels || []).join(', ') || 'brak'} ·
            Denylist użytkowników: {(stats.denylist?.users || []).join(', ') || 'brak'}
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Panel admina denylisty</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Kanały zablokowane</div>
              {['sms', 'email', 'push'].map((ch) => (
                <label key={ch} style={styles.workflowStatRow}>
                  <span>{ch.toUpperCase()}</span>
                  <input
                    type="checkbox"
                    checked={securityForm.channels.includes(ch)}
                    onChange={(e) => {
                      setSecurityForm((prev) => ({
                        ...prev,
                        channels: e.target.checked
                          ? [...prev.channels, ch]
                          : prev.channels.filter((x) => x !== ch),
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Użytkownicy zablokowani</div>
              <div style={{ maxHeight: 180, overflow: 'auto', display: 'grid', gap: 6 }}>
                {users.map((u) => (
                  <label key={u.id} style={styles.workflowStatRow}>
                    <span>{u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)})</span>
                    <input
                      type="checkbox"
                      checked={securityForm.users.includes(u.id)}
                      onChange={(e) => {
                        setSecurityForm((prev) => ({
                          ...prev,
                          users: e.target.checked
                            ? [...prev.users, u.id]
                            : prev.users.filter((x) => x !== u.id),
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={styles.btn} onClick={saveDenylist}>Zapisz denylistę</button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('block_sms_global')}>
              Preset: blokuj SMS globalnie
            </button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('allow_all_channels')}>
              Preset: odblokuj kanały
            </button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('clear_all')}>
              Preset: wyczyść wszystko
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Aktualna denylista (backend): kanały [{(security.denylist?.channels || []).join(', ') || 'brak'}], użytkownicy [{(security.denylist?.users || []).join(', ') || 'brak'}]
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Historia zmian denylisty</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
            <input
              style={styles.input}
              placeholder="Filtr: użytkownik"
              value={historyFilters.actor}
              onChange={(e) => setHistoryFilters((f) => ({ ...f, actor: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Filtr: akcja"
              value={historyFilters.action}
              onChange={(e) => setHistoryFilters((f) => ({ ...f, action: e.target.value }))}
            />
            <button type="button" style={styles.btn} onClick={exportDenylistHistoryCsv}>Eksport CSV</button>
          </div>
          {filteredDenylistHistory.length > 0 ? (
            <div className="modern-data-stack">
              {filteredDenylistHistory.slice(0, 50).map((h) => (
                <ModernDataRow
                  key={h.id}
                  idLabel="Denylist Change"
                  idValue={`DENY-${h.id}`}
                  title={h.action}
                  subtitle={h.actor_user_name || h.actor_user_id || 'system'}
                  tone={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  status={isRollbackAllowed(h) ? 'ROLLBACK READY' : 'LOCKED'}
                  statusValue={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  statusState={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  metrics={[
                    { label: 'Data', value: h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : 'brak' },
                    { label: 'Kana?y next', value: (h.next?.channels || []).join(', ') || 'brak', mono: false },
                    { label: 'Userzy next', value: (h.next?.users || []).join(', ') || 'brak', mono: false },
                    { label: 'Kana?y diff', value: `-${((h.prev?.channels || []).filter((x) => !(h.next?.channels || []).includes(x))).join(', ') || 'brak'} / +${((h.next?.channels || []).filter((x) => !(h.prev?.channels || []).includes(x))).join(', ') || 'brak'}`, mono: false },
                  ]}
                  actions={
                    <>
                      {!isRollbackAllowed(h) ? (
                        <span style={styles.rollbackBlockedBadge}>niedost?pny ({ROLLBACK_MAX_AGE_DAYS}d+)</span>
                      ) : null}
                      <button
                        type="button"
                        style={{
                          ...styles.retryBtn,
                          borderColor: rollbackConfirmId === h.id ? '#EF5350' : 'var(--accent)',
                          color: rollbackConfirmId === h.id ? '#EF5350' : 'var(--accent)',
                          opacity: isRollbackAllowed(h) ? 1 : 0.45,
                          cursor: isRollbackAllowed(h) ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!isRollbackAllowed(h)}
                        onClick={() => rollbackDenylist(h.id)}
                      >
                        Cofnij do tego
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          ) : (
            <div style={styles.empty}>Brak historii zmian denylisty.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: 24 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 },
  metricCard: { background: 'var(--surface-glass)', borderRadius: 8, padding: 12, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)' },
  metricValue: { fontWeight: 800, fontSize: 22, color: 'var(--accent)' },
  metricLabel: { fontSize: 12, color: 'var(--text-muted)' },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontWeight: 700 },
  tableWrap: { background: 'var(--surface-glass)', borderRadius: 8, padding: 12, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)', marginBottom: 12 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 },
  branchHistoryWrap: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
  branchHistoryPanel: { border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', padding: 10, boxShadow: 'var(--shadow-sm)' },
  branchHistoryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  branchHistoryItem: { borderTop: '1px solid var(--glass-border)', paddingTop: 8, marginTop: 8 },
  branchHistoryMeta: { fontSize: 12, color: 'var(--text-sub)', marginTop: 4, overflowWrap: 'anywhere' },
  fieldBlock: { display: 'grid', gap: 6 },
  fieldLabel: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 800 },
  textarea: { minHeight: 132, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--surface-field)', color: 'var(--text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, resize: 'vertical' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 12, padding: 8, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' },
  td: { fontSize: 13, padding: 8, borderBottom: '1px solid var(--border)' },
  retryBtn: { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--accent)', background: 'var(--surface-field)', cursor: 'pointer', fontWeight: 700 },
  checkboxAction: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 },
  empty: { padding: 18, color: 'var(--text-muted)' },
  trendRow: { display: 'flex', alignItems: 'flex-end', gap: 10, minHeight: 130 },
  trendCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 44 },
  trendBar: { width: 22, background: 'var(--accent-gradient)', borderRadius: 6 },
  trendLabel: { fontSize: 10, color: 'var(--text-muted)' },
  trendCount: { fontSize: 11, fontWeight: 700, color: 'var(--text)' },
  workflowStatRow: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 8px', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', borderRadius: 8 },
  statusPill: { display: 'inline-flex', alignItems: 'center', minHeight: 30, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', backgroundColor: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, fontWeight: 800 },
  rollbackBlockedBadge: { display: 'inline-block', marginBottom: 6, fontSize: 11, color: '#EF5350', backgroundColor: 'rgba(239,83,80,0.12)', borderRadius: 999, padding: '2px 8px' },
};
