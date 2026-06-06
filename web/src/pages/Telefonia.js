import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { telHref, normalizePhone } from '../utils/telLink';
import { normalizeSmsHistoryRow } from '../utils/smsHistoryNormalize';

/** Rozmiar strony dla GET /api/sms/historia?limit=&offset= (ARBOR-OS). */
const SMS_HIST_PAGE_SIZE = 15;
const BRANCH_STATUS_VIEW_KEY = 'arbor_telefonia_branch_status_view_v1';
const BRANCH_STATUS_FILTERS = new Set(['all', 'ready', 'todo', 'attention', 'retest']);
const BRANCH_STATUS_SORTS = new Set(['needs', 'stage', 'ready', 'activity', 'name']);
const BRANCH_STAGE_FILTERS = new Set(['all', 'Do danych', 'Do testu', 'Uwagi', 'Do dopiecia', 'Gotowy']);
const BRANCH_STAGE_ORDER = {
  'Do danych': 0,
  'Do testu': 1,
  Uwagi: 2,
  'Do dopiecia': 3,
  Gotowy: 4,
};
const BRANCH_TEST_STALE_DAYS = 14;

function useNarrowViewport(maxWidth = 760) {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < maxWidth : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsNarrow(window.innerWidth < maxWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxWidth]);

  return isNarrow;
}

export default function Telefonia() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNarrow = useNarrowViewport();
  const savedBranchStatusView = useMemo(() => getLocalStorageJson(BRANCH_STATUS_VIEW_KEY, {}), []);
  const [sms, setSms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [smsBranchFilter, setSmsBranchFilter] = useState(() => searchParams.get('oddzial_id') || '');
  const [updatedByFilter, setUpdatedByFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyUpdatedToday, setOnlyUpdatedToday] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [acknowledgingSmsId, setAcknowledgingSmsId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [manualSending, setManualSending] = useState(false);
  const [page, setPage] = useState(1);
  /** Odpowiedź OS z `{ items, total }` — stronicowanie po stronie API. */
  const [serverPaging, setServerPaging] = useState(false);
  const [smsTotalAll, setSmsTotalAll] = useState(0);
  const smsInitialLoadDone = useRef(false);
  const lastSmsServerFilterSig = useRef('');
  const lastSmsClientFilterSig = useRef('');
  /** Po `setPage(1)` ten efekt odpala się ponownie — pomijamy drugi `loadSms(1)`. */
  const skipSmsPageEffectOnce = useRef(false);
  const [manualForm, setManualForm] = useState({
    recipient_name: '',
    recipient_phone: '',
    text: '',
  });
  const [zadarmaSettings, setZadarmaSettings] = useState(null);
  const [zadarmaForm, setZadarmaForm] = useState({
    api_key: '',
    api_secret: '',
    caller_id: '',
  });
  const [zadarmaLoading, setZadarmaLoading] = useState(false);
  const [zadarmaSaving, setZadarmaSaving] = useState(false);
  const [zadarmaTesting, setZadarmaTesting] = useState(false);
  const [zadarmaMessage, setZadarmaMessage] = useState('');
  const [zadarmaError, setZadarmaError] = useState('');

  const [tab, setTab] = useState('sms');
  const [oddzialy, setOddzialy] = useState([]);
  const [callRows, setCallRows] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [telLoading, setTelLoading] = useState(false);
  const [telError, setTelError] = useState('');
  const [telMessage, setTelMessage] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [savingCb, setSavingCb] = useState(false);
  const [startingCallKey, setStartingCallKey] = useState(null);
  const [updatingCbId, setUpdatingCbId] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentTestLoading, setAgentTestLoading] = useState(false);
  const [branchSetupTesting, setBranchSetupTesting] = useState(false);
  const [branchQuickConnectingId, setBranchQuickConnectingId] = useState(null);
  const [agentMessage, setAgentMessage] = useState('');
  const [agentError, setAgentError] = useState('');
  const [agentConfig, setAgentConfig] = useState(null);
  const [agentIntegration, setAgentIntegration] = useState(null);
  const [agentIntakes, setAgentIntakes] = useState([]);
  const [agentIntakesTotal, setAgentIntakesTotal] = useState(0);
  const [agentIntakesSummary, setAgentIntakesSummary] = useState({ all: 0, needs_review: 0, sms_missing: 0, sms_error: 0, scheduled: 0 });
  const [agentIntakesLoading, setAgentIntakesLoading] = useState(false);
  const [agentExporting, setAgentExporting] = useState(false);
  const [branchTelephonySaving, setBranchTelephonySaving] = useState(false);
  const [branchSmsTesting, setBranchSmsTesting] = useState(false);
  const [branchRetestCreating, setBranchRetestCreating] = useState(false);
  const [agentHistoryFilter, setAgentHistoryFilter] = useState('all');
  const [agentHistoryQuery, setAgentHistoryQuery] = useState('');
  const [agentHistoryPage, setAgentHistoryPage] = useState(1);
  const [agentReminderPreview, setAgentReminderPreview] = useState({ total: 0, items: [] });
  const [agentReminderLoading, setAgentReminderLoading] = useState(false);
  const [branchIntegrationStatuses, setBranchIntegrationStatuses] = useState([]);
  const [branchIntegrationStatusesLoading, setBranchIntegrationStatusesLoading] = useState(false);
  const [branchStatusFilter, setBranchStatusFilter] = useState(
    BRANCH_STATUS_FILTERS.has(savedBranchStatusView.filter) ? savedBranchStatusView.filter : 'all'
  );
  const [branchStatusQuery, setBranchStatusQuery] = useState(savedBranchStatusView.query || '');
  const [branchStatusSort, setBranchStatusSort] = useState(
    BRANCH_STATUS_SORTS.has(savedBranchStatusView.sort) ? savedBranchStatusView.sort : 'needs'
  );
  const [branchStageFilter, setBranchStageFilter] = useState(
    BRANCH_STAGE_FILTERS.has(savedBranchStatusView.stage) ? savedBranchStatusView.stage : 'all'
  );
  const [integrationTestLogs, setIntegrationTestLogs] = useState([]);
  const [integrationTestLogsLoading, setIntegrationTestLogsLoading] = useState(false);
  const [selectedAgentIntake, setSelectedAgentIntake] = useState(null);
  const [agentFixSaving, setAgentFixSaving] = useState(false);
  const [agentSmsSending, setAgentSmsSending] = useState(false);
  const [agentFixForm, setAgentFixForm] = useState({
    customer_name: '',
    caller_phone: '',
    inspection_address: '',
    city: '',
    service_type: '',
    appointment_at: '',
    notes: '',
    transcript: '',
    create_missing_inspection: true,
  });
  const [agentForm, setAgentForm] = useState({
    oddzial_id: '',
    provider: 'zadarma',
    provider_account_id: '',
    provider_api_key: '',
    status: 'active',
  });
  const [branchTelephonyForm, setBranchTelephonyForm] = useState({
    telefon: '',
    sms_sender_id: '',
    test_phone: '',
  });
  const [callForm, setCallForm] = useState({
    oddzial_id: '',
    phone: '',
    call_type: 'outbound',
    status: 'answered',
    duration_sec: '',
    task_id: '',
    lead_name: '',
    notes: '',
  });
  const [cbForm, setCbForm] = useState({
    oddzial_id: '',
    phone: '',
    task_id: '',
    lead_name: '',
    priority: 'normal',
    due_at: '',
    notes: '',
  });
  const [incomingForm, setIncomingForm] = useState({
    oddzial_id: '',
    phone: '',
    lead_name: '',
    task_id: '',
    status: 'answered',
    inspection_address: '',
    city: '',
    service_type: '',
    appointment_at: '',
    notes: '',
    create_lead: true,
    create_callback: false,
    priority: 'high',
  });

  const SMS_LIMIT = 480;
  const SMS_TEMPLATES = [
    {
      id: 'potwierdzenie',
      label: 'Potwierdzenie terminu',
      text: 'Dzien dobry, potwierdzamy realizacje zlecenia w ustalonym terminie. Pozdrawiamy, ARBOR-OS.',
    },
    {
      id: 'przypomnienie',
      label: 'Przypomnienie',
      text: 'Przypominamy o jutrzejszej realizacji zlecenia. W razie pytan prosimy o kontakt.',
    },
    {
      id: 'opoznienie',
      label: 'Opoznienie',
      text: 'Przepraszamy, realizacja zlecenia moze sie opoznic. Skontaktujemy sie z aktualizacja terminu.',
    },
    {
      id: 'zakonczenie',
      label: 'Zakonczenie prac',
      text: 'Dziekujemy, prace zostaly zakonczone. Prosimy o informacje zwrotna po realizacji.',
    },
  ];

  const isValidPhone = (value) => {
    const v = normalizePhone(value);
    if (!v) return false;
    if (v.startsWith('+')) return /^\+\d{8,15}$/.test(v);
    return /^\d{9,15}$/.test(v);
  };
  const GSM7_REGEX = /^[\r\n !"$%&'()*+,\-./0-9:;<=>?@A-Z_a-z\u00A3\u00A5\u00C4\u00C5\u00C6\u00C9\u00D1\u00D6\u00D8\u00DC\u00DF\u00E0\u00E4\u00E5\u00E6\u00E8\u00E9\u00EC\u00F1\u00F2\u00F6\u00F8\u00F9\u00FC\u0393\u0394\u0398\u039B\u039E\u03A0\u03A3\u03A6\u03A8\u03A9\u20AC]*$/;
  const SMS_PRICE_PLN = 0.12;
  const AGENT_HISTORY_PAGE_SIZE = 50;

  useEffect(() => {
    const user = getLocalStorageJson('user');
    if (!user || !getStoredToken()) {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    try {
      localStorage.setItem(BRANCH_STATUS_VIEW_KEY, JSON.stringify({
        filter: branchStatusFilter,
        query: branchStatusQuery,
        sort: branchStatusSort,
        stage: branchStageFilter,
      }));
    } catch {
      /* localStorage can be unavailable in private mode */
    }
  }, [branchStatusFilter, branchStatusQuery, branchStatusSort, branchStageFilter]);

  const loadSms = useCallback(
    async (pageArg) => {
      const pageNum = Math.max(1, Number(pageArg) || 1);
      setLoading(true);
      setError('');
      try {
        const token = getStoredToken();
        const qs = new URLSearchParams();
        qs.set('limit', String(SMS_HIST_PAGE_SIZE));
        qs.set('offset', String((pageNum - 1) * SMS_HIST_PAGE_SIZE));
        const qt = query.trim().slice(0, 200);
        if (qt) qs.set('q', qt);
        if (smsBranchFilter) qs.set('oddzial_id', smsBranchFilter);
        if (statusFilter && statusFilter !== 'all') qs.set('status', statusFilter);
        if (dateFrom) qs.set('date_from', dateFrom);
        if (dateTo) qs.set('date_to', dateTo);
        const res = await api.get(`/sms/historia?${qs.toString()}`, { headers: authHeaders(token) });
        const data = res.data;
        if (data && typeof data.total === 'number' && Array.isArray(data.items)) {
          setServerPaging(true);
          setSmsTotalAll(data.total);
          setSms(data.items.map(normalizeSmsHistoryRow));
        } else {
          setServerPaging(false);
          const raw = Array.isArray(data) ? data : [];
          setSmsTotalAll(raw.length);
          setSms(raw.map(normalizeSmsHistoryRow));
        }
      } catch (e) {
        setError(getApiErrorMessage(e, 'Nie udało się pobrać historii SMS.'));
      } finally {
        setLoading(false);
      }
    },
    [query, smsBranchFilter, statusFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    const user = getLocalStorageJson('user');
    if (!user || !getStoredToken()) return;
    const serverSig = `${query}\t${statusFilter}\t${smsBranchFilter}\t${dateFrom}\t${dateTo}`;
    const clientSig = `${updatedByFilter}\t${onlyUpdatedToday}`;
    if (!smsInitialLoadDone.current) {
      smsInitialLoadDone.current = true;
      lastSmsServerFilterSig.current = serverSig;
      lastSmsClientFilterSig.current = clientSig;
      loadSms(page);
      return;
    }
    if (lastSmsServerFilterSig.current !== serverSig) {
      lastSmsServerFilterSig.current = serverSig;
      lastSmsClientFilterSig.current = clientSig;
      skipSmsPageEffectOnce.current = true;
      setPage(1);
      loadSms(1);
      return;
    }
    if (lastSmsClientFilterSig.current !== clientSig) {
      lastSmsClientFilterSig.current = clientSig;
      if (page !== 1) {
        skipSmsPageEffectOnce.current = true;
        setPage(1);
        loadSms(1);
      }
      return;
    }
    if (skipSmsPageEffectOnce.current) {
      skipSmsPageEffectOnce.current = false;
      return;
    }
    loadSms(page);
  }, [page, query, statusFilter, smsBranchFilter, dateFrom, dateTo, updatedByFilter, onlyUpdatedToday, loadSms]);

  useEffect(() => {
    const user = getLocalStorageJson('user');
    if (!user || !getStoredToken() || oddzialy.length) return;
    const token = getStoredToken();
    api.get('/oddzialy', { headers: authHeaders(token) })
      .then((res) => setOddzialy(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, [oddzialy.length]);

  const loadTelephonyExtras = async () => {
    setTelLoading(true);
    setTelError('');
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [o, c, b] = await Promise.all([
        api.get('/oddzialy', { headers: h }),
        api.get('/telephony/calls', { headers: h }),
        api.get('/telephony/callbacks', { headers: h }),
      ]);
      setOddzialy(Array.isArray(o.data) ? o.data : []);
      setCallRows(Array.isArray(c.data) ? c.data : []);
      setCallbacks(Array.isArray(b.data) ? b.data : []);
    } catch (e) {
      setTelError(getApiErrorMessage(e, 'Nie udało się pobrać danych telefonii.'));
    } finally {
      setTelLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calls' || tab === 'agent') loadTelephonyExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'calls') setTab('calls');
    const oid = searchParams.get('oddzial_id');
    const ph = searchParams.get('phone');
    const tid = searchParams.get('task_id');
    if (!oid && !ph && !tid) return;
    setCallForm((f) => ({
      ...f,
      ...(oid ? { oddzial_id: String(oid) } : {}),
      ...(ph ? { phone: decodeURIComponent(ph) } : {}),
      ...(tid ? { task_id: String(tid) } : {}),
    }));
    setCbForm((f) => ({
      ...f,
      ...(oid ? { oddzial_id: String(oid) } : {}),
      ...(ph ? { phone: decodeURIComponent(ph) } : {}),
      ...(tid ? { task_id: String(tid) } : {}),
    }));
  }, [searchParams]);

  const oddzialLabel = (id) => {
    const o = oddzialy.find((x) => Number(x.id) === Number(id));
    return o ? o.nazwa || `#${id}` : `#${id || '-'}`;
  };

  const selectedAgentBranch = useMemo(
    () => oddzialy.find((x) => Number(x.id) === Number(agentForm.oddzial_id)) || null,
    [oddzialy, agentForm.oddzial_id]
  );

  useEffect(() => {
    setBranchTelephonyForm((f) => ({
      telefon: selectedAgentBranch?.telefon || '',
      sms_sender_id: selectedAgentBranch?.sms_sender_id || '',
      test_phone: f.test_phone,
    }));
  }, [selectedAgentBranch]);

  const toDateTimeLocal = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (tab !== 'agent') return;
    if (agentForm.oddzial_id || oddzialy.length === 0) return;
    const user = getLocalStorageJson('user');
    const preferred = user?.oddzial_id || oddzialy[0]?.id || '';
    if (preferred) setAgentForm((f) => ({ ...f, oddzial_id: String(preferred) }));
  }, [tab, oddzialy, agentForm.oddzial_id]);

  useEffect(() => {
    if (!selectedAgentIntake) return;
    setAgentFixForm({
      customer_name: selectedAgentIntake.customer_name || '',
      caller_phone: selectedAgentIntake.caller_phone || '',
      inspection_address: selectedAgentIntake.inspection_address || '',
      city: selectedAgentIntake.city || '',
      service_type: selectedAgentIntake.service_type || '',
      appointment_at: toDateTimeLocal(selectedAgentIntake.appointment_at),
      notes: selectedAgentIntake.notes || '',
      transcript: selectedAgentIntake.transcript || '',
      create_missing_inspection: !selectedAgentIntake.ogledziny_id,
    });
  }, [selectedAgentIntake]);

  const loadVoiceAgentIntegration = useCallback(async (oddzialIdArg) => {
    const oddzialId = oddzialIdArg || agentForm.oddzial_id;
    if (!oddzialId) return;
    setAgentLoading(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/telephony/voice-agent/polska-flora/integration?oddzial_id=${encodeURIComponent(oddzialId)}`, {
        headers: authHeaders(token),
      });
      setAgentConfig(data.config || null);
      setAgentIntegration(data.integration || null);
      setAgentForm((f) => ({
        ...f,
        oddzial_id: String(oddzialId),
        provider: data.integration?.provider || f.provider || 'zadarma',
        provider_account_id: data.integration?.provider_account_id || f.provider_account_id || '',
        provider_api_key: '',
        status: data.integration?.status || f.status || 'active',
      }));
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie pobrac konfiguracji agenta.'));
    } finally {
      setAgentLoading(false);
    }
  }, [agentForm.oddzial_id]);

  const loadVoiceAgentIntakes = useCallback(async (oddzialIdArg) => {
    const oddzialId = oddzialIdArg || agentForm.oddzial_id;
    if (!oddzialId) return;
    setAgentIntakesLoading(true);
    try {
      const token = getStoredToken();
      const qs = new URLSearchParams();
      qs.set('oddzial_id', String(oddzialId));
      qs.set('limit', String(AGENT_HISTORY_PAGE_SIZE));
      qs.set('offset', String((Math.max(1, agentHistoryPage) - 1) * AGENT_HISTORY_PAGE_SIZE));
      qs.set('filter', agentHistoryFilter || 'all');
      const agentQ = agentHistoryQuery.trim().slice(0, 200);
      if (agentQ) qs.set('q', agentQ);
      const { data } = await api.get(`/telephony/voice-agent/polska-flora/intakes?${qs.toString()}`, {
        headers: authHeaders(token),
      });
      setAgentIntakes(Array.isArray(data.items) ? data.items : []);
      setAgentIntakesTotal(Number(data.total || 0));
      setAgentIntakesSummary(data.summary || { all: 0, needs_review: 0, sms_missing: 0, sms_error: 0, scheduled: 0 });
      setSelectedAgentIntake((current) => {
        if (!current?.id) return current;
        return (data.items || []).find((row) => Number(row.id) === Number(current.id)) || null;
      });
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie pobrac historii rozmow agenta.'));
    } finally {
      setAgentIntakesLoading(false);
    }
  }, [agentForm.oddzial_id, agentHistoryFilter, agentHistoryPage, agentHistoryQuery]);

  const loadAgentReminderPreview = useCallback(async (oddzialIdArg) => {
    const oddzialId = oddzialIdArg || agentForm.oddzial_id;
    if (!oddzialId) return;
    setAgentReminderLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/automations/inspection-sms-reminders/preview?oddzial_id=${encodeURIComponent(oddzialId)}`, {
        headers: authHeaders(token),
      });
      setAgentReminderPreview({
        total: Number(data.total || 0),
        items: Array.isArray(data.items) ? data.items : [],
      });
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie pobrac podgladu przypomnien SMS.'));
    } finally {
      setAgentReminderLoading(false);
    }
  }, [agentForm.oddzial_id]);

  const loadIntegrationTestLogs = useCallback(async (oddzialIdArg) => {
    const oddzialId = oddzialIdArg || agentForm.oddzial_id;
    if (!oddzialId) return;
    setIntegrationTestLogsLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/telephony/integration-test-logs?oddzial_id=${encodeURIComponent(oddzialId)}&limit=8`, {
        headers: authHeaders(token),
      });
      setIntegrationTestLogs(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie pobrac historii testow integracji.'));
    } finally {
      setIntegrationTestLogsLoading(false);
    }
  }, [agentForm.oddzial_id]);

  const loadBranchIntegrationStatuses = useCallback(async () => {
    setBranchIntegrationStatusesLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get('/telephony/voice-agent/polska-flora/integrations/status', {
        headers: authHeaders(token),
      });
      setBranchIntegrationStatuses(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie pobrac statusow podpiecia oddzialow.'));
    } finally {
      setBranchIntegrationStatusesLoading(false);
    }
  }, []);

  const loadZadarmaSettings = useCallback(async () => {
    setZadarmaLoading(true);
    setZadarmaError('');
    try {
      const token = getStoredToken();
      const { data } = await api.get('/telephony/zadarma/settings', { headers: authHeaders(token) });
      setZadarmaSettings(data || null);
      setZadarmaForm((f) => ({
        ...f,
        caller_id: data?.caller_id || f.caller_id || 'ARBOR',
      }));
    } catch (e) {
      setZadarmaError(getApiErrorMessage(e, 'Nie udalo sie pobrac ustawien Zadarmy.'));
    } finally {
      setZadarmaLoading(false);
    }
  }, []);

  const saveZadarmaSettings = async (e) => {
    e.preventDefault();
    setZadarmaSaving(true);
    setZadarmaError('');
    setZadarmaMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.put('/telephony/zadarma/settings', {
        api_key: zadarmaForm.api_key || null,
        api_secret: zadarmaForm.api_secret || null,
        caller_id: zadarmaForm.caller_id || 'ARBOR',
      }, { headers: authHeaders(token) });
      setZadarmaSettings(data || null);
      setZadarmaForm((f) => ({ ...f, api_key: '', api_secret: '', caller_id: data?.caller_id || f.caller_id }));
      setZadarmaMessage('Zadarma zapisana. Od teraz SMS i przycisk polaczenia moga korzystac z tej konfiguracji.');
    } catch (err) {
      setZadarmaError(getApiErrorMessage(err, 'Nie udalo sie zapisac Zadarmy.'));
    } finally {
      setZadarmaSaving(false);
    }
  };

  const testZadarmaSettings = async () => {
    setZadarmaTesting(true);
    setZadarmaError('');
    setZadarmaMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/telephony/zadarma/test', {}, { headers: authHeaders(token) });
      setZadarmaSettings(data.settings || zadarmaSettings);
      setZadarmaMessage(data.message || 'Zadarma API dziala.');
    } catch (err) {
      setZadarmaError(getApiErrorMessage(err, 'Test Zadarmy nie przeszedl.'));
    } finally {
      setZadarmaTesting(false);
    }
  };

  useEffect(() => {
    if (tab === 'agent' && agentForm.oddzial_id) {
      loadBranchIntegrationStatuses();
      loadVoiceAgentIntegration(agentForm.oddzial_id);
      loadVoiceAgentIntakes(agentForm.oddzial_id);
      loadAgentReminderPreview(agentForm.oddzial_id);
      loadIntegrationTestLogs(agentForm.oddzial_id);
    }
  }, [tab, agentForm.oddzial_id, loadBranchIntegrationStatuses, loadVoiceAgentIntegration, loadVoiceAgentIntakes, loadAgentReminderPreview, loadIntegrationTestLogs]);

  useEffect(() => {
    if (tab === 'zadarma') loadZadarmaSettings();
  }, [tab, loadZadarmaSettings]);

  useEffect(() => {
    setAgentHistoryPage(1);
  }, [agentHistoryFilter, agentHistoryQuery, agentForm.oddzial_id]);

  const saveVoiceAgentIntegration = async (e) => {
    e.preventDefault();
    if (!agentForm.oddzial_id) {
      setAgentError('Wybierz oddzial.');
      return;
    }
    setAgentSaving(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/telephony/voice-agent/polska-flora/integration', {
        oddzial_id: Number(agentForm.oddzial_id),
        provider: agentForm.provider || 'zadarma',
        provider_account_id: agentForm.provider_account_id || null,
        provider_api_key: agentForm.provider_api_key || null,
        status: agentForm.status || 'active',
      }, { headers: authHeaders(token) });
      setAgentIntegration(data.integration || null);
      setAgentConfig(data.config || agentConfig);
      setAgentForm((f) => ({ ...f, provider_api_key: '' }));
      setAgentMessage('Agent Ania jest wlaczony dla oddzialu. Webhook i sekret sa gotowe do wklejenia u providera.');
      await loadVoiceAgentIntakes(agentForm.oddzial_id);
      await loadAgentReminderPreview(agentForm.oddzial_id);
      await loadBranchIntegrationStatuses();
    } catch (e2) {
      setAgentError(getApiErrorMessage(e2, 'Nie udalo sie wlaczyc agenta.'));
    } finally {
      setAgentSaving(false);
    }
  };

  const testVoiceAgentIntegration = async () => {
    if (!agentForm.oddzial_id) return;
    setAgentTestLoading(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/telephony/voice-agent/polska-flora/integration/test', {
        oddzial_id: Number(agentForm.oddzial_id),
      }, { headers: authHeaders(token) });
      setAgentMessage(data.message || 'Test konfiguracji OK.');
      await loadVoiceAgentIntegration(agentForm.oddzial_id);
      await loadIntegrationTestLogs(agentForm.oddzial_id);
      await loadVoiceAgentIntakes(agentForm.oddzial_id);
      await loadAgentReminderPreview(agentForm.oddzial_id);
      await loadBranchIntegrationStatuses();
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Test konfiguracji nie przeszedl.'));
    } finally {
      setAgentTestLoading(false);
    }
  };

  const saveAgentIntakeFix = async (e) => {
    e.preventDefault();
    if (!selectedAgentIntake?.id) return;
    setAgentFixSaving(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.patch(`/telephony/voice-agent/polska-flora/intakes/${selectedAgentIntake.id}`, {
        customer_name: agentFixForm.customer_name || null,
        caller_phone: agentFixForm.caller_phone || null,
        inspection_address: agentFixForm.inspection_address || null,
        city: agentFixForm.city || null,
        service_type: agentFixForm.service_type || null,
        appointment_at: agentFixForm.appointment_at || null,
        notes: agentFixForm.notes || null,
        transcript: agentFixForm.transcript || null,
        create_missing_inspection: !!agentFixForm.create_missing_inspection,
      }, { headers: authHeaders(token) });
      if (data.intake) setSelectedAgentIntake(data.intake);
      await loadVoiceAgentIntakes(agentForm.oddzial_id);
      setAgentMessage(data.intake?.quality_status === 'ok'
        ? 'Korekta zapisana. Rozmowa ma komplet danych.'
        : 'Korekta zapisana, ale rozmowa nadal wymaga sprawdzenia.');
      await loadAgentReminderPreview(agentForm.oddzial_id);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie zapisac korekty rozmowy.'));
    } finally {
      setAgentFixSaving(false);
    }
  };

  const setVoiceAgentStatus = async (status) => {
    if (!agentForm.oddzial_id) return;
    setAgentSaving(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/telephony/voice-agent/polska-flora/integration', {
        oddzial_id: Number(agentForm.oddzial_id),
        provider: agentForm.provider || agentIntegration?.provider || 'zadarma',
        provider_account_id: agentForm.provider_account_id || agentIntegration?.provider_account_id || null,
        provider_api_key: null,
        status,
      }, { headers: authHeaders(token) });
      setAgentIntegration(data.integration || null);
      setAgentForm((f) => ({ ...f, status }));
      setAgentMessage(status === 'active'
        ? 'Agent Ania i automatyczne przypomnienia sa aktywne dla oddzialu.'
        : 'Agent Ania zatrzymany. Webhook i przypomnienia SMS nie beda dzialac dla tego oddzialu.');
      await Promise.all([
        loadVoiceAgentIntegration(agentForm.oddzial_id),
        loadAgentReminderPreview(agentForm.oddzial_id),
        loadBranchIntegrationStatuses(),
      ]);
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie zmienic statusu agenta.'));
    } finally {
      setAgentSaving(false);
    }
  };

  const sendAgentConfirmationSms = async () => {
    if (!selectedAgentIntake?.id) return;
    setAgentSmsSending(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const body = buildAgentSmsConfirmation(selectedAgentIntake);
      await api.post(`/telephony/voice-agent/polska-flora/intakes/${selectedAgentIntake.id}/sms`, {
        body,
      }, { headers: authHeaders(token) });
      setAgentMessage('SMS potwierdzajacy ogledziny zostal wyslany i zapisany w CRM.');
      await Promise.all([
        loadVoiceAgentIntakes(agentForm.oddzial_id),
        loadAgentReminderPreview(agentForm.oddzial_id),
        loadSms(1),
      ]);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie wyslac SMS potwierdzajacego.'));
    } finally {
      setAgentSmsSending(false);
    }
  };

  const saveBranchTelephony = async (e) => {
    e.preventDefault();
    if (!agentForm.oddzial_id) {
      setAgentError('Wybierz oddzial.');
      return;
    }
    setBranchTelephonySaving(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      await api.put(`/oddzialy/${agentForm.oddzial_id}`, {
        telefon: branchTelephonyForm.telefon.trim(),
        sms_sender_id: branchTelephonyForm.sms_sender_id.trim(),
      }, { headers: authHeaders(token) });
      setAgentMessage('Numery oddzialu zapisane. SMS i Agent AI beda uzywac tej konfiguracji oddzialowej.');
      await Promise.all([
        loadTelephonyExtras(),
        loadVoiceAgentIntegration(agentForm.oddzial_id),
        loadBranchIntegrationStatuses(),
      ]);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie zapisac numerow oddzialu.'));
    } finally {
      setBranchTelephonySaving(false);
    }
  };

  const sendBranchTestSms = async () => {
    if (!agentForm.oddzial_id) {
      setAgentError('Wybierz oddzial.');
      return;
    }
    if (!branchTelephonyForm.test_phone.trim()) {
      setAgentError('Podaj numer do testu SMS.');
      return;
    }
    if (!isValidPhone(branchTelephonyForm.test_phone)) {
      setAgentError('Nieprawidlowy numer telefonu testowego. Uzyj formatu +48123123123 lub 123123123.');
      return;
    }
    setBranchSmsTesting(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/sms/oddzial-test', {
        oddzial_id: Number(agentForm.oddzial_id),
        telefon: normalizePhone(branchTelephonyForm.test_phone.trim()),
      }, { headers: authHeaders(token) });
      setAgentMessage(`Test SMS wyslany z oddzialu ${oddzialLabel(agentForm.oddzial_id)} (${data.provider || 'provider'}).`);
      await loadIntegrationTestLogs(agentForm.oddzial_id);
      await loadBranchIntegrationStatuses();
      await loadSms(1);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie wyslac testowego SMS oddzialu.'));
    } finally {
      setBranchSmsTesting(false);
    }
  };

  const runBranchSetupTest = async () => {
    if (!agentForm.oddzial_id) {
      setAgentError('Wybierz oddzial.');
      return;
    }
    if (!agentIntegration) {
      setAgentError('Najpierw wlacz agenta dla oddzialu.');
      return;
    }
    const testPhone = normalizePhone(branchTelephonyForm.test_phone.trim());
    if (branchTelephonyForm.test_phone.trim() && !isValidPhone(branchTelephonyForm.test_phone)) {
      setAgentError('Nieprawidlowy numer telefonu testowego. Uzyj formatu +48123123123 lub 123123123.');
      return;
    }
    setBranchSetupTesting(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      await api.post('/telephony/voice-agent/polska-flora/integration/test', {
        oddzial_id: Number(agentForm.oddzial_id),
      }, { headers: authHeaders(token) });
      let smsNote = 'SMS pominiety - wpisz numer testowy, zeby sprawdzic nadawce.';
      if (testPhone) {
        const { data } = await api.post('/sms/oddzial-test', {
          oddzial_id: Number(agentForm.oddzial_id),
          telefon: testPhone,
        }, { headers: authHeaders(token) });
        smsNote = `SMS OK (${data.provider || 'provider'}).`;
      }
      setAgentMessage(`Test calosci oddzialu OK: webhook gotowy. ${smsNote}`);
      await Promise.all([
        loadVoiceAgentIntegration(agentForm.oddzial_id),
        loadIntegrationTestLogs(agentForm.oddzial_id),
        loadVoiceAgentIntakes(agentForm.oddzial_id),
        loadAgentReminderPreview(agentForm.oddzial_id),
        loadBranchIntegrationStatuses(),
        testPhone ? loadSms(1) : Promise.resolve(),
      ]);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Test calosci oddzialu nie przeszedl.'));
      await Promise.all([
        loadIntegrationTestLogs(agentForm.oddzial_id),
        loadBranchIntegrationStatuses(),
      ]);
    } finally {
      setBranchSetupTesting(false);
    }
  };

  const buildPreparedProviderPackage = ({ integration, row }) => JSON.stringify({
    provider: integration?.provider || agentForm.provider || row?.provider || 'zadarma',
    provider_account_id: integration?.provider_account_id || agentForm.provider_account_id || row?.provider_account_id || null,
    branch: {
      oddzial_id: row?.oddzial_id ? Number(row.oddzial_id) : null,
      name: row?.oddzial_name || oddzialLabel(row?.oddzial_id),
      city: row?.miasto || null,
      phone: row?.telefon || branchTelephonyForm.telefon || null,
      sms_sender_id: row?.sms_sender_id || branchTelephonyForm.sms_sender_id || row?.telefon || null,
    },
    webhook: {
      url: integration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake',
      method: 'POST',
      secret_header: 'x-voice-agent-secret',
      secret: integration?.webhook_secret || '',
    },
    one_click_notes: [
      'Ta paczka jest oddzialowa - nie mieszaj sekretow ani numerow pomiedzy oddzialami.',
      'W panelu Zadarma ustaw webhook POST i header x-voice-agent-secret.',
      'Payload musi wysylac oddzial_id oraz dane rozmowy klienta.',
      'Po zapisaniu w providerze uruchom w ARBOR-OS Test calosci oddzialu.',
    ],
    payload_example: {
      oddzial_id: row?.oddzial_id ? Number(row.oddzial_id) : null,
      call_sid: 'provider-call-id',
      caller_phone: '+48123123123',
      customer_name: 'Jan Kowalski',
      inspection_address: 'ul. Przykladowa 1',
      city: row?.miasto || 'Krakow',
      service_type: 'ogrod',
      appointment_at: new Date(Date.now() + 86400000).toISOString(),
      notes: 'Klient prosi o bezplatne ogledziny.',
      transcript: 'Skrocony transkrypt rozmowy.',
    },
  }, null, 2);

  const branchSetupPhonePatch = () => ({
    telefon: branchTelephonyForm.telefon.trim(),
    sms_sender_id: branchTelephonyForm.sms_sender_id.trim(),
  });

  const mergeBranchTelephonyIntoStatus = (row, patch) => ({
    ...row,
    telefon: patch.telefon || row?.telefon || '',
    sms_sender_id: patch.sms_sender_id || row?.sms_sender_id || '',
  });

  const prepareBranchProviderConnection = async (row = selectedBranchStatus) => {
    if (!row?.oddzial_id) {
      setAgentError('Wybierz oddzial do podpiecia.');
      return;
    }
    setBranchQuickConnectingId(row.oddzial_id);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const branchPatch = branchSetupPhonePatch();
      const hasBranchPatch = branchPatch.telefon || branchPatch.sms_sender_id;
      if (hasBranchPatch) {
        await api.put(`/oddzialy/${row.oddzial_id}`, branchPatch, { headers: authHeaders(token) });
      }
      const preparedRow = mergeBranchTelephonyIntoStatus(row, branchPatch);
      const body = {
        oddzial_id: Number(preparedRow.oddzial_id),
        provider: preparedRow.provider || agentForm.provider || 'zadarma',
        provider_account_id: preparedRow.provider_account_id || agentForm.provider_account_id || null,
        provider_api_key: null,
        status: preparedRow.integration_status === 'paused' ? 'paused' : 'active',
      };
      const { data } = await api.post('/telephony/voice-agent/polska-flora/integration', body, { headers: authHeaders(token) });
      const integration = data.integration || null;
      setAgentIntegration(integration);
      setAgentConfig(data.config || agentConfig);
      setAgentForm((f) => ({
        ...f,
        oddzial_id: String(row.oddzial_id),
        provider: integration?.provider || body.provider,
        provider_account_id: integration?.provider_account_id || body.provider_account_id || '',
        provider_api_key: '',
        status: integration?.status || body.status,
      }));
      setBranchTelephonyForm((f) => ({
        ...f,
        telefon: preparedRow.telefon || f.telefon,
        sms_sender_id: preparedRow.sms_sender_id || f.sms_sender_id,
      }));
      await navigator.clipboard.writeText(buildPreparedProviderPackage({ integration, row: preparedRow }));
      setAgentMessage(`Podpiecie oddzialu ${preparedRow.oddzial_name || `#${preparedRow.oddzial_id}`} gotowe i skopiowane. Numery oddzialu sa zapisane, wklej paczke w panelu Zadarma, potem uruchom Test calosci oddzialu.`);
      await Promise.all([
        hasBranchPatch ? loadTelephonyExtras() : Promise.resolve(),
        loadVoiceAgentIntegration(preparedRow.oddzial_id),
        loadIntegrationTestLogs(preparedRow.oddzial_id),
        loadAgentReminderPreview(preparedRow.oddzial_id),
        loadBranchIntegrationStatuses(),
      ]);
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie przygotowac podpiecia oddzialu.'));
    } finally {
      setBranchQuickConnectingId(null);
    }
  };

  const copyAgentText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setAgentMessage(`${label} skopiowane.`);
    } catch {
      setAgentError(`Nie udalo sie skopiowac: ${label}.`);
    }
  };

  const createBranchRetestNotifications = async () => {
    setBranchRetestCreating(true);
    setAgentError('');
    setAgentMessage('');
    try {
      const token = getStoredToken();
      const { data } = await api.post('/telephony/voice-agent/polska-flora/retests/notifications', {
        max_age_days: BRANCH_TEST_STALE_DAYS,
      }, { headers: authHeaders(token) });
      setAgentMessage(
        `Retesty: utworzono ${Number(data.notifications_created || 0)} powiadomien dla ${Number(data.branches_total || 0)} oddzialow. Pominieto duplikaty: ${Number(data.duplicates_skipped || 0)}.`
      );
      await loadBranchIntegrationStatuses();
    } catch (err) {
      setAgentError(getApiErrorMessage(err, 'Nie udalo sie utworzyc powiadomien retestu.'));
    } finally {
      setBranchRetestCreating(false);
    }
  };

  const buildAgentProviderPackage = () => JSON.stringify({
    provider: agentIntegration?.provider || agentForm.provider || 'zadarma',
    branch: {
      oddzial_id: agentForm.oddzial_id ? Number(agentForm.oddzial_id) : null,
      name: oddzialLabel(agentForm.oddzial_id),
      phone: branchTelephonyForm.telefon || selectedAgentBranch?.telefon || null,
      sms_sender_id: branchTelephonyForm.sms_sender_id || selectedAgentBranch?.sms_sender_id || null,
    },
    webhook: {
      url: agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake',
      method: 'POST',
      secret_header: 'x-voice-agent-secret',
      secret: agentIntegration?.webhook_secret || '',
    },
    payload_example: {
      oddzial_id: agentForm.oddzial_id ? Number(agentForm.oddzial_id) : null,
      call_sid: 'provider-call-id',
      caller_phone: '+48123123123',
      customer_name: 'Jan Kowalski',
      inspection_address: 'ul. Przykladowa 1',
      city: 'Krakow',
      service_type: 'ogrod',
      appointment_at: new Date(Date.now() + 86400000).toISOString(),
      notes: 'Klient prosi o bezplatne ogledziny.',
      transcript: 'Skrocony transkrypt rozmowy.',
    },
    notes: [
      'Wysylaj sekret w headerze x-voice-agent-secret.',
      'Oddzial decyduje o numerze i nadawcy SMS.',
      'Nie podawaj cen przez telefon; umawiaj bezplatne ogledziny.',
    ],
  }, null, 2);

  const buildBranchProviderPackage = (row) => {
    const readiness = branchReadiness(row);
    return JSON.stringify({
      provider: agentIntegration?.provider || agentForm.provider || row?.provider || 'zadarma',
      provider_account_id: agentIntegration?.provider_account_id || agentForm.provider_account_id || row?.provider_account_id || null,
      branch: {
        oddzial_id: row?.oddzial_id ? Number(row.oddzial_id) : (agentForm.oddzial_id ? Number(agentForm.oddzial_id) : null),
        name: row?.oddzial_name || oddzialLabel(agentForm.oddzial_id),
        city: row?.miasto || null,
        phone: row?.telefon || branchTelephonyForm.telefon || selectedAgentBranch?.telefon || null,
        sms_sender_id: row?.sms_sender_id || branchTelephonyForm.sms_sender_id || selectedAgentBranch?.sms_sender_id || row?.telefon || null,
      },
      webhook: {
        url: agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake',
        method: 'POST',
        secret_header: 'x-voice-agent-secret',
        secret: agentIntegration?.webhook_secret || '',
      },
      readiness: {
        stage: branchLaunchStage(row).label,
        percent: readiness.percent,
        blockers: readiness.blockers,
        next_action: branchNextAction(row),
        last_test: row?.last_test_log_at
          ? {
              status: row.last_test_log_status || null,
              at: row.last_test_log_at,
              age_days: branchLastTestAgeDays(row),
              max_age_days: BRANCH_TEST_STALE_DAYS,
              fresh_ok: branchHasFreshOkTest(row),
            }
          : null,
        sms_errors: Number(row?.sms_errors || 0),
        needs_review: Number(row?.needs_review || 0),
      },
      provider_instructions: {
        set_webhook_method: 'POST',
        add_header: 'x-voice-agent-secret',
        send_oddzial_id: row?.oddzial_id ? Number(row.oddzial_id) : (agentForm.oddzial_id ? Number(agentForm.oddzial_id) : null),
        run_test_after_setup: 'Kliknij Test calosci oddzialu w ARBOR-OS.',
      },
    }, null, 2);
  };

  const buildBranchProviderBrief = (row) => {
    const readiness = branchReadiness(row);
    const provider = agentIntegration?.provider || agentForm.provider || row?.provider || 'zadarma';
    return [
      `Podpiecie telefonii AI - ${row?.oddzial_name || oddzialLabel(agentForm.oddzial_id)}`,
      '',
      `Provider: ${provider}`,
      `ID providera/asystenta: ${agentIntegration?.provider_account_id || agentForm.provider_account_id || row?.provider_account_id || 'brak'}`,
      `Telefon oddzialu: ${row?.telefon || branchTelephonyForm.telefon || selectedAgentBranch?.telefon || 'brak'}`,
      `Nadawca SMS: ${row?.sms_sender_id || branchTelephonyForm.sms_sender_id || selectedAgentBranch?.sms_sender_id || row?.telefon || 'brak'}`,
      '',
      'Webhook:',
      `- URL: ${agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake'}`,
      '- Metoda: POST',
      '- Header: x-voice-agent-secret',
      `- Sekret: ${agentIntegration?.webhook_secret || 'brak - wlacz agenta w panelu'}`,
      '',
      'Wymagane po stronie Zadarma:',
      '- ustaw webhook po rozmowie / po zebraniu danych klienta',
      '- wysylaj oddzial_id w payloadzie',
      '- przekazuj telefon klienta, imie/nazwisko, adres, miasto, typ uslugi, termin i transkrypt',
      '- po podpieciu wykonaj test w ARBOR-OS: Test calosci oddzialu',
      '',
      `Gotowosc w ARBOR-OS: ${readiness.percent}%`,
      `Etap: ${branchLaunchStage(row).label}`,
      `Braki: ${readiness.blockers.length ? readiness.blockers.join(', ') : 'brak'}`,
      branchNextAction(row),
    ].join('\n');
  };

  const buildProviderChecklist = () => {
    const provider = agentIntegration?.provider || agentForm.provider || 'zadarma';
    const providerName = {
      external: 'Provider zewnetrzny',
      vapi: 'Vapi',
      elevenlabs: 'ElevenLabs',
      twilio: 'Twilio',
      zadarma: 'Zadarma',
    }[provider] || provider;
    const webhookUrl = agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake';
    const branchPhone = branchTelephonyForm.telefon || selectedAgentBranch?.telefon || '';
    const smsSender = branchTelephonyForm.sms_sender_id || selectedAgentBranch?.sms_sender_id || branchPhone || '';
    const lastWebhookLog = integrationTestLogs.find((log) => log.integration_type === 'voice_agent' && log.action === 'webhook_config_test');
    const lastWebhookOk = integrationTestLogs.find((log) => log.integration_type === 'voice_agent' && log.action === 'webhook_config_test' && log.status === 'ok');
    const lastSmsLog = integrationTestLogs.find((log) => log.integration_type === 'sms' && log.action === 'branch_sender_test');
    const lastSmsOk = integrationTestLogs.find((log) => log.integration_type === 'sms' && log.action === 'branch_sender_test' && log.status === 'ok');
    const steps = [
        {
          label: 'Oddzial wybrany',
          ready: !!agentForm.oddzial_id,
          detail: agentForm.oddzial_id ? oddzialLabel(agentForm.oddzial_id) : 'Wybierz oddzial przed podpieciem.',
        },
        {
          label: 'Numer oddzialu',
          ready: !!branchPhone,
          detail: branchPhone || 'Uzupelnij numer oddzialu w sekcji Numery oddzialu.',
        },
        {
          label: 'Nadawca SMS',
          ready: !!smsSender,
          detail: smsSender || 'Dodaj SMS sender ID albo telefon oddzialu.',
        },
        {
          label: 'Agent wlaczony',
          ready: !!agentIntegration,
          detail: agentIntegration ? `Status: ${agentIntegration.status || 'aktywny'}` : 'Kliknij Wlacz agenta.',
        },
        {
          label: 'Webhook URL',
          ready: !!webhookUrl,
          detail: webhookUrl,
          copy: webhookUrl,
        },
        {
          label: 'Sekret webhooka',
          ready: !!agentIntegration?.webhook_secret,
          detail: agentIntegration?.webhook_secret ? 'Gotowy do wklejenia w header x-voice-agent-secret.' : 'Pojawi sie po wlaczeniu agenta.',
          copy: agentIntegration?.webhook_secret || '',
        },
        {
          label: provider === 'external' ? 'ID providera' : `ID ${providerName}`,
          ready: provider === 'external' || !!(agentForm.provider_account_id || agentIntegration?.provider_account_id),
          detail: provider === 'external'
            ? 'Opcjonalne przy zwyklym webhooku.'
            : (agentForm.provider_account_id || agentIntegration?.provider_account_id || 'Wklej ID asystenta/konta z panelu providera.'),
        },
        {
          label: 'Test webhooka OK',
          ready: !!lastWebhookOk,
          detail: lastWebhookOk
            ? `Ostatni OK: ${formatAgentDate(lastWebhookOk.created_at)}`
            : (lastWebhookLog?.error || 'Kliknij Test calosci oddzialu albo Test konfiguracji.'),
        },
        {
          label: 'Test SMS oddzialu OK',
          ready: !!lastSmsOk,
          detail: lastSmsOk
            ? `Ostatni OK: ${formatAgentDate(lastSmsOk.created_at)}`
            : (lastSmsLog?.error || 'Wpisz numer testowy i kliknij Test calosci oddzialu.'),
        },
      ];
    const readyCount = steps.filter((step) => step.ready).length;
    const readiness = Math.round((readyCount / Math.max(steps.length, 1)) * 100);
    const blockers = steps.filter((step) => !step.ready).map((step) => `${step.label}: ${step.detail}`);
    return {
      providerName,
      steps,
      readyCount,
      totalCount: steps.length,
      readiness,
      blockers,
      reportText: [
        `Audyt podpiecia Agenta AI - ${oddzialLabel(agentForm.oddzial_id)}`,
        `Provider: ${providerName}`,
        `Gotowosc: ${readiness}% (${readyCount}/${steps.length})`,
        '',
        'Status krokow:',
        ...steps.map((step) => `- ${step.ready ? 'OK' : 'BRAK'} ${step.label}: ${step.detail}`),
        '',
        blockers.length ? 'Blokery:' : 'Blokery: brak',
        ...blockers.map((item) => `- ${item}`),
      ].join('\n'),
    };
  };

  const buildProviderSetupGuide = () => {
    const provider = agentIntegration?.provider || agentForm.provider || 'zadarma';
    const webhookUrl = agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake';
    const secret = agentIntegration?.webhook_secret || '';
    const guides = {
      external: {
        title: 'Zwykly webhook',
        steps: [
          'Ustaw webhook typu POST po zakonczonej rozmowie lub po zebraniu danych klienta.',
          'Wklej Webhook URL jako adres docelowy.',
          'Dodaj header x-voice-agent-secret z sekretem oddzialu.',
          'Wysylaj pola: caller_phone, customer_name, inspection_address, city, service_type, appointment_at, notes, transcript.',
        ],
      },
      vapi: {
        title: 'Vapi',
        steps: [
          'W Vapi otworz Assistant albo Workflow dla numeru oddzialu.',
          'W sekcji Server / Webhook ustaw POST na Webhook URL.',
          'Dodaj header x-voice-agent-secret z sekretem oddzialu.',
          'W payload mapperze przekaz caller_phone, transcript, appointment_at i dane adresowe.',
        ],
      },
      elevenlabs: {
        title: 'ElevenLabs',
        steps: [
          'W Conversational AI otworz agenta przypisanego do numeru oddzialu.',
          'Dodaj webhook / post-call webhook z metoda POST.',
          'Dodaj header x-voice-agent-secret z sekretem oddzialu.',
          'W danych rozmowy przekaz telefon klienta, streszczenie, adres i termin ogledzin.',
        ],
      },
      twilio: {
        title: 'Twilio',
        steps: [
          'W numerze Twilio albo TwiML App ustaw webhook po rozmowie na Webhook URL.',
          'Dodaj x-voice-agent-secret jako custom header, jesli flow to obsluguje.',
          'Jezeli uzywasz Studio Flow, wyslij HTTP Request po zebraniu danych klienta.',
          'Mapuj From jako caller_phone, CallSid jako call_sid i przekaz transkrypt/notatki.',
        ],
      },
      zadarma: {
        title: 'Zadarma',
        steps: [
          'W panelu Zadarma ustaw powiadomienie/webhook dla numeru oddzialu.',
          'Jesli header nie jest obslugiwany, uzyj integratora posredniego i dodaj x-voice-agent-secret.',
          'Webhook musi wyslac POST z numerem klienta, statusem rozmowy i notatka agenta.',
          'Po tescie sprawdz Ostatnie testy integracji w tym panelu.',
        ],
      },
    };
    const guide = guides[provider] || guides.external;
    return {
      ...guide,
      text: [
        `Provider: ${guide.title}`,
        `Oddzial: ${oddzialLabel(agentForm.oddzial_id)}`,
        `Webhook URL: ${webhookUrl}`,
        'Header: x-voice-agent-secret',
        `Sekret: ${secret || '(wlacz agenta, zeby wygenerowac sekret)'}`,
        '',
        ...guide.steps.map((step, index) => `${index + 1}. ${step}`),
      ].join('\n'),
    };
  };

  const saveCallLog = async (e) => {
    e.preventDefault();
    const oid = toIntLocal(callForm.oddzial_id);
    const phone = normalizePhone(callForm.phone);
    if (!oid) {
      setTelError('Wybierz oddział.');
      return;
    }
    if (!phone) {
      setTelError('Podaj numer telefonu.');
      return;
    }
    setSavingCall(true);
    setTelError('');
    setTelMessage('');
    try {
      const token = getStoredToken();
      const taskId = toIntLocal(callForm.task_id);
      const { data } = await api.post(
        '/telephony/calls',
        {
          oddzial_id: oid,
          phone,
          call_type: callForm.call_type,
          status: callForm.status,
          duration_sec: callForm.duration_sec === '' ? 0 : Number(callForm.duration_sec) || 0,
          task_id: taskId || undefined,
          lead_name: callForm.lead_name.trim() || null,
          notes: callForm.notes.trim() || null,
        },
        { headers: authHeaders(token) }
      );
      setCallForm((f) => ({
        ...f,
        phone: '',
        duration_sec: '',
        lead_name: '',
        notes: '',
        task_id: '',
      }));
      await loadTelephonyExtras();
      setTelMessage(`Polaczenie zapisane w logu${data?.id ? ` (#${data.id})` : ''}.`);
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udało się zapisać połączenia.'));
    } finally {
      setSavingCall(false);
    }
  };

  const startSpecialistCall = async ({ phone, oddzial_id, lead_name, task_id, notes, callbackId, key }) => {
    const oid = toIntLocal(oddzial_id || callForm.oddzial_id || agentForm.oddzial_id);
    const targetPhone = normalizePhone(phone);
    const href = telHref(targetPhone);
    if (!oid) {
      setTelError('Wybierz oddzial przed polaczeniem.');
      return;
    }
    if (!targetPhone || !href) {
      setTelError('Podaj poprawny numer klienta.');
      return;
    }
    const callKey = key || `${oid}:${targetPhone}:${callbackId || 'manual'}`;
    setStartingCallKey(callKey);
    setTelError('');
    setTelMessage('');
    try {
      const token = getStoredToken();
      const taskId = toIntLocal(task_id);
      await api.post(
        '/telephony/calls',
        {
          oddzial_id: oid,
          phone: targetPhone,
          call_type: 'outbound',
          status: 'dialing',
          duration_sec: 0,
          task_id: taskId || undefined,
          lead_name: String(lead_name || '').trim() || null,
          notes: String(notes || 'Specjalista rozpoczal polaczenie z panelu Telefonia.').trim(),
        },
        { headers: authHeaders(token) }
      );
      if (callbackId) {
        await api.patch(`/telephony/callbacks/${callbackId}/status`, { status: 'in_progress' }, { headers: authHeaders(token) });
      }
      setCallForm((f) => ({
        ...f,
        oddzial_id: String(oid),
        phone: targetPhone,
        call_type: 'outbound',
        status: 'answered',
        task_id: taskId ? String(taskId) : '',
        lead_name: String(lead_name || ''),
        notes: '',
      }));
      await loadTelephonyExtras();
      setTelMessage(callbackId ? 'Polaczenie rozpoczete i callback oznaczony jako w toku.' : 'Polaczenie rozpoczete i zapisane w logu.');
      window.location.href = href;
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udalo sie rozpoczac polaczenia specjalisty.'));
    } finally {
      setStartingCallKey(null);
    }
  };

  const saveIncomingCall = async (e) => {
    e.preventDefault();
    const oid = toIntLocal(incomingForm.oddzial_id);
    const phone = normalizePhone(incomingForm.phone);
    if (!oid) {
      setTelError('Wybierz oddzial dla telefonu przychodzacego.');
      return;
    }
    if (!phone) {
      setTelError('Podaj numer klienta.');
      return;
    }
    setSavingCall(true);
    setTelError('');
    setTelMessage('');
    try {
      const token = getStoredToken();
      const taskId = toIntLocal(incomingForm.task_id);
      const callResult = await api.post(
        '/telephony/calls',
        {
          oddzial_id: oid,
          phone,
          call_type: 'inbound',
          status: incomingForm.status,
          duration_sec: 0,
          task_id: taskId || undefined,
          lead_name: incomingForm.lead_name.trim() || null,
          notes: incomingForm.notes.trim() || null,
        },
        { headers: authHeaders(token) }
      );
      let leadId = null;
      if (incomingForm.create_lead) {
        const leadResult = await api.post(
          '/crm/leads',
          {
            title: incomingForm.lead_name.trim() || `Telefon od ${phone}`,
            oddzial_id: oid,
            stage: 'Lead',
            source: 'telefonia',
            phone,
            value: 0,
            notes: [
              `Telefon przychodzacy: ${incomingForm.status}`,
              incomingForm.service_type ? `Typ uslugi: ${incomingForm.service_type}` : '',
              incomingForm.inspection_address.trim() ? `Adres ogledzin: ${incomingForm.inspection_address.trim()}` : '',
              incomingForm.city.trim() ? `Miasto: ${incomingForm.city.trim()}` : '',
              incomingForm.appointment_at ? `Proponowany termin: ${incomingForm.appointment_at}` : '',
              incomingForm.notes.trim(),
              taskId ? `Powiazane zlecenie: #${taskId}` : '',
            ].filter(Boolean).join('\n'),
            tags: ['telefonia', 'telefon-przychodzacy'],
          },
          { headers: authHeaders(token) }
        );
        leadId = leadResult.data?.id || null;
      }
      let callbackId = null;
      if (incomingForm.create_callback || incomingForm.status === 'missed') {
        const callbackResult = await api.post(
          '/telephony/callbacks',
          {
            oddzial_id: oid,
            phone,
            task_id: taskId || undefined,
            lead_name: incomingForm.lead_name.trim() || null,
            priority: incomingForm.priority,
            due_at: null,
            notes: incomingForm.notes.trim() || 'Oddzwonic po telefonie przychodzacym.',
          },
          { headers: authHeaders(token) }
        );
        callbackId = callbackResult.data?.id || null;
      }
      setIncomingForm((f) => ({
        ...f,
        phone: '',
        lead_name: '',
        task_id: '',
        status: 'answered',
        inspection_address: '',
        city: '',
        service_type: '',
        appointment_at: '',
        notes: '',
        create_lead: true,
        create_callback: false,
      }));
      await loadTelephonyExtras();
      setTelMessage([
        `Telefon przychodzacy zapisany${callResult.data?.id ? ` (#${callResult.data.id})` : ''}.`,
        incomingForm.create_lead ? `Lead CRM ${leadId ? `#${leadId}` : 'utworzony'}.` : '',
        (incomingForm.create_callback || incomingForm.status === 'missed') ? `Oddzwonienie ${callbackId ? `#${callbackId}` : 'utworzone'}.` : '',
      ].filter(Boolean).join(' '));
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udalo sie zapisac telefonu przychodzacego.'));
    } finally {
      setSavingCall(false);
    }
  };

  const saveCallback = async (e) => {
    e.preventDefault();
    const oid = toIntLocal(cbForm.oddzial_id);
    const phone = normalizePhone(cbForm.phone);
    if (!oid) {
      setTelError('Wybierz oddział (oddzwonienie).');
      return;
    }
    if (!phone) {
      setTelError('Podaj numer do oddzwonienia.');
      return;
    }
    setSavingCb(true);
    setTelError('');
    setTelMessage('');
    try {
      const token = getStoredToken();
      const cbTaskId = toIntLocal(cbForm.task_id);
      const { data } = await api.post(
        '/telephony/callbacks',
        {
          oddzial_id: oid,
          phone,
          task_id: cbTaskId || undefined,
          lead_name: cbForm.lead_name.trim() || null,
          priority: cbForm.priority,
          due_at: cbForm.due_at ? new Date(`${cbForm.due_at}T12:00:00`).toISOString() : null,
          notes: cbForm.notes.trim() || null,
        },
        { headers: authHeaders(token) }
      );
      setCbForm((f) => ({
        ...f,
        phone: '',
        lead_name: '',
        due_at: '',
        notes: '',
        task_id: '',
      }));
      await loadTelephonyExtras();
      setTelMessage(`Oddzwonienie dodane do kolejki${data?.id ? ` (#${data.id})` : ''}.`);
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udało się dodać zadania oddzwonienia.'));
    } finally {
      setSavingCb(false);
    }
  };

  const patchCallback = async (id, status) => {
    setUpdatingCbId(id);
    setTelError('');
    setTelMessage('');
    try {
      const token = getStoredToken();
      await api.patch(`/telephony/callbacks/${id}/status`, { status }, { headers: authHeaders(token) });
      await loadTelephonyExtras();
      setTelMessage(status === 'done' ? 'Oddzwonienie zamkniete jako gotowe.' : status === 'cancelled' ? 'Oddzwonienie anulowane.' : 'Status oddzwonienia zaktualizowany.');
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udało się zaktualizować statusu.'));
    } finally {
      setUpdatingCbId(null);
    }
  };

  function toIntLocal(v) {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : 0;
  }

  const statusOptions = useMemo(() => {
    const unique = [...new Set(sms.map((x) => x.status).filter(Boolean))];
    return unique.sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  }, [sms]);
  const updatedByOptions = useMemo(() => {
    const unique = [...new Set(sms.map((x) => x.updated_by_name).filter(Boolean))];
    return unique.sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  }, [sms]);

  const filtered = useMemo(() => {
    if (serverPaging) {
      return sms.filter((x) => {
        const updatedByOk = updatedByFilter === 'all' || x.updated_by_name === updatedByFilter;
        const todayOk =
          !onlyUpdatedToday ||
          (x.updated_at && new Date(x.updated_at).toDateString() === new Date().toDateString());
        return updatedByOk && todayOk;
      });
    }
    const q = query.trim().toLowerCase();
    return sms.filter((x) => {
      const date = x.created_at ? new Date(x.created_at) : null;
      const dateOkFrom =
        !dateFrom ||
        (date && date >= new Date(`${dateFrom}T00:00:00`));
      const dateOkTo =
        !dateTo ||
        (date && date <= new Date(`${dateTo}T23:59:59`));
      const statusOk = statusFilter === 'all' || String(x.status || '') === statusFilter;
      const branchOk = !smsBranchFilter || String(x.oddzial_id || '') === String(smsBranchFilter);
      const updatedByOk = updatedByFilter === 'all' || x.updated_by_name === updatedByFilter;
      const todayOk = !onlyUpdatedToday || (
        x.updated_at &&
        new Date(x.updated_at).toDateString() === new Date().toDateString()
      );
      const qOk =
        !q ||
        [
          x.recipient_name,
          x.recipient_phone,
          x.typ,
          x.status,
          x.created_by_name,
          String(x.task_id || ''),
          x.tresc,
          x.error,
          x.sid,
          x.oddzial_nazwa,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      return dateOkFrom && dateOkTo && statusOk && branchOk && updatedByOk && todayOk && qOk;
    });
  }, [
    serverPaging,
    sms,
    query,
    smsBranchFilter,
    statusFilter,
    updatedByFilter,
    dateFrom,
    dateTo,
    onlyUpdatedToday,
  ]);

  const totalPages = serverPaging
    ? Math.max(1, Math.ceil(smsTotalAll / SMS_HIST_PAGE_SIZE))
    : Math.max(1, Math.ceil(filtered.length / SMS_HIST_PAGE_SIZE));

  const paged = useMemo(() => {
    if (serverPaging) return filtered;
    const start = (page - 1) * SMS_HIST_PAGE_SIZE;
    return filtered.slice(start, start + SMS_HIST_PAGE_SIZE);
  }, [filtered, page, serverPaging]);

  const exportCsv = () => {
    const rows = [
      ['data', 'zlecenie_id', 'klient', 'telefon', 'typ', 'status', 'blad', 'sid', 'wyslal'],
      ...filtered.map((x) => [
        x.created_at ? new Date(x.created_at).toISOString() : '',
        x.task_id || '',
        x.recipient_name || '',
        x.recipient_phone || '',
        x.typ || '',
        x.status || '',
        x.error || '',
        x.sid || '',
        x.created_by_name || '',
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telefonia-sms-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAgentCsv = async () => {
    if (!agentForm.oddzial_id || agentExporting) return;
    setAgentExporting(true);
    setAgentError('');
    let rowsToExport = [];
    try {
      const token = getStoredToken();
      const pageSize = 100;
      let offset = 0;
      let total = null;

      do {
        const qs = new URLSearchParams();
        qs.set('oddzial_id', String(agentForm.oddzial_id));
        qs.set('limit', String(pageSize));
        qs.set('offset', String(offset));
        qs.set('filter', agentHistoryFilter || 'all');
        const agentQ = agentHistoryQuery.trim().slice(0, 200);
        if (agentQ) qs.set('q', agentQ);
        const { data } = await api.get(`/telephony/voice-agent/polska-flora/intakes?${qs.toString()}`, {
          headers: authHeaders(token),
        });
        const items = Array.isArray(data.items) ? data.items : [];
        rowsToExport = rowsToExport.concat(items);
        total = Number(data.total || rowsToExport.length);
        offset += pageSize;
        if (!items.length) break;
      } while (rowsToExport.length < total);
    } catch (e) {
      setAgentError(getApiErrorMessage(e, 'Nie udalo sie wyeksportowac rozmow agenta.'));
      setAgentExporting(false);
      return;
    }

    const rows = [
      ['data', 'klient', 'telefon', 'adres', 'miasto', 'usluga', 'termin', 'jakosc', 'sms', 'lead_id', 'klient_id', 'ogledziny_id'],
      ...rowsToExport.map((x) => [
        x.created_at ? new Date(x.created_at).toISOString() : '',
        x.customer_name || '',
        x.caller_phone || '',
        x.inspection_address || '',
        x.city || '',
        agentServiceLabel(x.service_type),
        x.appointment_at ? new Date(x.appointment_at).toISOString() : '',
        x.quality_status || '',
        agentSmsStatusLabel(x),
        x.crm_lead_id || '',
        x.klient_id || '',
        x.ogledziny_id || '',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telefonia-agent-ai-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setAgentExporting(false);
  };

  const exportBranchStatusCsv = () => {
    const rows = [
      ['oddzial', 'miasto', 'etap', 'gotowosc_pct', 'status_agenta', 'telefon', 'sms_sender', 'provider', 'rozmowy', 'do_sprawdzenia', 'bledy_sms', 'ostatni_test', 'braki'],
      ...filteredBranchIntegrationStatuses.map((row) => {
        const readiness = branchReadiness(row);
        return [
          row.oddzial_name || `Oddzial #${row.oddzial_id}`,
          row.miasto || '',
          branchLaunchStage(row).label,
          readiness.percent,
          branchIntegrationStatusLabel(row),
          row.telefon || '',
          row.sms_sender_id || row.telefon || '',
          row.provider || '',
          Number(row.intakes_total || 0),
          Number(row.needs_review || 0),
          Number(row.sms_errors || 0),
          row.last_test_log_at ? `${row.last_test_log_status || ''} ${formatAgentDate(row.last_test_log_at)}` : '',
          readiness.blockers.join('; '),
        ];
      }),
    ];
    const csv = rows
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telefonia-oddzialy-status-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resendSms = async (row) => {
    if (!row?.task_id) return;
    setSendingId(row.id);
    setError('');
    try {
      const token = getStoredToken();
      await api.post(`/sms/zlecenie/${row.task_id}`, { typ: row.typ || 'manual' }, { headers: authHeaders(token) });
      await loadSms(page);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udało się ponowić wysyłki SMS.'));
    } finally {
      setSendingId(null);
    }
  };

  const sendManualSms = async (e) => {
    e.preventDefault();
    if (!manualForm.recipient_phone.trim()) {
      setError('Podaj numer telefonu.');
      return;
    }
    if (!isValidPhone(manualForm.recipient_phone)) {
      setError('Nieprawidlowy numer telefonu. Uzyj formatu +48123123123 lub 123123123.');
      return;
    }
    if (!manualForm.text.trim()) {
      setError('Podaj tresc SMS.');
      return;
    }
    if (manualForm.text.trim().length > SMS_LIMIT) {
      setError(`Tresc SMS przekracza limit ${SMS_LIMIT} znakow.`);
      return;
    }
    setManualSending(true);
    setError('');
    try {
      const token = getStoredToken();
      await api.post(
        '/sms/manual',
        {
          recipient_name: manualForm.recipient_name.trim() || null,
          recipient_phone: normalizePhone(manualForm.recipient_phone.trim()),
          text: manualForm.text.trim().slice(0, SMS_LIMIT),
          typ: 'manual_text',
        },
        { headers: authHeaders(token) }
      );
      setManualForm({ recipient_name: '', recipient_phone: '', text: '' });
      const wasOnPage1 = page === 1;
      setPage(1);
      if (wasOnPage1) await loadSms(1);
    } catch (e2) {
      setError(getApiErrorMessage(e2, 'Nie udalo sie wyslac SMS.'));
    } finally {
      setManualSending(false);
    }
  };

  const stats = useMemo(() => {
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let missing = 0;
    for (const x of filtered) {
      const st = String(x.status || '');
      if (['wyslano_demo', 'Wyslany', 'Dostarczony', 'dostarczono'].includes(st)) sent += 1;
      if (st === 'Dostarczony' || st === 'dostarczono') delivered += 1;
      if (st === 'Niedostarczony' || st === 'blad' || st === 'Błąd') failed += 1;
      else if (st === 'brak_numeru') missing += 1;
    }
    return {
      total: filtered.length,
      sent,
      delivered,
      failed,
      missing,
    };
  }, [filtered]);

  const applyTemplate = (templateText) => {
    setManualForm((f) => ({
      ...f,
      text: templateText.slice(0, SMS_LIMIT),
    }));
  };

  const smsChars = manualForm.text.length;
  const smsEncoding = GSM7_REGEX.test(manualForm.text) ? 'GSM-7' : 'Unicode';
  const smsSingleLimit = smsEncoding === 'GSM-7' ? 160 : 70;
  const smsConcatLimit = smsEncoding === 'GSM-7' ? 153 : 67;
  const smsSegments =
    smsChars === 0
      ? 1
      : smsChars <= smsSingleLimit
        ? 1
        : Math.ceil(smsChars / smsConcatLimit);
  const smsEstimatedCost = (smsSegments * SMS_PRICE_PLN).toFixed(2);

  const STATUS_CHOICES = ['wyslano_demo', 'w_kolejce', 'dostarczono', 'blad', 'brak_numeru', 'anulowano'];
  const openCallbacks = callbacks.filter((x) => x.status === 'open');
  const smsStatusTone = (status) => {
    const st = String(status || '').toLowerCase();
    if (st.includes('blad') || st.includes('błąd') || st.includes('brak') || st.includes('anul')) return 'danger';
    if (st.includes('kolej') || st.includes('niedostar')) return 'warning';
    if (st.includes('dostar') || st.includes('wyslano') || st.includes('wyslany')) return 'success';
    return 'info';
  };

  const formatAgentDate = (value) => (value ? new Date(value).toLocaleString('pl-PL') : 'brak');
  const buildAgentSmsConfirmation = (row) => {
    const when = row?.appointment_at ? new Date(row.appointment_at).toLocaleString('pl-PL') : '';
    const address = [row?.inspection_address, row?.city].filter(Boolean).join(', ');
    const parts = ['Dzien dobry, potwierdzamy bezplatne ogledziny Polska Flora'];
    if (when) parts.push(`termin: ${when}`);
    if (address) parts.push(`adres: ${address}`);
    return `${parts.join(', ')}. W razie pytan prosimy o kontakt.`.slice(0, SMS_LIMIT);
  };

  const acknowledgeSmsRisk = async (row) => {
    setAcknowledgingSmsId(row.id);
    setError('');
    try {
      const token = getStoredToken();
      await api.post('/ops/risk-report/actions', {
        action: 'acknowledge',
        risk_type: 'sms_delivery',
        risk_id: `sms_delivery:${row.id}`,
        task_id: row.task_id || undefined,
        note: `${row.owner_label || 'Owner SMS'} potwierdzil alert dostawy w panelu Telefonia.`,
      }, { headers: authHeaders(token) });
      await loadSms(page);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie potwierdzic alertu SMS.'));
    } finally {
      setAcknowledgingSmsId(null);
    }
  };

  const smsNeedsOwnerAck = (row) => {
    const status = String(row?.status || row?.provider_status || '').toLowerCase();
    return Boolean(row?.error)
      || status.includes('fail')
      || status.includes('error')
      || status.includes('undeliver')
      || status.includes('rejected')
      || status.includes('blad')
      || status.includes('niedostar');
  };

  const agentServiceLabel = (value) => {
    const v = String(value || '').toLowerCase();
    if (v === 'dach') return 'Dach';
    if (v === 'elewacja_kostka') return 'Elewacja / kostka';
    if (v === 'ogrod') return 'Ogrod';
    if (v === 'wycinka_pielegnacja') return 'Drzewa';
    return value || 'Inne';
  };
  const agentIssueLabel = (value) => ({
    brak_telefonu: 'brak telefonu',
    brak_adresu: 'brak adresu',
    brak_terminu: 'brak terminu',
    brak_leada_crm: 'brak leada CRM',
    brak_ogledzin: 'brak ogledzin',
    brak_notatki: 'brak notatki',
  }[value] || value);
  const agentSmsStatusLabel = (row) => {
    const sms = row?.sms_status || {};
    if (sms.confirmation_error || sms.reminder_error) return 'SMS blad';
    if (sms.confirmation_at && sms.reminder_at) return 'Potw. + przyp.';
    if (sms.confirmation_at) return 'Potwierdzono';
    if (sms.reminder_at) return 'Przypomniano';
    return 'Brak SMS';
  };
  const agentSmsStatusTone = (row) => {
    const sms = row?.sms_status || {};
    if (sms.confirmation_error || sms.reminder_error) return s.reviewBadge;
    if (sms.confirmation_at || sms.reminder_at) return s.okBadge;
    return s.neutralBadge;
  };
  const integrationTypeLabel = (value) => ({
    sms: 'SMS',
    voice_agent: 'Agent AI',
  }[value] || value || 'Integracja');
  const integrationActionLabel = (value) => ({
    branch_sender_test: 'Test nadawcy oddzialu',
    webhook_config_test: 'Test webhooka',
  }[value] || value || 'Test');
  const branchIntegrationTone = (row) => {
    if (!row?.integration_id) return 'bad';
    if (row.integration_status === 'active' && row.telefon && (row.sms_sender_id || row.telefon)) return 'ok';
    if (row.integration_status === 'paused') return 'warn';
    return 'warn';
  };
  const branchIntegrationStatusLabel = (row) => {
    if (!row?.integration_id) return 'Do podpiecia';
    if (row.integration_status === 'active') return 'Aktywny';
    if (row.integration_status === 'paused') return 'Pauza';
    return row.integration_status || 'Nieznany';
  };
  const branchLastTestAgeDays = (row) => {
    if (!row?.last_test_log_at) return null;
    const timestamp = new Date(row.last_test_log_at).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  };
  const branchHasFreshOkTest = (row) => {
    const ageDays = branchLastTestAgeDays(row);
    return row?.last_test_log_status === 'ok' && ageDays !== null && ageDays <= BRANCH_TEST_STALE_DAYS;
  };
  const branchLastTestLabel = (row) => {
    if (!row?.last_test_log_at) return 'Brak testu integracji.';
    const status = row.last_test_log_status === 'ok' ? 'OK' : 'Blad';
    const ageDays = branchLastTestAgeDays(row);
    const ageText = ageDays === null ? '' : `, ${ageDays} dni temu`;
    return `Ostatni test: ${status} / ${formatAgentDate(row.last_test_log_at)}${ageText}`;
  };
  const branchReadiness = (row) => {
    const checks = [
      { ok: !!row?.integration_id, label: 'brak agenta' },
      { ok: row?.integration_status === 'active', label: 'agent nieaktywny' },
      { ok: !!row?.telefon, label: 'brak telefonu' },
      { ok: !!(row?.sms_sender_id || row?.telefon), label: 'brak nadawcy SMS' },
      { ok: branchHasFreshOkTest(row), label: row?.last_test_log_status === 'ok' ? `test OK starszy niz ${BRANCH_TEST_STALE_DAYS} dni` : 'brak testu OK' },
    ];
    const okCount = checks.filter((x) => x.ok).length;
    return {
      percent: Math.round((okCount / checks.length) * 100),
      blockers: checks.filter((x) => !x.ok).map((x) => x.label),
      hasErrors: Number(row?.sms_errors || 0) > 0,
      needsReview: Number(row?.needs_review || 0) > 0,
    };
  };
  const branchNextAction = (row) => {
    const readiness = branchReadiness(row);
    if (!row?.integration_id) return 'Nastepny krok: wlacz agenta dla oddzialu.';
    if (row.integration_status !== 'active') return 'Nastepny krok: wznow agenta.';
    if (!row.telefon) return 'Nastepny krok: wpisz numer telefonu oddzialu.';
    if (!(row.sms_sender_id || row.telefon)) return 'Nastepny krok: ustaw nadawce SMS.';
    if (row.last_test_log_status !== 'ok') return 'Nastepny krok: wykonaj test calosci oddzialu.';
    if (!branchHasFreshOkTest(row)) return `Nastepny krok: ponow test calosci oddzialu, bo OK jest starszy niz ${BRANCH_TEST_STALE_DAYS} dni.`;
    if (readiness.hasErrors) return 'Nastepny krok: sprawdz bledy SMS.';
    if (readiness.needsReview) return 'Nastepny krok: popraw rozmowy do sprawdzenia.';
    return 'Nastepny krok: oddzial gotowy.';
  };
  const branchLaunchStage = (row) => {
    const readiness = branchReadiness(row);
    if (readiness.hasErrors || readiness.needsReview) return { label: 'Uwagi', tone: 'warn' };
    if (!row?.integration_id || !row?.telefon || !(row?.sms_sender_id || row?.telefon)) return { label: 'Do danych', tone: 'bad' };
    if (row.integration_status !== 'active' || !branchHasFreshOkTest(row)) return { label: 'Do testu', tone: 'warn' };
    if (readiness.percent >= 100) return { label: 'Gotowy', tone: 'ok' };
    return { label: 'Do dopiecia', tone: 'warn' };
  };
  const resetBranchStatusView = () => {
    setBranchStatusFilter('all');
    setBranchStatusQuery('');
    setBranchStatusSort('needs');
    setBranchStageFilter('all');
    try {
      localStorage.removeItem(BRANCH_STATUS_VIEW_KEY);
    } catch {
      /* localStorage can be unavailable in private mode */
    }
  };
  const branchReadinessSummary = branchIntegrationStatuses.reduce((acc, row) => {
    const readiness = branchReadiness(row);
    if (readiness.percent >= 100 && !readiness.hasErrors) acc.ready += 1;
    else acc.todo += 1;
    if (readiness.hasErrors || readiness.needsReview) acc.attention += 1;
    if (row?.last_test_log_status === 'ok' && !branchHasFreshOkTest(row)) acc.retest += 1;
    return acc;
  }, { ready: 0, todo: 0, attention: 0, retest: 0 });
  const branchStageSummary = branchIntegrationStatuses.reduce((acc, row) => {
    const stage = branchLaunchStage(row).label;
    acc[stage] = Number(acc[stage] || 0) + 1;
    return acc;
  }, {});
  const branchRolloutPercent = branchIntegrationStatuses.length
    ? Math.round(branchIntegrationStatuses.reduce((sum, row) => sum + branchReadiness(row).percent, 0) / branchIntegrationStatuses.length)
    : 0;
  const filteredBranchIntegrationStatuses = branchIntegrationStatuses.filter((row) => {
    const readiness = branchReadiness(row);
    if (branchStatusFilter === 'ready') return readiness.percent >= 100 && !readiness.hasErrors;
    if (branchStatusFilter === 'todo') return readiness.percent < 100 || readiness.hasErrors;
    if (branchStatusFilter === 'attention') return readiness.hasErrors || readiness.needsReview;
    if (branchStatusFilter === 'retest') return row?.last_test_log_status === 'ok' && !branchHasFreshOkTest(row);
    return true;
  }).filter((row) => {
    if (branchStageFilter === 'all') return true;
    return branchLaunchStage(row).label === branchStageFilter;
  }).filter((row) => {
    const q = branchStatusQuery.trim().toLowerCase();
    if (!q) return true;
    return [
      row.oddzial_name,
      row.miasto,
      row.telefon,
      row.sms_sender_id,
      row.provider,
      row.provider_account_id,
      branchIntegrationStatusLabel(row),
    ].some((value) => String(value || '').toLowerCase().includes(q));
  }).sort((a, b) => {
    const ar = branchReadiness(a);
    const br = branchReadiness(b);
    if (branchStatusSort === 'name') return String(a.oddzial_name || '').localeCompare(String(b.oddzial_name || ''), 'pl');
    if (branchStatusSort === 'stage') {
      const aStage = branchLaunchStage(a).label;
      const bStage = branchLaunchStage(b).label;
      const stageDiff = Number(BRANCH_STAGE_ORDER[aStage] ?? 99) - Number(BRANCH_STAGE_ORDER[bStage] ?? 99);
      if (stageDiff !== 0) return stageDiff;
      return String(a.oddzial_name || '').localeCompare(String(b.oddzial_name || ''), 'pl');
    }
    if (branchStatusSort === 'ready') return br.percent - ar.percent;
    if (branchStatusSort === 'activity') return Number(b.intakes_total || 0) - Number(a.intakes_total || 0);
    const aScore = ar.blockers.length * 10 + (ar.hasErrors ? 5 : 0) + (ar.needsReview ? 3 : 0) - ar.percent / 100;
    const bScore = br.blockers.length * 10 + (br.hasErrors ? 5 : 0) + (br.needsReview ? 3 : 0) - br.percent / 100;
    return bScore - aScore;
  });
  const firstVisibleBranchStatus = filteredBranchIntegrationStatuses[0] || null;
  const selectedVisibleBranchIndex = filteredBranchIntegrationStatuses.findIndex((row) => String(row.oddzial_id) === String(agentForm.oddzial_id));
  const selectedVisibleBranchPosition = selectedVisibleBranchIndex >= 0 ? selectedVisibleBranchIndex + 1 : 0;
  const previousVisibleBranchStatus = selectedVisibleBranchIndex > 0
    ? (filteredBranchIntegrationStatuses[selectedVisibleBranchIndex - 1] || null)
    : null;
  const nextVisibleBranchStatus = selectedVisibleBranchIndex >= 0
    ? (filteredBranchIntegrationStatuses[selectedVisibleBranchIndex + 1] || null)
    : firstVisibleBranchStatus;
  const branchStatusName = (row) => row?.oddzial_name || (row?.oddzial_id ? `Oddzial #${row.oddzial_id}` : 'brak');
  const visibleBranchWorkQueue = filteredBranchIntegrationStatuses.slice(0, 3);
  const staleTestBranchStatuses = branchIntegrationStatuses
    .filter((row) => row?.last_test_log_status === 'ok' && !branchHasFreshOkTest(row))
    .sort((a, b) => Number(branchLastTestAgeDays(b) || 0) - Number(branchLastTestAgeDays(a) || 0));
  const nextBranchToFix = branchIntegrationStatuses
    .map((row) => ({ row, readiness: branchReadiness(row) }))
    .filter(({ readiness }) => readiness.percent < 100 || readiness.hasErrors || readiness.needsReview)
    .sort((a, b) => {
      const aScore = a.readiness.blockers.length * 10 + (a.readiness.hasErrors ? 5 : 0) + (a.readiness.needsReview ? 3 : 0) - a.readiness.percent / 100;
      const bScore = b.readiness.blockers.length * 10 + (b.readiness.hasErrors ? 5 : 0) + (b.readiness.needsReview ? 3 : 0) - b.readiness.percent / 100;
      return bScore - aScore;
    })[0]?.row || null;
  const selectedBranchStatus = branchIntegrationStatuses.find((row) => String(row.oddzial_id) === String(agentForm.oddzial_id)) || null;
  const buildSingleBranchReadinessReport = (row) => {
    if (!row) return '';
    const readiness = branchReadiness(row);
    return [
      `Oddzial: ${row.oddzial_name || `Oddzial #${row.oddzial_id}`}`,
      `Gotowosc: ${readiness.percent}%`,
      `Status agenta: ${branchIntegrationStatusLabel(row)}`,
      `Telefon oddzialu: ${row.telefon || 'brak'}`,
      `Nadawca SMS: ${row.sms_sender_id || row.telefon || 'globalny/brak'}`,
      `Provider: ${row.provider || 'brak'}${row.provider_account_id ? ` / ${row.provider_account_id}` : ''}`,
      `Rozmowy: ${Number(row.intakes_total || 0)}`,
      `Do sprawdzenia: ${Number(row.needs_review || 0)}`,
      `Bledy SMS: ${Number(row.sms_errors || 0)}`,
      `Ostatni test: ${row.last_test_log_at ? `${row.last_test_log_status === 'ok' ? 'OK' : 'Blad'} / ${formatAgentDate(row.last_test_log_at)}` : 'brak'}`,
      `Braki: ${readiness.blockers.length ? readiness.blockers.join(', ') : 'brak'}`,
      branchNextAction(row),
    ].join('\n');
  };
  const buildBranchReadinessReport = () => {
    const lines = [
      'Raport podpiecia Agent AI / SMS - oddzialy',
      `Gotowe: ${branchReadinessSummary.ready}`,
      `Do dopiecia: ${branchReadinessSummary.todo}`,
      `Uwagi operacyjne: ${branchReadinessSummary.attention}`,
      `Do ponownego testu: ${branchReadinessSummary.retest}`,
      '',
    ];
    branchIntegrationStatuses.forEach((row) => {
      const readiness = branchReadiness(row);
      lines.push(`${row.oddzial_name || `Oddzial #${row.oddzial_id}`}: ${readiness.percent}% / ${branchIntegrationStatusLabel(row)}`);
      lines.push(`- Etap: ${branchLaunchStage(row).label}`);
      lines.push(`- Telefon: ${row.telefon || 'brak'}`);
      lines.push(`- SMS: ${row.sms_sender_id || row.telefon || 'globalny/brak'}`);
      lines.push(`- Rozmowy: ${Number(row.intakes_total || 0)}, do sprawdzenia: ${Number(row.needs_review || 0)}, bledy SMS: ${Number(row.sms_errors || 0)}`);
      lines.push(`- Ostatni test: ${row.last_test_log_at ? `${row.last_test_log_status === 'ok' ? 'OK' : 'Blad'} / ${formatAgentDate(row.last_test_log_at)}` : 'brak'}`);
      lines.push(`- Braki: ${readiness.blockers.length ? readiness.blockers.join(', ') : 'brak'}`);
      lines.push('');
    });
    return lines.join('\n');
  };
  const buildFilteredBranchWorkPlan = () => {
    const lines = [
      'Plan pracy - podpiecie telefonii oddzialow',
      `Widoczne oddzialy: ${filteredBranchIntegrationStatuses.length} / ${branchIntegrationStatuses.length}`,
      `Filtr statusu: ${branchStatusFilter === 'all' ? 'wszystkie' : branchStatusFilter}`,
      `Filtr etapu: ${branchStageFilter === 'all' ? 'wszystkie' : branchStageFilter}`,
      `Szukaj: ${branchStatusQuery.trim() || 'brak'}`,
      '',
    ];
    filteredBranchIntegrationStatuses.forEach((row, index) => {
      const readiness = branchReadiness(row);
      lines.push(`${index + 1}. ${row.oddzial_name || `Oddzial #${row.oddzial_id}`} - ${branchLaunchStage(row).label} / ${readiness.percent}%`);
      lines.push(`   ${branchNextAction(row)}`);
      if (readiness.blockers.length) lines.push(`   Braki: ${readiness.blockers.join(', ')}`);
      if (Number(row.sms_errors || 0) > 0) lines.push(`   Bledy SMS: ${Number(row.sms_errors || 0)}`);
      if (Number(row.needs_review || 0) > 0) lines.push(`   Rozmowy do sprawdzenia: ${Number(row.needs_review || 0)}`);
    });
    if (!filteredBranchIntegrationStatuses.length) lines.push('Brak oddzialow w aktualnym widoku.');
    return lines.join('\n');
  };
  const buildVisibleBranchQueueText = () => {
    const lines = [
      'Nastepne 3 oddzialy do pracy',
      `Widok: ${branchStageFilter === 'all' ? 'wszystkie etapy' : branchStageFilter}`,
      '',
    ];
    visibleBranchWorkQueue.forEach((row, index) => {
      const readiness = branchReadiness(row);
      lines.push(`${index + 1}. ${row.oddzial_name || `Oddzial #${row.oddzial_id}`} - ${branchLaunchStage(row).label} / ${readiness.percent}%`);
      lines.push(`   ${branchNextAction(row)}`);
    });
    if (!visibleBranchWorkQueue.length) lines.push('Brak oddzialow w aktualnym widoku.');
    return lines.join('\n');
  };
  const buildVisibleBranchBlockersText = () => {
    const rowsWithBlockers = filteredBranchIntegrationStatuses
      .map((row) => ({ row, readiness: branchReadiness(row), stage: branchLaunchStage(row) }))
      .filter(({ readiness }) => readiness.blockers.length);
    const lines = [
      'Braki do domkniecia - aktualny widok',
      `Widoczne oddzialy: ${filteredBranchIntegrationStatuses.length} / ${branchIntegrationStatuses.length}`,
      `Filtr etapu: ${branchStageFilter === 'all' ? 'wszystkie' : branchStageFilter}`,
      '',
    ];
    rowsWithBlockers.forEach(({ row, readiness, stage }, index) => {
      lines.push(`${index + 1}. ${branchStatusName(row)} - ${stage.label} / ${readiness.percent}%`);
      lines.push(`   Braki: ${readiness.blockers.join(', ')}`);
      lines.push(`   Nastepny krok: ${branchNextAction(row)}`);
    });
    if (!rowsWithBlockers.length) lines.push('Brak brakow w aktualnym widoku.');
    return lines.join('\n');
  };
  const buildStaleBranchTestsText = () => {
    const lines = [
      `Oddzialy do ponownego testu - test OK starszy niz ${BRANCH_TEST_STALE_DAYS} dni`,
      `Liczba oddzialow: ${staleTestBranchStatuses.length}`,
      '',
    ];
    staleTestBranchStatuses.forEach((row, index) => {
      const ageDays = branchLastTestAgeDays(row);
      lines.push(`${index + 1}. ${branchStatusName(row)} - ${ageDays ?? 'brak'} dni od testu OK`);
      lines.push(`   Telefon: ${row.telefon || 'brak'}, SMS: ${row.sms_sender_id || row.telefon || 'globalny/brak'}`);
      lines.push(`   Ostatni test: ${row.last_test_log_at ? formatAgentDate(row.last_test_log_at) : 'brak'}`);
      lines.push(`   ${branchNextAction(row)}`);
    });
    if (!staleTestBranchStatuses.length) lines.push('Brak oddzialow do ponownego testu.');
    return lines.join('\n');
  };
  const buildBranchStageSummaryText = () => [
    'Status etapow podpiecia telefonii',
    `Do danych: ${branchStageSummary['Do danych'] || 0}`,
    `Do testu: ${branchStageSummary['Do testu'] || 0}`,
    `Uwagi: ${branchStageSummary.Uwagi || 0}`,
    `Do dopiecia: ${branchStageSummary['Do dopiecia'] || 0}`,
    `Gotowy: ${branchStageSummary.Gotowy || 0}`,
    `Razem: ${branchIntegrationStatuses.length}`,
  ].join('\n');
  const agentNeedsReviewCount = Number(agentIntakesSummary.needs_review || 0);
  const agentSmsMissingCount = Number(agentIntakesSummary.sms_missing || 0);
  const agentSmsErrorCount = Number(agentIntakesSummary.sms_error || 0);
  const agentScheduledCount = Number(agentIntakesSummary.scheduled || 0);
  const agentLastIntake = agentIntakes[0] || null;
  const agentLastSmsProblem = agentIntakes.find((x) => x.sms_status?.confirmation_error || x.sms_status?.reminder_error) || null;
  const agentBranchSmsSender = selectedAgentBranch?.sms_sender_id || selectedAgentBranch?.sms_sender || selectedAgentBranch?.telefon || '';
  const providerChecklist = buildProviderChecklist();
  const providerSetupGuide = buildProviderSetupGuide();
  const agentHealthItems = [
    {
      label: 'Agent AI',
      value: agentIntegration?.status === 'active' ? 'Aktywny' : agentIntegration?.status === 'paused' ? 'Pauza' : 'Niepodlaczony',
      tone: agentIntegration?.status === 'active' ? 'ok' : agentIntegration?.status === 'paused' ? 'warn' : 'bad',
      detail: agentIntegration ? `${agentIntegration.provider || 'zadarma'}${agentIntegration.provider_account_id ? ` / ${agentIntegration.provider_account_id}` : ''}` : 'Najpierw wlacz agenta dla oddzialu.',
    },
    {
      label: 'Sekret webhooka',
      value: agentIntegration?.webhook_secret ? 'Gotowy' : 'Brak',
      tone: agentIntegration?.webhook_secret ? 'ok' : 'bad',
      detail: agentIntegration?.webhook_secret ? 'Mozna wkleic u providera telefonii.' : 'Brak sekretu blokuje zewnetrzny webhook.',
    },
    {
      label: 'Numer oddzialu',
      value: selectedAgentBranch?.telefon || 'Brak',
      tone: selectedAgentBranch?.telefon ? 'ok' : 'warn',
      detail: selectedAgentBranch?.telefon ? oddzialLabel(agentForm.oddzial_id) : 'Uzupelnij telefon oddzialu w danych oddzialu.',
    },
    {
      label: 'Nadawca SMS',
      value: agentBranchSmsSender || 'Domyslny',
      tone: agentBranchSmsSender ? 'ok' : 'warn',
      detail: agentBranchSmsSender ? 'SMS-y ida z konfiguracji oddzialu.' : 'System uzyje globalnej konfiguracji SMS.',
    },
    {
      label: 'Rozmowy webhook',
      value: String(agentIntakesSummary.all || agentIntakesTotal || 0),
      tone: (agentIntakesSummary.all || agentIntakesTotal) ? 'ok' : 'warn',
      detail: agentLastIntake?.created_at ? `Ostatnia: ${formatAgentDate(agentLastIntake.created_at)}` : 'Jeszcze nie ma rozmow dla tego oddzialu.',
    },
    {
      label: 'Do sprawdzenia',
      value: String(agentNeedsReviewCount),
      tone: agentNeedsReviewCount ? 'warn' : 'ok',
      detail: agentNeedsReviewCount ? 'Sa rozmowy z brakujacymi danymi.' : 'Brak rozmow wymagajacych korekty.',
    },
    {
      label: 'SMS bledy',
      value: String(agentSmsErrorCount),
      tone: agentSmsErrorCount ? 'bad' : 'ok',
      detail: agentLastSmsProblem
        ? (agentLastSmsProblem.sms_status?.confirmation_error || agentLastSmsProblem.sms_status?.reminder_error || 'Blad SMS')
        : 'Nie widac bledow SMS w aktualnym filtrze.',
    },
    {
      label: 'Przypomnienia jutro',
      value: String(agentReminderPreview.total || 0),
      tone: agentIntegration?.status === 'active' ? 'ok' : 'warn',
      detail: agentIntegration?.status === 'active' ? 'Automat obejmuje aktywne podpiecie oddzialu.' : 'Pauza lub brak podpiecia zatrzyma automat.',
    },
  ];
  const selectedBranchSetupSteps = [
    {
      label: '1. Numery oddzialu',
      ready: !!(branchTelephonyForm.telefon.trim() || selectedBranchStatus?.telefon),
      detail: branchTelephonyForm.telefon.trim()
        || selectedBranchStatus?.telefon
        || 'Wpisz numer oddzialu, z ktorego beda wychodzic polaczenia.',
    },
    {
      label: '2. Dane Zadarma',
      ready: !!agentIntegration?.webhook_secret,
      detail: agentIntegration?.webhook_secret
        ? 'Webhook i sekret sa gotowe do wklejenia w Zadarma.'
        : 'Kliknij Przygotuj jednym kliknieciem.',
    },
    {
      label: '3. Test calosci',
      ready: selectedBranchStatus ? branchHasFreshOkTest(selectedBranchStatus) : false,
      detail: selectedBranchStatus && branchHasFreshOkTest(selectedBranchStatus)
        ? branchLastTestLabel(selectedBranchStatus)
        : 'Po wklejeniu danych w Zadarma uruchom Test calosci oddzialu.',
    },
  ];
  const filteredAgentIntakes = agentIntakes.filter((x) => {
    if (agentHistoryFilter === 'needs_review') return x.quality_status === 'needs_review';
    if (agentHistoryFilter === 'sms_missing') return !x.sms_status?.confirmation_at && !x.sms_status?.reminder_at;
    if (agentHistoryFilter === 'sms_error') return !!(x.sms_status?.confirmation_error || x.sms_status?.reminder_error);
    if (agentHistoryFilter === 'scheduled') return !!x.appointment_at;
    return true;
  });
  const agentHistoryFilters = [
    { key: 'all', label: `Wszystkie (${agentIntakesSummary.all || agentIntakesTotal || 0})` },
    { key: 'needs_review', label: `Do sprawdzenia (${agentNeedsReviewCount})` },
    { key: 'sms_missing', label: `Bez SMS (${agentSmsMissingCount})` },
    { key: 'sms_error', label: `Blad SMS (${agentSmsErrorCount})` },
    { key: 'scheduled', label: `Z terminem (${agentScheduledCount})` },
  ];
  const agentHistoryTotalPages = Math.max(1, Math.ceil(agentIntakesTotal / AGENT_HISTORY_PAGE_SIZE));

  const updateSmsStatus = async (id, status) => {
    setUpdatingStatusId(id);
    setError('');
    try {
      const token = getStoredToken();
      await api.patch(`/sms/historia/${id}/status`, { status }, { headers: authHeaders(token) });
      await loadSms(page);
    } catch (e) {
      const msg = getApiErrorMessage(e, 'Nie udalo sie zaktualizowac statusu SMS.');
      setError(
        e?.response?.status === 404
          ? `${msg} (w ARBOR-OS status dostawy ustawia automatycznie Twilio — edycja ręczna jest wyłączona.)`
          : msg
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const pageSubtitle = tab === 'sms'
    ? `Historia SMS: ${filtered.length}${serverPaging && smsTotalAll > 0 ? ` w bazie: ${smsTotalAll}` : ''}`
    : tab === 'zadarma'
      ? `Zadarma: ${zadarmaSettings?.configured ? 'skonfigurowana' : 'do skonfigurowania'}`
    : tab === 'agent'
      ? `Agent Ania: ${agentIntegration?.status === 'active' ? 'aktywny' : 'do podpiecia'}`
      : `Log polaczen: ${callRows.length} | kolejka oddzwonien: ${callbacks.filter((x) => x.status === 'open').length}`;

  return (
    <div className="app-shell telefonia-shell" style={s.root}>
      <Sidebar />
      <div className="app-main telefonia-main" style={{ ...s.content, ...(isNarrow ? s.contentNarrow : null) }}>
        <PageHeader
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.18 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9a16 16 0 0 0 6.9 6.9l1.36-1.35a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          }
          title="Telefonia"
          subtitle={pageSubtitle /*
            tab === 'sms'
              ? `Historia SMS: ${filtered.length}${
                  serverPaging && smsTotalAll > 0 ? ` · ${smsTotalAll} w bazie` : ''
                }`
              : `Log połączeń: ${callRows.length} · kolejka oddzwonień: ${callbacks.filter((x) => x.status === 'open').length}`
          */}
          actions={
            <>
              {tab === 'sms' && (
                <button type="button" style={s.refreshBtn} onClick={exportCsv}>
                  Eksport CSV
                </button>
              )}
              {tab === 'agent' && (
                <button type="button" style={s.refreshBtn} onClick={exportAgentCsv} disabled={agentExporting || !agentForm.oddzial_id}>
                  {agentExporting ? 'Eksport...' : 'Eksport CSV'}
                </button>
              )}
              <button
                type="button"
                style={s.refreshBtn}
                onClick={() => (tab === 'sms'
                  ? loadSms(page)
                  : tab === 'zadarma'
                    ? loadZadarmaSettings()
                  : tab === 'agent'
                    ? Promise.all([
                      loadBranchIntegrationStatuses(),
                      loadVoiceAgentIntakes(agentForm.oddzial_id),
                    ])
                    : loadTelephonyExtras())}
              >
                Odswiez
              </button>
            </>
          }
        />

        <div className="telefonia-tabs" style={{ ...s.tabRow, ...(isNarrow ? s.tabRowNarrow : null) }}>
          <button type="button" style={tab === 'sms' ? s.tabActive : s.tab} onClick={() => setTab('sms')}>
            SMS
          </button>
          <button type="button" style={tab === 'calls' ? s.tabActive : s.tab} onClick={() => setTab('calls')}>
            Połączenia i oddzwonienia
          </button>
          <button type="button" style={tab === 'zadarma' ? s.tabActive : s.tab} onClick={() => setTab('zadarma')}>
            Zadarma
          </button>
          <button type="button" style={tab === 'agent' ? s.tabActive : s.tab} onClick={() => setTab('agent')}>
            Agent AI
          </button>
        </div>

        {!!error && tab === 'sms' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={error} tone="error" />
          </div>
        )}
        {!!telError && tab === 'calls' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={telError} tone="error" />
          </div>
        )}
        {!!telMessage && tab === 'calls' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={telMessage} tone="success" />
          </div>
        )}
        {!!zadarmaError && tab === 'zadarma' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={zadarmaError} tone="error" />
          </div>
        )}
        {!!zadarmaMessage && tab === 'zadarma' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={zadarmaMessage} tone="success" />
          </div>
        )}
        {!!agentError && tab === 'agent' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={agentError} tone="error" />
          </div>
        )}
        {!!agentMessage && tab === 'agent' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={agentMessage} tone="success" />
          </div>
        )}

        {tab === 'zadarma' && (
          <div className="telefonia-panel telefonia-zadarma-panel" style={s.panel}>
            <div style={s.callsIntro}>
              Wpisujesz klucze raz w panelu. ARBOR uzyje Zadarmy do SMS-ow, statusow dostarczenia i przycisku polaczenia z klientem.
            </div>
            <div style={s.agentHealthBox}>
              <div style={s.agentHistoryHeader}>
                <div>
                  <div style={s.manualTitle}>Status Zadarmy</div>
                  <div style={s.agentHistoryMeta}>
                    Zrodlo: {zadarmaSettings?.source || 'brak'} · API key: {zadarmaSettings?.api_key_masked || 'brak'} · secret: {zadarmaSettings?.api_secret_masked || 'brak'}
                  </div>
                </div>
                <div style={s.inlineActions}>
                  <button type="button" style={s.rowBtn} onClick={loadZadarmaSettings} disabled={zadarmaLoading}>
                    {zadarmaLoading ? 'Sprawdzam...' : 'Odswiez'}
                  </button>
                  <button type="button" style={s.rowBtnActive} onClick={testZadarmaSettings} disabled={zadarmaTesting || !zadarmaSettings?.configured}>
                    {zadarmaTesting ? 'Test...' : 'Test API'}
                  </button>
                </div>
              </div>
              <div style={s.agentHealthGrid}>
                <div style={s.agentHealthItem}>
                  <div style={s.agentHealthTop}>
                    <span style={{ ...s.agentHealthDot, background: zadarmaSettings?.configured ? '#22c55e' : '#ef4444' }} />
                    <span>Konfiguracja</span>
                  </div>
                  <strong style={s.agentHealthValue}>{zadarmaSettings?.configured ? 'Gotowa' : 'Brak kluczy'}</strong>
                  <div style={s.agentHistoryMeta}>Klucze sa przechowywane zaszyfrowane w bazie.</div>
                </div>
                <div style={s.agentHealthItem}>
                  <div style={s.agentHealthTop}>Nadawca SMS</div>
                  <strong style={s.agentHealthValue}>{zadarmaSettings?.caller_id || 'ARBOR'}</strong>
                  <div style={s.agentHistoryMeta}>Mozesz nadpisac nadawce per oddzial w danych oddzialu.</div>
                </div>
                <div style={s.agentHealthItem}>
                  <div style={s.agentHealthTop}>Webhook SMS</div>
                  <strong style={s.agentHealthValue}>{zadarmaSettings?.sms_webhook_url ? 'Gotowy' : 'Brak PUBLIC_BASE_URL'}</strong>
                  <div style={s.agentHistoryMeta}>
                    {zadarmaSettings?.sms_webhook_url || 'Ustaw PUBLIC_BASE_URL na backendzie.'}
                  </div>
                </div>
              </div>
            </div>
            <div style={s.agentGrid}>
              <form style={s.callForm} onSubmit={saveZadarmaSettings}>
                <div style={s.manualTitle}>Klucze API Zadarma</div>
                <input
                  value={zadarmaForm.api_key}
                  onChange={(e) => setZadarmaForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder={zadarmaSettings?.api_key_masked ? `Zapisany: ${zadarmaSettings.api_key_masked}` : 'ZADARMA_API_KEY'}
                  style={s.input}
                  type="password"
                />
                <input
                  value={zadarmaForm.api_secret}
                  onChange={(e) => setZadarmaForm((f) => ({ ...f, api_secret: e.target.value }))}
                  placeholder={zadarmaSettings?.api_secret_masked ? `Zapisany: ${zadarmaSettings.api_secret_masked}` : 'ZADARMA_API_SECRET'}
                  style={s.input}
                  type="password"
                />
                <input
                  value={zadarmaForm.caller_id}
                  onChange={(e) => setZadarmaForm((f) => ({ ...f, caller_id: e.target.value }))}
                  placeholder="Nadawca SMS, np. ARBOR"
                  style={s.input}
                />
                <div style={s.inlineActions}>
                  <button type="submit" style={s.sendBtn} disabled={zadarmaSaving}>
                    {zadarmaSaving ? 'Zapisuje...' : 'Zapisz Zadarme'}
                  </button>
                  <button type="button" style={s.rowBtn} onClick={testZadarmaSettings} disabled={zadarmaTesting || !zadarmaSettings?.configured}>
                    {zadarmaTesting ? 'Test...' : 'Testuj po zapisie'}
                  </button>
                </div>
              </form>
              <div style={s.callForm}>
                <div style={s.manualTitle}>Co ustawic w panelu Zadarma</div>
                <div style={s.providerChecklistList}>
                  <div style={s.providerChecklistItem}>
                    <span style={zadarmaSettings?.configured ? s.okBadge : s.reviewBadge}>{zadarmaSettings?.configured ? 'OK' : '1'}</span>
                    <div>
                      <strong>API keys</strong>
                      <div style={s.agentHistoryMeta}>Settings / Integrations and API / API keys: skopiuj key i secret do formularza obok.</div>
                    </div>
                  </div>
                  <div style={s.providerChecklistItem}>
                    <span style={zadarmaSettings?.sms_webhook_url ? s.okBadge : s.reviewBadge}>{zadarmaSettings?.sms_webhook_url ? 'OK' : '2'}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>SMS webhook</strong>
                      <div style={s.agentHistoryMeta}>{zadarmaSettings?.sms_webhook_url || 'Najpierw ustaw PUBLIC_BASE_URL.'}</div>
                    </div>
                    {zadarmaSettings?.sms_webhook_url ? (
                      <button type="button" style={s.rowBtn} onClick={() => copyAgentText(zadarmaSettings.sms_webhook_url, 'Webhook SMS Zadarma')}>
                        Kopiuj
                      </button>
                    ) : null}
                  </div>
                  <div style={s.providerChecklistItem}>
                    <span style={s.okBadge}>3</span>
                    <div>
                      <strong>Polaczenia przychodzace</strong>
                      <div style={s.agentHistoryMeta}>W panelu Zadarma przypisz numer DID do SIP/PBX albo przekierowania. ARBOR nie musi posredniczyc w audio.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'agent' && (
          <div className="telefonia-panel telefonia-agent-panel" style={s.panel}>
            <div style={s.callsIntro}>
              Podpiecie bez kodu: wybierz oddzial, wlacz agenta, skopiuj webhook i sekret do providera telefonii AI. Agent zapisuje rozmowy w CRM i historii telefonii w tym panelu.
            </div>
            <div style={s.branchStatusBox}>
              <div style={s.agentHistoryHeader}>
                <div>
                  <div style={s.manualTitle}>Oddzialy - status podpiecia</div>
                  <div style={s.agentHistoryMeta}>
                    Kontrola numerow, SMS i Agenta AI dla kazdego oddzialu osobno.
                  </div>
                </div>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={loadBranchIntegrationStatuses}
                  disabled={branchIntegrationStatusesLoading}
                >
                  {branchIntegrationStatusesLoading ? 'Sprawdzanie...' : 'Odswiez'}
                </button>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => setAgentForm((f) => ({ ...f, oddzial_id: String(nextBranchToFix.oddzial_id) }))}
                  disabled={!nextBranchToFix}
                >
                  Otworz najpilniejszy
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => {
                    if (!firstVisibleBranchStatus) return;
                    setAgentForm((f) => ({ ...f, oddzial_id: String(firstVisibleBranchStatus.oddzial_id) }));
                  }}
                  disabled={!firstVisibleBranchStatus}
                >
                  Otworz pierwszy z widoku
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => {
                    if (!previousVisibleBranchStatus) return;
                    setAgentForm((f) => ({ ...f, oddzial_id: String(previousVisibleBranchStatus.oddzial_id) }));
                  }}
                  disabled={!previousVisibleBranchStatus}
                >
                  Otworz poprzedni z widoku
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => {
                    if (!nextVisibleBranchStatus) return;
                    setAgentForm((f) => ({ ...f, oddzial_id: String(nextVisibleBranchStatus.oddzial_id) }));
                  }}
                  disabled={!nextVisibleBranchStatus}
                >
                  Otworz nastepny z widoku
                </button>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => copyAgentText(buildBranchReadinessReport(), 'Raport oddzialow')}
                  disabled={!branchIntegrationStatuses.length}
                >
                  Kopiuj raport
                </button>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => copyAgentText(buildFilteredBranchWorkPlan(), 'Plan pracy oddzialow')}
                  disabled={!filteredBranchIntegrationStatuses.length}
                >
                  Kopiuj plan pracy
                </button>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => copyAgentText(buildVisibleBranchBlockersText(), 'Braki oddzialow')}
                  disabled={!filteredBranchIntegrationStatuses.length}
                >
                  Kopiuj braki
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => copyAgentText(buildStaleBranchTestsText(), 'Oddzialy do ponownego testu')}
                  disabled={!staleTestBranchStatuses.length}
                >
                  Kopiuj retesty
                </button>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={createBranchRetestNotifications}
                  disabled={branchRetestCreating || !staleTestBranchStatuses.length}
                >
                  {branchRetestCreating ? 'Tworze retesty...' : 'Utworz zadania retestu'}
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => copyAgentText(buildBranchStageSummaryText(), 'Podsumowanie etapow')}
                  disabled={!branchIntegrationStatuses.length}
                >
                  Kopiuj etapy
                </button>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={exportBranchStatusCsv}
                  disabled={!filteredBranchIntegrationStatuses.length}
                >
                  Eksport CSV
                </button>
              </div>
              {branchIntegrationStatuses.length ? (
                <div style={s.branchNavHint}>
                  <span>Poprzedni: <strong>{branchStatusName(previousVisibleBranchStatus)}</strong></span>
                  <span>Aktualny: <strong>{selectedBranchStatus ? branchStatusName(selectedBranchStatus) : 'nie wybrano'}</strong></span>
                  <span>Nastepny: <strong>{branchStatusName(nextVisibleBranchStatus)}</strong></span>
                </div>
              ) : null}
              {branchIntegrationStatuses.length ? (
                <>
                  <div style={s.branchRolloutBox}>
                    <div style={s.branchRolloutTop}>
                      <span>Postep podpiecia telefonii oddzialow</span>
                      <strong>{branchRolloutPercent}%</strong>
                    </div>
                    <div style={s.branchRolloutBar} aria-label={`Postep podpiecia telefonii ${branchRolloutPercent}%`}>
                      <div style={{ ...s.branchRolloutFill, width: `${branchRolloutPercent}%` }} />
                    </div>
                    <div style={s.branchRolloutMeta}>
                      <span>Gotowy: {branchStageSummary.Gotowy || 0}</span>
                      <span>Do testu: {branchStageSummary['Do testu'] || 0}</span>
                      <span>Retest: {branchReadinessSummary.retest}</span>
                      <span>Do danych: {branchStageSummary['Do danych'] || 0}</span>
                    </div>
                  </div>
                  <div style={s.branchStatusSummary}>
                    <button
                      type="button"
                      style={{ ...s.branchStatusKpi, ...(branchStatusFilter === 'ready' ? s.branchStatusKpiActive : null) }}
                      onClick={() => setBranchStatusFilter(branchStatusFilter === 'ready' ? 'all' : 'ready')}
                    >
                      <span>Gotowe</span>
                      <strong>{branchReadinessSummary.ready}</strong>
                    </button>
                    <button
                      type="button"
                      style={{ ...s.branchStatusKpi, ...(branchStatusFilter === 'todo' ? s.branchStatusKpiActive : null) }}
                      onClick={() => setBranchStatusFilter(branchStatusFilter === 'todo' ? 'all' : 'todo')}
                    >
                      <span>Do dopiecia</span>
                      <strong>{branchReadinessSummary.todo}</strong>
                    </button>
                    <button
                      type="button"
                      style={{ ...s.branchStatusKpi, ...(branchStatusFilter === 'attention' ? s.branchStatusKpiActive : null) }}
                      onClick={() => setBranchStatusFilter(branchStatusFilter === 'attention' ? 'all' : 'attention')}
                    >
                      <span>Uwagi operacyjne</span>
                      <strong>{branchReadinessSummary.attention}</strong>
                    </button>
                    <button
                      type="button"
                      style={{ ...s.branchStatusKpi, ...(branchStatusFilter === 'retest' ? s.branchStatusKpiActive : null) }}
                      onClick={() => setBranchStatusFilter(branchStatusFilter === 'retest' ? 'all' : 'retest')}
                    >
                      <span>Do ponownego testu</span>
                      <strong>{branchReadinessSummary.retest}</strong>
                    </button>
                  </div>
                  <div style={s.branchSearchRow}>
                    <input
                      value={branchStatusQuery}
                      onChange={(e) => setBranchStatusQuery(e.target.value)}
                      placeholder="Szukaj oddzialu, miasta, numeru, providera..."
                      style={s.agentSearch}
                    />
                    <select value={branchStageFilter} onChange={(e) => setBranchStageFilter(e.target.value)} style={s.select}>
                      <option value="all">Etap: wszystkie</option>
                      <option value="Do danych">Do danych ({branchStageSummary['Do danych'] || 0})</option>
                      <option value="Do testu">Do testu ({branchStageSummary['Do testu'] || 0})</option>
                      <option value="Uwagi">Uwagi ({branchStageSummary.Uwagi || 0})</option>
                      <option value="Do dopiecia">Do dopiecia ({branchStageSummary['Do dopiecia'] || 0})</option>
                      <option value="Gotowy">Gotowy ({branchStageSummary.Gotowy || 0})</option>
                    </select>
                    <select value={branchStatusSort} onChange={(e) => setBranchStatusSort(e.target.value)} style={s.select}>
                      <option value="needs">Sortuj: najpierw braki</option>
                      <option value="stage">Sortuj: etap wdrozenia</option>
                      <option value="ready">Sortuj: gotowosc malejaco</option>
                      <option value="activity">Sortuj: aktywnosc rozmow</option>
                      <option value="name">Sortuj: nazwa A-Z</option>
                    </select>
                    {branchStatusSort !== 'needs' && !branchStatusQuery && branchStatusFilter === 'all' && branchStageFilter === 'all' ? (
                      <button type="button" style={s.rowBtn} onClick={resetBranchStatusView}>
                        Resetuj widok
                      </button>
                    ) : null}
                    {(branchStatusQuery || branchStatusFilter !== 'all' || branchStageFilter !== 'all') ? (
                      <button type="button" style={s.rowBtn} onClick={resetBranchStatusView}>
                        Wyczyść
                      </button>
                    ) : null}
                  </div>
                  {(branchStatusFilter !== 'all' || branchStageFilter !== 'all' || branchStatusQuery) ? (
                    <div style={s.branchFilterNotice}>
                      Wyniki: {filteredBranchIntegrationStatuses.length} / {branchIntegrationStatuses.length}
                      <span>
                        {branchStatusFilter === 'all' ? 'Wszystkie statusy' : branchStatusFilter === 'ready' ? 'Gotowe' : branchStatusFilter === 'todo' ? 'Do dopiecia' : branchStatusFilter === 'retest' ? 'Do ponownego testu' : 'Uwagi operacyjne'}
                        {branchStageFilter !== 'all' ? ` / etap: ${branchStageFilter}` : ''}
                      </span>
                    </div>
                  ) : null}
                  {visibleBranchWorkQueue.length ? (
                    <div style={s.branchQueueBox}>
                      <div style={s.branchQueueHeader}>
                        <div style={s.agentHistoryMeta}>Nastepne z aktualnego widoku</div>
                        <button
                          type="button"
                          style={s.rowBtn}
                          onClick={() => copyAgentText(buildVisibleBranchQueueText(), 'Kolejka oddzialow')}
                        >
                          Kopiuj kolejke
                        </button>
                      </div>
                      <div style={s.branchQueueList}>
                        {visibleBranchWorkQueue.map((row, index) => {
                          const readiness = branchReadiness(row);
                          const stage = branchLaunchStage(row);
                          return (
                            <button
                              key={row.oddzial_id}
                              type="button"
                              style={s.branchQueueItem}
                              onClick={() => setAgentForm((f) => ({ ...f, oddzial_id: String(row.oddzial_id) }))}
                            >
                              <strong>{index + 1}. {row.oddzial_name || `Oddzial #${row.oddzial_id}`}</strong>
                              <span>{stage.label} / {readiness.percent}%</span>
                              <small>{branchNextAction(row)}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div style={s.branchStatusGrid}>
                    {filteredBranchIntegrationStatuses.map((row) => {
                      const tone = branchIntegrationTone(row);
                      const selected = String(row.oddzial_id) === String(agentForm.oddzial_id);
                      const readiness = branchReadiness(row);
                      const stage = branchLaunchStage(row);
                      return (
                        <button
                          key={row.oddzial_id}
                          type="button"
                          style={{ ...s.branchStatusCard, ...(selected ? s.branchStatusCardActive : null) }}
                          onClick={() => setAgentForm((f) => ({ ...f, oddzial_id: String(row.oddzial_id) }))}
                        >
                          <div style={s.agentHealthTop}>
                            <span style={{
                              ...s.agentHealthDot,
                              background: tone === 'ok' ? '#22c55e' : tone === 'bad' ? '#ef4444' : '#f59e0b',
                            }}
                            />
                            <span>{branchIntegrationStatusLabel(row)} / {readiness.percent}%</span>
                            <span style={{
                              ...s.branchStageBadge,
                              ...(stage.tone === 'ok' ? s.branchStageOk : stage.tone === 'bad' ? s.branchStageBad : s.branchStageWarn),
                            }}
                            >
                              {stage.label}
                            </span>
                          </div>
                          <strong style={s.agentHealthValue}>{row.oddzial_name || `Oddzial #${row.oddzial_id}`}</strong>
                          <div style={s.branchMiniBar}>
                            <div style={{ ...s.branchMiniFill, width: `${readiness.percent}%` }} />
                          </div>
                          <div style={s.branchStatusMeta}>
                            <span>Tel: {row.telefon || 'brak'}</span>
                            <span>SMS: {row.sms_sender_id || row.telefon || 'globalny'}</span>
                            <span>Rozmowy: {Number(row.intakes_total || 0)}</span>
                            <span>Do sprawdzenia: {Number(row.needs_review || 0)}</span>
                          </div>
                          <div style={s.agentHistoryMeta}>
                            {branchLastTestLabel(row)}
                          </div>
                          {readiness.blockers.length ? (
                            <div style={s.branchBlockers}>Braki: {readiness.blockers.join(', ')}</div>
                          ) : null}
                          <div style={s.branchNextAction}>{branchNextAction(row)}</div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedBranchStatus ? (() => {
                    const readiness = branchReadiness(selectedBranchStatus);
                    const stage = branchLaunchStage(selectedBranchStatus);
                    return (
                      <div style={s.branchSelectedBox}>
                        <div style={s.agentHistoryHeader}>
                          <div>
                            <div style={s.manualTitle}>
                              Wybrany oddzial: {selectedBranchStatus.oddzial_name || `Oddzial #${selectedBranchStatus.oddzial_id}`}
                              <span style={{
                                ...s.branchStageBadge,
                                ...(stage.tone === 'ok' ? s.branchStageOk : stage.tone === 'bad' ? s.branchStageBad : s.branchStageWarn),
                                marginLeft: 8,
                              }}
                              >
                                {stage.label}
                              </span>
                            </div>
                            <div style={s.agentHistoryMeta}>
                              {selectedVisibleBranchPosition
                                ? `Pozycja w widoku: ${selectedVisibleBranchPosition} / ${filteredBranchIntegrationStatuses.length}. `
                                : ''}
                              {branchNextAction(selectedBranchStatus)}
                            </div>
                          </div>
                          <button
                            type="button"
                            style={s.rowBtnActive}
                            onClick={() => prepareBranchProviderConnection(selectedBranchStatus)}
                            disabled={branchQuickConnectingId === selectedBranchStatus.oddzial_id}
                          >
                            {branchQuickConnectingId === selectedBranchStatus.oddzial_id ? 'Przygotowuje...' : 'Przygotuj podpiecie'}
                          </button>
                          <button
                            type="button"
                            style={s.rowBtnActive}
                            onClick={() => copyAgentText(buildSingleBranchReadinessReport(selectedBranchStatus), 'Raport oddzialu')}
                          >
                            Kopiuj status oddzialu
                          </button>
                          <button
                            type="button"
                            style={s.rowBtn}
                            onClick={() => copyAgentText(buildBranchProviderPackage(selectedBranchStatus), 'Dane Zadarma oddzialu')}
                          >
                            Kopiuj dane Zadarma
                          </button>
                          <button
                            type="button"
                            style={s.rowBtn}
                            onClick={() => copyAgentText(buildBranchProviderBrief(selectedBranchStatus), 'Instrukcja Zadarma oddzialu')}
                          >
                            Kopiuj instrukcje
                          </button>
                        </div>
                        <div style={s.branchSelectedGrid}>
                          <div>
                            <span style={s.agentHealthTop}>Gotowosc</span>
                            <strong style={s.agentHealthValue}>{readiness.percent}%</strong>
                          </div>
                          <div>
                            <span style={s.agentHealthTop}>Telefon</span>
                            <strong style={s.agentHealthValue}>{selectedBranchStatus.telefon || 'brak'}</strong>
                          </div>
                          <div>
                            <span style={s.agentHealthTop}>SMS</span>
                            <strong style={s.agentHealthValue}>{selectedBranchStatus.sms_sender_id || selectedBranchStatus.telefon || 'globalny/brak'}</strong>
                          </div>
                          <div>
                            <span style={s.agentHealthTop}>Ostatni test</span>
                            <strong style={s.agentHealthValue}>
                              {selectedBranchStatus.last_test_log_at
                                ? `${selectedBranchStatus.last_test_log_status === 'ok' ? 'OK' : 'Blad'}`
                                : 'brak'}
                            </strong>
                            <div style={s.agentHistoryMeta}>
                              {branchLastTestAgeDays(selectedBranchStatus) === null
                                ? `Wymagany test co ${BRANCH_TEST_STALE_DAYS} dni.`
                                : `${branchLastTestAgeDays(selectedBranchStatus)} dni temu, wazny do ${BRANCH_TEST_STALE_DAYS} dni.`}
                            </div>
                          </div>
                        </div>
                        <div style={readiness.blockers.length ? s.branchBlockers : s.providerReadyNote}>
                          {readiness.blockers.length ? `Braki: ${readiness.blockers.join(', ')}` : 'Ten oddzial ma komplet danych do pracy operacyjnej.'}
                        </div>
                      </div>
                    );
                  })() : null}
                </>
              ) : (
                <div style={s.emptyMuted}>
                  {branchIntegrationStatusesLoading ? 'Ladowanie statusow oddzialow...' : 'Brak oddzialow do pokazania.'}
                </div>
              )}
            </div>
            {agentLoading && <div style={s.empty}>Ladowanie konfiguracji...</div>}
            <div style={s.agentHealthBox}>
              <div style={s.agentHistoryHeader}>
                <div>
                  <div style={s.manualTitle}>Zdrowie integracji oddzialu</div>
                  <div style={s.agentHistoryMeta}>
                    Jeden podglad dla menadzerki: numer oddzialu, webhook, SMS-y i automaty.
                  </div>
                </div>
                <div style={s.inlineActions}>
                  <button
                    type="button"
                    style={s.rowBtn}
                    onClick={() => loadVoiceAgentIntegration(agentForm.oddzial_id)}
                    disabled={agentLoading || !agentForm.oddzial_id}
                  >
                    {agentLoading ? 'Sprawdzanie...' : 'Odswiez status'}
                  </button>
                  <button type="button" style={s.rowBtn} onClick={testVoiceAgentIntegration} disabled={agentTestLoading || !agentIntegration}>
                    {agentTestLoading ? 'Test...' : 'Test webhooka'}
                  </button>
                </div>
              </div>
              <div style={s.agentHealthGrid}>
                {agentHealthItems.map((item) => (
                  <div key={item.label} style={s.agentHealthItem}>
                    <div style={s.agentHealthTop}>
                      <span style={{
                        ...s.agentHealthDot,
                        background: item.tone === 'ok' ? '#22c55e' : item.tone === 'bad' ? '#ef4444' : '#f59e0b',
                      }}
                      />
                      <span>{item.label}</span>
                    </div>
                    <strong style={s.agentHealthValue}>{item.value}</strong>
                    <div style={s.agentHistoryMeta}>{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={s.integrationLogBox}>
              <div style={s.agentHistoryHeader}>
                <div>
                  <div style={s.manualTitle}>Ostatnie testy integracji</div>
                  <div style={s.agentHistoryMeta}>
                    Historia testow dla oddzialu {oddzialLabel(agentForm.oddzial_id)}: SMS, webhook i kolejne podpiecia.
                  </div>
                </div>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => loadIntegrationTestLogs(agentForm.oddzial_id)}
                  disabled={integrationTestLogsLoading || !agentForm.oddzial_id}
                >
                  {integrationTestLogsLoading ? 'Odswiezanie...' : 'Odswiez'}
                </button>
              </div>
              {integrationTestLogs.length ? (
                <div style={s.integrationLogList}>
                  {integrationTestLogs.map((log) => (
                    <div key={log.id} style={s.integrationLogItem}>
                      <span style={log.status === 'ok' ? s.okBadge : s.reviewBadge}>{log.status === 'ok' ? 'OK' : 'Blad'}</span>
                      <div style={{ minWidth: 0 }}>
                        <strong>{integrationTypeLabel(log.integration_type)} / {integrationActionLabel(log.action)}</strong>
                        <div style={s.agentHistoryMeta}>
                          {formatAgentDate(log.created_at)} · {log.provider || 'provider'}{log.target ? ` · ${log.target}` : ''}
                        </div>
                        {log.error ? <div style={s.issueList}>{log.error}</div> : null}
                        {!log.error && log.message ? <div style={s.agentHistoryMeta}>{log.message}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={s.emptyMuted}>
                  {integrationTestLogsLoading ? 'Ladowanie testow...' : 'Brak zapisanych testow integracji dla tego oddzialu.'}
                </div>
              )}
            </div>
            <div style={s.branchQuickStartBox}>
              <div style={s.providerChecklistHead}>
                <div>
                  <div style={s.manualTitle}>Szybki start oddzialu</div>
                  <div style={s.agentHistoryMeta}>
                    Zadarma bez grzebania w kodzie: zapisz numery, skopiuj webhook, odpal test.
                  </div>
                </div>
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => prepareBranchProviderConnection(selectedBranchStatus)}
                  disabled={!selectedBranchStatus || branchQuickConnectingId === Number(agentForm.oddzial_id)}
                >
                  {branchQuickConnectingId === Number(agentForm.oddzial_id) ? 'Przygotowuje...' : 'Przygotuj jednym kliknieciem'}
                </button>
              </div>
              <div style={s.branchQuickStartSteps}>
                {selectedBranchSetupSteps.map((step) => (
                  <div key={step.label} style={s.branchQuickStartStep}>
                    <span style={step.ready ? s.okBadge : s.reviewBadge}>{step.ready ? 'OK' : 'Do zrobienia'}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{step.label}</strong>
                      <div style={s.agentHistoryMeta}>{step.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={s.agentGrid}>
              <form style={s.callForm} onSubmit={saveVoiceAgentIntegration}>
                <div style={s.manualTitle}>Agent Ania / Polska Flora</div>
                <select
                  value={agentForm.oddzial_id}
                  onChange={(e) => setAgentForm((f) => ({ ...f, oddzial_id: e.target.value }))}
                  style={s.input}
                  required
                >
                  <option value="">Oddzial...</option>
                  {oddzialy.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nazwa || `Oddzial #${o.id}`} {o.telefon ? `(${o.telefon})` : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={agentForm.provider}
                  onChange={(e) => setAgentForm((f) => ({ ...f, provider: e.target.value }))}
                  style={s.input}
                >
                  <option value="zadarma">Zadarma</option>
                  <option value="external">Provider zewnetrzny / webhook</option>
                  <option value="vapi">Vapi</option>
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="twilio">Twilio</option>
                </select>
                <input
                  value={agentForm.provider_account_id}
                  onChange={(e) => setAgentForm((f) => ({ ...f, provider_account_id: e.target.value }))}
                  placeholder="ID konta / asystenta u providera (opcjonalnie)"
                  style={s.input}
                />
                <input
                  value={agentForm.provider_api_key}
                  onChange={(e) => setAgentForm((f) => ({ ...f, provider_api_key: e.target.value }))}
                  placeholder={agentIntegration?.provider_api_key_masked ? `Token zapisany: ${agentIntegration.provider_api_key_masked}` : 'API key providera (opcjonalnie)'}
                  style={s.input}
                  type="password"
                />
                <div style={s.inlineActions}>
                  <button type="submit" style={s.sendBtn} disabled={agentSaving || !agentForm.oddzial_id}>
                    {agentSaving ? 'Wlaczanie...' : agentIntegration ? 'Zapisz podpiecie' : 'Wlacz agenta'}
                  </button>
                  {agentIntegration ? (
                    <button
                      type="button"
                      style={agentIntegration.status === 'active' ? s.dangerBtn : s.rowBtnActive}
                      onClick={() => setVoiceAgentStatus(agentIntegration.status === 'active' ? 'paused' : 'active')}
                      disabled={agentSaving || !agentForm.oddzial_id}
                    >
                      {agentIntegration.status === 'active' ? 'Pauzuj' : 'Wznow'}
                    </button>
                  ) : null}
                  <button type="button" style={s.rowBtn} onClick={testVoiceAgentIntegration} disabled={agentTestLoading || !agentIntegration}>
                    {agentTestLoading ? 'Test...' : 'Test konfiguracji'}
                  </button>
                  <button
                    type="button"
                    style={s.rowBtnActive}
                    onClick={runBranchSetupTest}
                    disabled={branchSetupTesting || !agentIntegration || !agentForm.oddzial_id}
                  >
                    {branchSetupTesting ? 'Test calosci...' : 'Test calosci oddzialu'}
                  </button>
                </div>
              </form>

              <div style={s.callForm}>
                <div style={s.manualTitle}>Dane do wklejenia u providera</div>
                <div style={s.providerChecklistBox}>
                  <div style={s.providerChecklistHead}>
                    <div>
                      <strong>Checklist podpiecia: {providerChecklist.providerName}</strong>
                      <div style={s.agentHistoryMeta}>
                        Gotowosc: {providerChecklist.readiness}% ({providerChecklist.readyCount}/{providerChecklist.totalCount})
                      </div>
                    </div>
                    <button
                      type="button"
                      style={s.rowBtn}
                      onClick={runBranchSetupTest}
                      disabled={branchSetupTesting || !agentIntegration || !agentForm.oddzial_id}
                    >
                      {branchSetupTesting ? 'Test...' : 'Test calosci'}
                    </button>
                  </div>
                  <div style={s.providerReadinessBar} aria-label={`Gotowosc podpiecia ${providerChecklist.readiness}%`}>
                    <div style={{ ...s.providerReadinessFill, width: `${providerChecklist.readiness}%` }} />
                  </div>
                  <div style={providerChecklist.blockers.length ? s.providerBlockers : s.providerReadyNote}>
                    {providerChecklist.blockers.length
                      ? `Blokuje start: ${providerChecklist.blockers.join(' | ')}`
                      : 'Oddzial gotowy do testu produkcyjnego.'}
                  </div>
                  <div style={s.providerChecklistList}>
                    {providerChecklist.steps.map((step) => (
                      <div key={step.label} style={s.providerChecklistItem}>
                        <span style={step.ready ? s.okBadge : s.reviewBadge}>{step.ready ? 'OK' : 'Brak'}</span>
                        <div style={{ minWidth: 0 }}>
                          <strong>{step.label}</strong>
                          <div style={s.agentHistoryMeta}>{step.detail}</div>
                        </div>
                        {step.copy ? (
                          <button type="button" style={s.rowBtn} onClick={() => copyAgentText(step.copy, step.label)} disabled={!step.ready}>
                            Kopiuj
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    style={{ ...s.rowBtn, marginTop: 8 }}
                    onClick={() => copyAgentText(providerChecklist.reportText, 'Raport audytu')}
                  >
                    Kopiuj raport audytu
                  </button>
                </div>
                <div style={s.providerGuideBox}>
                  <div style={s.providerChecklistHead}>
                    <strong>Instrukcja: {providerSetupGuide.title}</strong>
                    <button
                      type="button"
                      style={s.rowBtn}
                      onClick={() => copyAgentText(providerSetupGuide.text, 'Instrukcja providera')}
                    >
                      Kopiuj instrukcje
                    </button>
                  </div>
                  <ol style={s.providerGuideList}>
                    {providerSetupGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
                <div style={s.agentStatusRow}>
                  <span>Status</span>
                  <strong style={{ color: agentIntegration?.status === 'active' ? '#22c55e' : 'var(--text-muted)' }}>
                    {agentIntegration?.status === 'active' ? 'Aktywny' : agentIntegration?.status === 'paused' ? 'Pauza' : 'Niepodlaczony'}
                  </strong>
                </div>
                <label style={s.copyLabel}>Webhook URL</label>
                <div style={s.copyRow}>
                  <input value={agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake'} readOnly style={s.input} />
                  <button type="button" style={s.rowBtn} onClick={() => copyAgentText(agentIntegration?.webhook_url || '/api/telephony/voice-agent/polska-flora/intake', 'Webhook')}>
                    Kopiuj
                  </button>
                </div>
                <label style={s.copyLabel}>Header</label>
                <div style={s.copyRow}>
                  <input value="x-voice-agent-secret" readOnly style={s.input} />
                  <button type="button" style={s.rowBtn} onClick={() => copyAgentText('x-voice-agent-secret', 'Header')}>
                    Kopiuj
                  </button>
                </div>
                <label style={s.copyLabel}>Sekret</label>
                <div style={s.copyRow}>
                  <input value={agentIntegration?.webhook_secret || ''} readOnly style={s.input} placeholder="Pojawi sie po wlaczeniu agenta" />
                  <button type="button" style={s.rowBtn} onClick={() => copyAgentText(agentIntegration?.webhook_secret || '', 'Sekret')} disabled={!agentIntegration?.webhook_secret}>
                    Kopiuj
                  </button>
                </div>
                <label style={s.copyLabel}>Pakiet podpiecia JSON</label>
                <textarea value={buildAgentProviderPackage()} readOnly rows={7} style={s.textarea} />
                <button
                  type="button"
                  style={s.rowBtnActive}
                  onClick={() => copyAgentText(buildAgentProviderPackage(), 'Pakiet podpiecia')}
                  disabled={!agentForm.oddzial_id}
                >
                  Kopiuj pakiet
                </button>
                <label style={s.copyLabel}>Prompt systemowy</label>
                <textarea value={agentConfig?.system_prompt || ''} readOnly rows={8} style={s.textarea} />
                <button type="button" style={s.rowBtn} onClick={() => copyAgentText(agentConfig?.system_prompt || '', 'Prompt')} disabled={!agentConfig?.system_prompt}>
                  Kopiuj prompt
                </button>
              </div>

              <form style={s.callForm} onSubmit={saveBranchTelephony}>
                <div style={s.manualTitle}>Numery oddzialu</div>
                <div style={s.callsIntro}>
                  Tu ustawiasz dane dla wybranego oddzialu. Agent widzi numer oddzialu, a SMS-y biora nadawce z tego miejsca.
                </div>
                <label style={s.copyLabel}>Telefon oddzialu</label>
                <input
                  value={branchTelephonyForm.telefon}
                  onChange={(e) => setBranchTelephonyForm((f) => ({ ...f, telefon: e.target.value }))}
                  placeholder="+48..."
                  style={s.input}
                />
                <label style={s.copyLabel}>Nadawca SMS oddzialu</label>
                <input
                  value={branchTelephonyForm.sms_sender_id}
                  onChange={(e) => setBranchTelephonyForm((f) => ({ ...f, sms_sender_id: e.target.value }))}
                  placeholder="np. ARBOR-KRK albo numer SMS"
                  style={s.input}
                  maxLength={64}
                />
                <div style={s.agentHistoryMeta}>
                  Puste pole nadawcy oznacza fallback do telefonu oddzialu lub globalnej konfiguracji SMS.
                </div>
                <button type="submit" style={s.sendBtn} disabled={branchTelephonySaving || !agentForm.oddzial_id}>
                  {branchTelephonySaving ? 'Zapisywanie...' : 'Zapisz numery oddzialu'}
                </button>
                <div style={s.branchSmsTestBox}>
                  <label style={s.copyLabel}>Test SMS z tego oddzialu</label>
                  <div style={s.copyRow}>
                    <input
                      value={branchTelephonyForm.test_phone}
                      onChange={(e) => setBranchTelephonyForm((f) => ({ ...f, test_phone: e.target.value }))}
                      placeholder="Numer testowy +48..."
                      style={s.input}
                    />
                    <button
                      type="button"
                      style={s.rowBtnActive}
                      onClick={sendBranchTestSms}
                      disabled={branchSmsTesting || !agentForm.oddzial_id}
                    >
                      {branchSmsTesting ? 'Wysylanie...' : 'Wyslij test'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
            <div style={s.agentReminderBox}>
              <div style={s.agentHistoryHeader}>
                <div>
                  <div style={s.manualTitle}>Przypomnienia SMS na jutro</div>
                  <div style={s.agentHistoryMeta}>
                    Kolejka automatu dla oddzialu {oddzialLabel(agentForm.oddzial_id)}. To jest podglad - nic nie wysyla.
                  </div>
                </div>
                <button
                  type="button"
                  style={s.rowBtn}
                  onClick={() => loadAgentReminderPreview(agentForm.oddzial_id)}
                  disabled={agentReminderLoading || !agentForm.oddzial_id}
                >
                  {agentReminderLoading ? 'Sprawdzanie...' : 'Sprawdz'}
                </button>
              </div>
              <div style={s.agentReminderSummary}>
                <strong>{agentReminderPreview.total || 0}</strong>
                <span>SMS do wyslania przez automat dzien przed ogledzinami</span>
              </div>
              {agentReminderPreview.items?.length ? (
                <div style={s.agentReminderList}>
                  {agentReminderPreview.items.slice(0, 5).map((row) => (
                    <div key={row.id} style={s.agentReminderItem}>
                      <div>
                        <strong>{row.customer_name || 'Klient telefoniczny'}</strong>
                        <div style={s.agentHistoryMeta}>
                          {row.caller_phone || 'brak telefonu'} · {formatAgentDate(row.appointment_at)}
                        </div>
                      </div>
                      <div style={s.agentReminderText}>{row.sms_body}</div>
                    </div>
                  ))}
                  {agentReminderPreview.items.length > 5 ? (
                    <div style={s.agentHistoryMeta}>+{agentReminderPreview.items.length - 5} kolejnych przypomnien</div>
                  ) : null}
                </div>
              ) : (
                <div style={s.emptyMuted}>Brak przypomnien SMS do wyslania jutro.</div>
              )}
            </div>
            <div style={s.agentHistoryHeader}>
              <div>
                <div style={s.manualTitle}>Historia rozmow agenta</div>
                <div style={s.agentHistoryMeta}>
                  Ostatnie zapisy z webhooka dla oddzialu {oddzialLabel(agentForm.oddzial_id)} ({agentIntakesTotal}) · do sprawdzenia: {agentNeedsReviewCount}
                </div>
              </div>
              <button
                type="button"
                style={s.rowBtn}
                onClick={() => loadVoiceAgentIntakes(agentForm.oddzial_id)}
                disabled={agentIntakesLoading || !agentForm.oddzial_id}
              >
                {agentIntakesLoading ? 'Odswiezanie...' : 'Odswiez'}
              </button>
            </div>
            <div style={s.agentFilterRow}>
              <input
                value={agentHistoryQuery}
                onChange={(e) => setAgentHistoryQuery(e.target.value)}
                placeholder="Szukaj rozmowy: klient, telefon, adres, usluga..."
                style={s.agentSearch}
              />
              {agentHistoryFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  style={agentHistoryFilter === filter.key ? s.rowBtnActive : s.rowBtn}
                  onClick={() => setAgentHistoryFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
              {agentHistoryQuery ? (
                <button type="button" style={s.rowBtn} onClick={() => setAgentHistoryQuery('')}>
                  Wyczysc
                </button>
              ) : null}
            </div>
            {agentIntakesLoading && <div style={s.empty}>Ladowanie historii rozmow...</div>}
            {!agentIntakesLoading && agentIntakes.length === 0 ? (
              <div style={s.emptyMuted}>Brak rozmow agenta dla tego oddzialu.</div>
            ) : null}
            {!agentIntakesLoading && agentIntakes.length > 0 && filteredAgentIntakes.length === 0 ? (
              <div style={s.emptyMuted}>Brak rozmow dla wybranego filtra.</div>
            ) : null}
            {!agentIntakesLoading && filteredAgentIntakes.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Data</th>
                      <th style={s.th}>Klient</th>
                      <th style={s.th}>Telefon</th>
                      <th style={s.th}>Usluga</th>
                      <th style={s.th}>Termin</th>
                      <th style={s.th}>Jakosc</th>
                      <th style={s.th}>SMS</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Powiazania</th>
                      <th style={s.th}>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgentIntakes.map((x) => (
                      <tr key={x.id}>
                        <td style={s.td}>{formatAgentDate(x.created_at)}</td>
                        <td style={s.td}>
                          <strong style={{ color: 'var(--text)' }}>{x.customer_name || 'Klient telefoniczny'}</strong>
                          <div style={s.auditBy}>{[x.inspection_address, x.city].filter(Boolean).join(', ') || 'brak adresu'}</div>
                        </td>
                        <td style={s.td}>
                          {telHref(x.caller_phone) ? (
                            <a href={telHref(x.caller_phone)} style={s.telLinkSmall}>{x.caller_phone}</a>
                          ) : x.caller_phone || 'brak'}
                        </td>
                        <td style={s.td}>{agentServiceLabel(x.service_type)}</td>
                        <td style={s.td}>{formatAgentDate(x.appointment_at)}</td>
                        <td style={s.td}>
                          <span style={x.quality_status === 'needs_review' ? s.reviewBadge : s.okBadge}>
                            {x.quality_status === 'needs_review' ? 'Do sprawdzenia' : 'OK'}
                          </span>
                          {Array.isArray(x.quality_issues) && x.quality_issues.length ? (
                            <div style={s.issueList}>{x.quality_issues.map(agentIssueLabel).join(', ')}</div>
                          ) : null}
                        </td>
                        <td style={s.td}>
                          <span style={agentSmsStatusTone(x)}>{agentSmsStatusLabel(x)}</span>
                          {x.sms_status?.confirmation_at ? (
                            <div style={s.auditBy}>Potw.: {formatAgentDate(x.sms_status.confirmation_at)}</div>
                          ) : null}
                          {x.sms_status?.reminder_at ? (
                            <div style={s.auditBy}>Przyp.: {formatAgentDate(x.sms_status.reminder_at)}</div>
                          ) : null}
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, background: 'rgba(34,197,94,0.12)', color: 'var(--accent)' }}>
                            {x.ogledziny_status || x.crm_stage || 'zapisano'}
                          </span>
                        </td>
                        <td style={s.td}>
                          <div style={s.agentLinks}>
                            {x.crm_lead_id ? <span>Lead #{x.crm_lead_id}</span> : null}
                            {x.klient_id ? <span>Klient #{x.klient_id}</span> : null}
                            {x.ogledziny_id ? <span>Ogl. #{x.ogledziny_id}</span> : null}
                          </div>
                        </td>
                        <td style={s.td}>
                          <button
                            type="button"
                            style={selectedAgentIntake?.id === x.id ? s.rowBtnActive : s.rowBtn}
                            onClick={() => setSelectedAgentIntake((current) => current?.id === x.id ? null : x)}
                          >
                            {selectedAgentIntake?.id === x.id ? 'Ukryj' : 'Szczegoly'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={s.pagination}>
                  <button
                    type="button"
                    style={s.pageBtn}
                    onClick={() => setAgentHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={agentHistoryPage <= 1 || agentIntakesLoading}
                  >
                    Poprzednia
                  </button>
                  <span style={s.pageInfo}>
                    Strona {agentHistoryPage} z {agentHistoryTotalPages} · rekordy {filteredAgentIntakes.length} / {agentIntakesTotal}
                  </span>
                  <button
                    type="button"
                    style={s.pageBtn}
                    onClick={() => setAgentHistoryPage((p) => Math.min(agentHistoryTotalPages, p + 1))}
                    disabled={agentHistoryPage >= agentHistoryTotalPages || agentIntakesLoading}
                  >
                    Nastepna
                  </button>
                </div>
              </div>
            ) : null}
            {selectedAgentIntake ? (
              <div style={s.agentDetailBox}>
                <div style={s.agentDetailTop}>
                  <div>
                    <div style={s.manualTitle}>{selectedAgentIntake.customer_name || 'Klient telefoniczny'}</div>
                    <div style={s.agentHistoryMeta}>
                      {selectedAgentIntake.provider || 'external'} · {selectedAgentIntake.call_sid || selectedAgentIntake.external_id || `intake #${selectedAgentIntake.id}`}
                    </div>
                  </div>
                  <div style={s.inlineActions}>
                    {selectedAgentIntake.crm_lead_id ? (
                      <button type="button" style={s.rowBtn} onClick={() => navigate('/crm/pipeline')}>
                        CRM
                      </button>
                    ) : null}
                    {selectedAgentIntake.klient_id ? (
                      <button type="button" style={s.rowBtn} onClick={() => navigate('/klienci')}>
                        Klienci
                      </button>
                    ) : null}
                    {selectedAgentIntake.ogledziny_id ? (
                      <button type="button" style={s.rowBtn} onClick={() => navigate('/ogledziny')}>
                        Ogledziny
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={s.agentDetailGrid}>
                  <div>
                    <div style={s.copyLabel}>Jakosc zapisu</div>
                    <div style={s.agentDetailText}>
                      {selectedAgentIntake.quality_status === 'needs_review'
                        ? `Do sprawdzenia: ${(selectedAgentIntake.quality_issues || []).map(agentIssueLabel).join(', ')}`
                        : 'OK - rozmowa ma komplet danych do dalszej obslugi.'}
                    </div>
                  </div>
                  <div>
                    <div style={s.copyLabel}>Notatka</div>
                    <div style={s.agentDetailText}>{selectedAgentIntake.notes || 'Brak notatki.'}</div>
                  </div>
                  <div>
                    <div style={s.copyLabel}>Transkrypt</div>
                    <div style={s.agentDetailText}>{selectedAgentIntake.transcript || 'Brak transkryptu.'}</div>
                  </div>
                  <div>
                    <div style={s.copyLabel}>SMS</div>
                    <div style={s.agentDetailText}>
                      <div>{agentSmsStatusLabel(selectedAgentIntake)}</div>
                      {selectedAgentIntake.sms_status?.confirmation_at ? (
                        <div>Potwierdzenie: {formatAgentDate(selectedAgentIntake.sms_status.confirmation_at)}</div>
                      ) : null}
                      {selectedAgentIntake.sms_status?.reminder_at ? (
                        <div>Przypomnienie: {formatAgentDate(selectedAgentIntake.sms_status.reminder_at)}</div>
                      ) : null}
                      {selectedAgentIntake.sms_status?.confirmation_error ? (
                        <div>Blad potwierdzenia: {selectedAgentIntake.sms_status.confirmation_error}</div>
                      ) : null}
                      {selectedAgentIntake.sms_status?.reminder_error ? (
                        <div>Blad przypomnienia: {selectedAgentIntake.sms_status.reminder_error}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <form style={s.agentFixForm} onSubmit={saveAgentIntakeFix}>
                  <div style={s.manualTitle}>Korekta danych z rozmowy</div>
                  <div style={s.agentFixGrid}>
                    <input
                      value={agentFixForm.customer_name}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, customer_name: e.target.value }))}
                      placeholder="Imie i nazwisko"
                      style={s.input}
                    />
                    <input
                      value={agentFixForm.caller_phone}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, caller_phone: e.target.value }))}
                      placeholder="Telefon"
                      style={s.input}
                    />
                    <input
                      value={agentFixForm.inspection_address}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, inspection_address: e.target.value }))}
                      placeholder="Adres ogledzin"
                      style={s.input}
                    />
                    <input
                      value={agentFixForm.city}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, city: e.target.value }))}
                      placeholder="Miasto"
                      style={s.input}
                    />
                    <select
                      value={agentFixForm.service_type}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, service_type: e.target.value }))}
                      style={s.input}
                    >
                      <option value="">Typ uslugi...</option>
                      <option value="wycinka_pielegnacja">Drzewa</option>
                      <option value="dach">Dach</option>
                      <option value="elewacja_kostka">Elewacja / kostka</option>
                      <option value="ogrod">Ogrod</option>
                      <option value="inne">Inne</option>
                    </select>
                    <input
                      type="datetime-local"
                      value={agentFixForm.appointment_at}
                      onChange={(e) => setAgentFixForm((f) => ({ ...f, appointment_at: e.target.value }))}
                      style={s.input}
                    />
                  </div>
                  <textarea
                    value={agentFixForm.notes}
                    onChange={(e) => setAgentFixForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Notatka do CRM"
                    rows={2}
                    style={s.textarea}
                  />
                  <textarea
                    value={agentFixForm.transcript}
                    onChange={(e) => setAgentFixForm((f) => ({ ...f, transcript: e.target.value }))}
                    placeholder="Transkrypt / streszczenie"
                    rows={2}
                    style={s.textarea}
                  />
                  <div style={s.inlineActions}>
                    <label style={s.checkboxWrap}>
                      <input
                        type="checkbox"
                        checked={agentFixForm.create_missing_inspection}
                        onChange={(e) => setAgentFixForm((f) => ({ ...f, create_missing_inspection: e.target.checked }))}
                        disabled={!!selectedAgentIntake.ogledziny_id}
                      />
                      Utworz brakujace ogledziny
                    </label>
                    <button type="submit" style={s.sendBtn} disabled={agentFixSaving}>
                      {agentFixSaving ? 'Zapis...' : 'Zapisz korekte'}
                    </button>
                  </div>
                </form>
                <div style={s.agentSmsBox}>
                  <div style={s.manualTitle}>SMS potwierdzajacy</div>
                  <div style={s.agentSmsPreview}>
                    {buildAgentSmsConfirmation(selectedAgentIntake)}
                  </div>
                  <div style={s.inlineActions}>
                    <span style={s.agentHistoryMeta}>
                      Nadawca SMS zostanie dobrany z oddzialu {oddzialLabel(selectedAgentIntake.oddzial_id)}.
                    </span>
                    <button
                      type="button"
                      style={{
                        ...s.sendBtn,
                        opacity: (!selectedAgentIntake.caller_phone || !selectedAgentIntake.appointment_at || agentSmsSending) ? 0.55 : 1,
                      }}
                      disabled={!selectedAgentIntake.caller_phone || !selectedAgentIntake.appointment_at || agentSmsSending}
                      onClick={sendAgentConfirmationSms}
                    >
                      {agentSmsSending ? 'Wysylanie...' : 'Wyslij SMS'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === 'calls' && (
          <div className="telefonia-panel telefonia-calls-panel" style={s.panel}>
            <div style={s.callsIntro}>
              Kliknięcie „Zadzwoń” otwiera aplikację telefonu (<code>tel:</code>) — działa na komputerze z softphone lub na telefonie. Zapis połączenia i kolejka oddzwonień są w bazie aplikacji (integracja VoIP możliwa później).
            </div>
            {telLoading && <div style={s.empty}>Ładowanie…</div>}
            <div style={s.callsIntro}>
              Nowy przeplyw: specjalista klika "Zadzwon i zapisz", a przy telefonie od klienta zapisuje rozmowe jako przychodzaca i opcjonalnie tworzy oddzwonienie.
            </div>
            <div style={s.callsGrid}>
              <form style={s.callForm} onSubmit={saveIncomingCall}>
                <div style={s.manualTitle}>Przyjmij telefon od klienta</div>
                <select
                  value={incomingForm.oddzial_id}
                  onChange={(e) => setIncomingForm((f) => ({ ...f, oddzial_id: e.target.value }))}
                  style={s.input}
                  required
                >
                  <option value="">Oddzial...</option>
                  {oddzialy.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nazwa || `Oddzial #${o.id}`}
                    </option>
                  ))}
                </select>
                <input
                  value={incomingForm.phone}
                  onChange={(e) => setIncomingForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Telefon klienta"
                  style={s.input}
                />
                <input
                  value={incomingForm.lead_name}
                  onChange={(e) => setIncomingForm((f) => ({ ...f, lead_name: e.target.value }))}
                  placeholder="Klient / firma"
                  style={s.input}
                />
                <div style={s.inline2}>
                  <select
                    value={incomingForm.status}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, status: e.target.value, create_callback: e.target.value === 'missed' ? true : f.create_callback }))}
                    style={s.input}
                  >
                    <option value="answered">Odebrany</option>
                    <option value="missed">Nieodebrany</option>
                    <option value="voicemail">Poczta glosowa</option>
                  </select>
                  <input
                    value={incomingForm.task_id}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, task_id: e.target.value.replace(/\D/g, '') }))}
                    placeholder="Nr zlecenia"
                    style={s.input}
                    inputMode="numeric"
                  />
                </div>
                <div style={s.inline2}>
                  <select
                    value={incomingForm.service_type}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, service_type: e.target.value }))}
                    style={s.input}
                  >
                    <option value="">Typ uslugi...</option>
                    <option value="wycinka_pielegnacja">Drzewa</option>
                    <option value="dach">Dach</option>
                    <option value="elewacja_kostka">Elewacja / kostka</option>
                    <option value="ogrod">Ogrod</option>
                    <option value="inne">Inne</option>
                  </select>
                  <input
                    type="datetime-local"
                    value={incomingForm.appointment_at}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, appointment_at: e.target.value }))}
                    style={s.input}
                  />
                </div>
                <div style={s.inline2}>
                  <input
                    value={incomingForm.inspection_address}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, inspection_address: e.target.value }))}
                    placeholder="Adres ogledzin"
                    style={s.input}
                  />
                  <input
                    value={incomingForm.city}
                    onChange={(e) => setIncomingForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Miasto"
                    style={s.input}
                  />
                </div>
                <textarea
                  value={incomingForm.notes}
                  onChange={(e) => setIncomingForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Co klient powiedzial / czego potrzebuje..."
                  rows={2}
                  style={s.textarea}
                />
                <div style={s.inlineActions}>
                  <label style={s.checkboxWrap}>
                    <input
                      type="checkbox"
                      checked={incomingForm.create_lead}
                      onChange={(e) => setIncomingForm((f) => ({ ...f, create_lead: e.target.checked }))}
                    />
                    Utworz leada CRM
                  </label>
                  <label style={s.checkboxWrap}>
                    <input
                      type="checkbox"
                      checked={incomingForm.create_callback}
                      onChange={(e) => setIncomingForm((f) => ({ ...f, create_callback: e.target.checked }))}
                    />
                    Dodaj oddzwonienie
                  </label>
                  <button type="submit" style={s.sendBtn} disabled={savingCall}>
                    {savingCall ? 'Zapis...' : 'Zapisz przychodzace'}
                  </button>
                </div>
              </form>

              <form style={s.callForm} onSubmit={saveCallLog}>
                <div style={s.manualTitle}>Zarejestruj połączenie</div>
                <select
                  value={callForm.oddzial_id}
                  onChange={(e) => setCallForm((f) => ({ ...f, oddzial_id: e.target.value }))}
                  style={s.input}
                  required
                >
                  <option value="">Oddział…</option>
                  {oddzialy.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nazwa || `Oddział #${o.id}`}
                    </option>
                  ))}
                </select>
                <input
                  value={callForm.phone}
                  onChange={(e) => setCallForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Numer (+48 …)"
                  style={s.input}
                />
                <div style={s.inline2}>
                  <select
                    value={callForm.call_type}
                    onChange={(e) => setCallForm((f) => ({ ...f, call_type: e.target.value }))}
                    style={s.input}
                  >
                    <option value="outbound">Wychodzące</option>
                    <option value="inbound">Przychodzące</option>
                  </select>
                  <select
                    value={callForm.status}
                    onChange={(e) => setCallForm((f) => ({ ...f, status: e.target.value }))}
                    style={s.input}
                  >
                    <option value="answered">Odebrane</option>
                    <option value="missed">Nieodebrane</option>
                    <option value="busy">Zajęte</option>
                    <option value="voicemail">Poczta głosowa</option>
                  </select>
                </div>
                <input
                  value={callForm.duration_sec}
                  onChange={(e) => setCallForm((f) => ({ ...f, duration_sec: e.target.value }))}
                  placeholder="Czas trwania (sekundy, opcjonalnie)"
                  style={s.input}
                  inputMode="numeric"
                />
                <input
                  value={callForm.task_id}
                  onChange={(e) => setCallForm((f) => ({ ...f, task_id: e.target.value.replace(/\D/g, '') }))}
                  placeholder="Nr zlecenia (opcjonalnie)"
                  style={s.input}
                  inputMode="numeric"
                />
                <input
                  value={callForm.lead_name}
                  onChange={(e) => setCallForm((f) => ({ ...f, lead_name: e.target.value }))}
                  placeholder="Nazwa kontaktu (opcjonalnie)"
                  style={s.input}
                />
                <textarea
                  value={callForm.notes}
                  onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Notatka z rozmowy…"
                  rows={2}
                  style={s.textarea}
                />
                <div style={s.inlineActions}>
                  <button type="submit" style={s.sendBtn} disabled={savingCall}>
                    {savingCall ? 'Zapis…' : 'Zapisz w logu'}
                  </button>
                  <button
                    type="button"
                    style={s.rowBtnActive}
                    disabled={savingCall || startingCallKey === 'manual-call'}
                    onClick={() => startSpecialistCall({
                      phone: callForm.phone,
                      oddzial_id: callForm.oddzial_id,
                      lead_name: callForm.lead_name,
                      task_id: callForm.task_id,
                      notes: callForm.notes || 'Specjalista oddzwania do klienta.',
                      key: 'manual-call',
                    })}
                  >
                    {startingCallKey === 'manual-call' ? 'Zapisuje...' : 'Zadzwon i zapisz'}
                  </button>
                  {telHref(callForm.phone) ? (
                    <a href={telHref(callForm.phone)} style={s.telLink}>
                      Zadzwoń
                    </a>
                  ) : null}
                </div>
              </form>

              <form style={s.callForm} onSubmit={saveCallback}>
                <div style={s.manualTitle}>Dodaj oddzwonienie</div>
                <select
                  value={cbForm.oddzial_id}
                  onChange={(e) => setCbForm((f) => ({ ...f, oddzial_id: e.target.value }))}
                  style={s.input}
                  required
                >
                  <option value="">Oddział…</option>
                  {oddzialy.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nazwa || `Oddział #${o.id}`}
                    </option>
                  ))}
                </select>
                <input
                  value={cbForm.phone}
                  onChange={(e) => setCbForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Numer do oddzwonienia"
                  style={s.input}
                />
                <input
                  value={cbForm.lead_name}
                  onChange={(e) => setCbForm((f) => ({ ...f, lead_name: e.target.value }))}
                  placeholder="Kontakt / firma"
                  style={s.input}
                />
                <input
                  value={cbForm.task_id}
                  onChange={(e) => setCbForm((f) => ({ ...f, task_id: e.target.value.replace(/\D/g, '') }))}
                  placeholder="Nr zlecenia (opcjonalnie)"
                  style={s.input}
                  inputMode="numeric"
                />
                <div style={s.inline2}>
                  <select
                    value={cbForm.priority}
                    onChange={(e) => setCbForm((f) => ({ ...f, priority: e.target.value }))}
                    style={s.input}
                  >
                    <option value="low">Priorytet: niski</option>
                    <option value="normal">Priorytet: normalny</option>
                    <option value="high">Priorytet: wysoki</option>
                  </select>
                  <input
                    type="date"
                    value={cbForm.due_at}
                    onChange={(e) => setCbForm((f) => ({ ...f, due_at: e.target.value }))}
                    style={s.input}
                  />
                </div>
                <textarea
                  value={cbForm.notes}
                  onChange={(e) => setCbForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Dlaczego oddzwonić…"
                  rows={2}
                  style={s.textarea}
                />
                <div style={s.inlineActions}>
                  <button type="submit" style={s.sendBtn} disabled={savingCb}>
                    {savingCb ? 'Dodawanie…' : 'Dodaj do kolejki'}
                  </button>
                  {telHref(cbForm.phone) ? (
                    <a href={telHref(cbForm.phone)} style={s.telLink}>
                      Zadzwoń
                    </a>
                  ) : null}
                </div>
              </form>
            </div>

            <div className="modern-data-panel-title">Kolejka oddzwonien (otwarte)</div>
            {openCallbacks.length === 0 ? (
              <div className="modern-data-empty">Brak otwartych zadan.</div>
            ) : (
              <div className="modern-data-stack" style={{ marginBottom: 16 }}>
                {openCallbacks.map((x) => (
                  <ModernDataRow
                    key={x.id}
                    idLabel="Callback ID"
                    idValue={`CB-${x.id}`}
                    title={x.lead_name || x.phone || 'Kontakt bez nazwy'}
                    subtitle={oddzialLabel(x.oddzial_id)}
                    tone={x.priority === 'high' ? 'warning' : 'info'}
                    status={x.priority || 'normal'}
                    statusValue={x.priority || 'normal'}
                    statusState={x.priority === 'high' ? 'warning' : 'info'}
                    metrics={[
                      { label: 'Telefon', value: x.phone },
                      { label: 'Termin', value: x.due_at ? new Date(x.due_at).toLocaleDateString('pl-PL') : 'brak' },
                      { label: 'Zlecenie', value: x.task_id ? `#${x.task_id}` : 'brak', tone: x.task_id ? 'info' : undefined },
                    ]}
                    actions={
                      <>
                        {telHref(x.phone) ? (
                          <button
                            type="button"
                            style={s.rowBtnActive}
                            disabled={startingCallKey === `cb-${x.id}`}
                            onClick={() => startSpecialistCall({
                              phone: x.phone,
                              oddzial_id: x.oddzial_id,
                              lead_name: x.lead_name,
                              task_id: x.task_id,
                              notes: x.notes || 'Oddzwonienie z kolejki Telefonia.',
                              callbackId: x.id,
                              key: `cb-${x.id}`,
                            })}
                          >
                            {startingCallKey === `cb-${x.id}` ? 'Start...' : 'Zadzwon i zapisz'}
                          </button>
                        ) : null}
                        {x.task_id ? (
                          <button type="button" style={s.rowBtn} onClick={() => navigate(`/zlecenia/${x.task_id}`)}>
                            #{x.task_id}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={s.rowBtn}
                          disabled={updatingCbId === x.id}
                          onClick={() => patchCallback(x.id, 'done')}
                        >
                          Gotowe
                        </button>
                        <button
                          type="button"
                          style={s.rowBtn}
                          disabled={updatingCbId === x.id}
                          onClick={() => patchCallback(x.id, 'cancelled')}
                        >
                          Anuluj
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}

            <div className="modern-data-panel-title">Ostatnie polaczenia (log)</div>
            {callRows.length === 0 ? (
              <div className="modern-data-empty">Brak wpisow - zarejestruj pierwsze polaczenie powyzej.</div>
            ) : (
              <div className="modern-data-stack">
                {callRows.slice(0, 80).map((x) => (
                  <ModernDataRow
                    key={x.id}
                    idLabel="Call ID"
                    idValue={`CALL-${x.id}`}
                    title={x.phone || 'Numer nieznany'}
                    subtitle={oddzialLabel(x.oddzial_id)}
                    tone={String(x.status || '').toLowerCase().includes('miss') ? 'warning' : 'info'}
                    status={x.status || 'log'}
                    statusValue={x.status || 'log'}
                    statusState={String(x.status || '').toLowerCase().includes('miss') ? 'warning' : 'info'}
                    metrics={[
                      { label: 'Data', value: x.created_at ? new Date(x.created_at).toLocaleString('pl-PL') : 'brak' },
                      { label: 'Typ', value: x.call_type || 'brak' },
                      { label: 'Czas', value: x.duration_sec != null ? `${x.duration_sec}s` : 'brak', tone: x.duration_sec ? 'success' : undefined },
                      { label: 'Kontakt', value: x.lead_name || 'brak', mono: false },
                      { label: 'Zlecenie', value: x.task_id ? `#${x.task_id}` : 'brak', tone: x.task_id ? 'info' : undefined },
                      { label: 'Notatka', value: x.notes || 'brak', mono: false },
                    ]}
                    actions={
                      <>
                        {telHref(x.phone) ? (
                          <a href={telHref(x.phone)} style={s.rowBtn}>
                            Tel
                          </a>
                        ) : null}
                        {x.task_id ? (
                          <button type="button" style={s.rowBtn} onClick={() => navigate(`/zlecenia/${x.task_id}`)}>
                            #{x.task_id}
                          </button>
                        ) : null}
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'sms' && (
        <div style={{ ...s.panel, ...(isNarrow ? s.panelNarrow : null) }}>
          <form className="telefonia-manual-box" style={s.manualBox} onSubmit={sendManualSms}>
            <div style={s.manualTitle}>Szybki SMS (reczny)</div>
            <div style={s.manualGrid}>
              <input
                value={manualForm.recipient_name}
                onChange={(e) => setManualForm((f) => ({ ...f, recipient_name: e.target.value }))}
                placeholder="Nazwa klienta (opcjonalnie)"
                style={s.input}
              />
              <input
                value={manualForm.recipient_phone}
                onChange={(e) => setManualForm((f) => ({ ...f, recipient_phone: e.target.value }))}
                placeholder="Telefon, np. +48 500 100 200"
                style={s.input}
              />
            </div>
            <textarea
              value={manualForm.text}
              onChange={(e) =>
                setManualForm((f) => ({
                  ...f,
                  text: e.target.value.slice(0, SMS_LIMIT),
                }))
              }
              placeholder="Tresc SMS..."
              rows={3}
              style={s.textarea}
            />
            <div style={s.templateRow}>
              {SMS_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  style={s.templateBtn}
                  onClick={() => applyTemplate(t.text)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div style={s.smsMeta}>
              <span>
                Znaki: {smsChars}/{SMS_LIMIT}
              </span>
              <span>Kodowanie: {smsEncoding}</span>
              <span>Segmenty SMS: {smsSegments}</span>
              <span>Szac. koszt: ~{smsEstimatedCost} PLN</span>
            </div>
            <button type="submit" style={s.sendBtn} disabled={manualSending}>
              {manualSending ? 'Wysylanie...' : 'Wyslij SMS'}
            </button>
          </form>

          <div className="telefonia-kpis" style={s.kpis}>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Wpisy</div>
              <div style={s.kpiValue}>{stats.total}</div>
              {serverPaging && smsTotalAll > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>z {smsTotalAll} w bazie</div>
              ) : null}
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Wyslane</div>
              <div style={{ ...s.kpiValue, color: '#10b981' }}>{stats.sent}</div>
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Dostarczone</div>
              <div style={{ ...s.kpiValue, color: '#22c55e' }}>{stats.delivered}</div>
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Bledy dostawy</div>
              <div style={{ ...s.kpiValue, color: '#f87171' }}>{stats.failed}</div>
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Brak numeru</div>
              <div style={{ ...s.kpiValue, color: '#f87171' }}>{stats.missing}</div>
            </div>
          </div>

          <div className="telefonia-filters" style={s.filters}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj: klient, telefon, typ, status, #zlecenia..."
              style={s.search}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={s.select}>
              <option value="all">Wszystkie statusy</option>
              {statusOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <select value={smsBranchFilter} onChange={(e) => setSmsBranchFilter(e.target.value)} style={s.select} aria-label="Filtr oddzialu SMS">
              <option value="">Wszystkie oddzialy</option>
              {oddzialy.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nazwa || `Oddzial #${o.id}`}
                </option>
              ))}
            </select>
            <select value={updatedByFilter} onChange={(e) => setUpdatedByFilter(e.target.value)} style={s.select}>
              <option value="all">Wszyscy (ostatnia zmiana)</option>
              {updatedByOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.date} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.date} />
            <label style={s.checkboxWrap}>
              <input
                type="checkbox"
                checked={onlyUpdatedToday}
                onChange={(e) => setOnlyUpdatedToday(e.target.checked)}
              />
              Tylko zmienione dzis
            </label>
          </div>

          {serverPaging && smsTotalAll > 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Stronicowanie po stronie serwera ({smsTotalAll} wpisów). Szukanie, status i zakres dat są wysyłane do API;
              filtry „ostatnia zmiana” / „dzisiaj” stosują się tylko do załadowanej strony.
            </p>
          ) : null}

          {loading ? (
            <div className="modern-data-empty">Ladowanie historii SMS...</div>
          ) : filtered.length === 0 ? (
            <div className="modern-data-empty">Brak wpisow w historii SMS.</div>
          ) : (
            <>
              <div className="modern-data-stack">
                {paged.map((x) => (
                  <ModernDataRow
                    key={x.id}
                    idLabel="SMS ID"
                    idValue={`SMS-${x.id}`}
                    title={x.recipient_name || x.recipient_phone || 'Odbiorca bez nazwy'}
                    subtitle={x.recipient_phone || 'brak telefonu'}
                    tone={smsStatusTone(x.status)}
                    status={x.status || 'brak'}
                    statusValue={x.status || 'brak'}
                    statusState={smsStatusTone(x.status)}
                    metrics={[
                      { label: 'Data', value: x.created_at ? new Date(x.created_at).toLocaleString('pl-PL') : 'brak' },
                      { label: 'Zlecenie', value: x.task_id ? `#${x.task_id}` : 'brak', tone: x.task_id ? 'info' : undefined },
                      { label: 'Typ', value: x.typ || 'manual' },
                      { label: 'Provider', value: x.provider || 'brak' },
                      { label: 'Provider status', value: x.provider_status || 'brak', tone: x.error ? 'danger' : undefined },
                      { label: 'Owner', value: x.owner_label || x.owner_role || 'Kierownik/Dyspozytor', mono: false, tone: smsNeedsOwnerAck(x) ? 'danger' : undefined },
                      { label: 'Eskalacja', value: x.escalation || 'monitoruj', mono: false, tone: smsNeedsOwnerAck(x) ? 'danger' : undefined },
                      { label: 'Wyslal', value: x.created_by_name || 'system', mono: false },
                      { label: 'Ost. zmiana', value: x.updated_at ? new Date(x.updated_at).toLocaleString('pl-PL') : 'brak' },
                      { label: 'Dostawa', value: x.delivery_updated_at ? new Date(x.delivery_updated_at).toLocaleString('pl-PL') : x.sid || 'brak', mono: false, tone: x.error ? 'danger' : undefined },
                    ]}
                    actions={
                      <>
                        {telHref(x.recipient_phone) ? (
                          <a href={telHref(x.recipient_phone)} style={s.rowBtn}>
                            Zadzwon
                          </a>
                        ) : null}
                        {x.task_id ? (
                          <button type="button" style={s.rowBtn} onClick={() => navigate(`/zlecenia/${x.task_id}`)}>
                            Otworz
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={s.rowBtn}
                          disabled={!x.task_id || sendingId === x.id}
                          onClick={() => resendSms(x)}
                        >
                          {sendingId === x.id ? 'Wysylanie...' : 'Ponow SMS'}
                        </button>
                        {smsNeedsOwnerAck(x) ? (
                          <button
                            type="button"
                            style={s.rowBtn}
                            disabled={acknowledgingSmsId === x.id}
                            onClick={() => acknowledgeSmsRisk(x)}
                          >
                            {acknowledgingSmsId === x.id ? 'Zapisuje...' : 'Potwierdz'}
                          </button>
                        ) : null}
                        {x._fromOsApi ? (
                          <span style={s.twilioLock} title="ARBOR-OS: status dostawy ustawia provider webhook">
                            {x.provider || 'Webhook'}
                          </span>
                        ) : (
                          <select
                            value={x.status || ''}
                            onChange={(e) => updateSmsStatus(x.id, e.target.value)}
                            style={s.rowSelect}
                            disabled={updatingStatusId === x.id}
                          >
                            {STATUS_CHOICES.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        )}
                        {x.error ? <span style={s.errorChip}>{String(x.error)}</span> : null}
                      </>
                    }
                  />
                ))}
              </div>
              <div style={s.pagination}>
                <button
                  type="button"
                  style={s.pageBtn}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Poprzednia
                </button>
                <span style={s.pageInfo}>
                  Strona {page} z {totalPages}
                </span>
                <button
                  type="button"
                  style={s.pageBtn}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Nastepna
                </button>
              </div>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

const s = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f6faf7 0%, #ffffff 46%, #eaf4ee 100%)',
    color: 'var(--text)',
    width: '100%',
    overflowX: 'hidden',
  },
  content: {
    flex: 1,
    minWidth: 0,
    padding: '22px clamp(16px, 2.4vw, 30px) 32px',
    overflowX: 'hidden',
    maxWidth: 1560,
    width: '100%',
    margin: '0 auto',
  },
  contentNarrow: {
    width: '100%',
    padding: '12px 10px 18px',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)',
    padding: 14,
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  panelNarrow: {
    padding: 10,
  },
  manualBox: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: 900,
    color: '#12251a',
    marginBottom: 8,
  },
  manualGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text)',
  },
  textarea: {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text)',
    resize: 'vertical',
    marginBottom: 8,
  },
  templateRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  templateBtn: {
    padding: '5px 8px',
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
  },
  sendBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
  },
  smsMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    fontSize: 12,
    color: 'var(--text-muted)',
    marginBottom: 8,
  },
  kpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  kpiCard: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    padding: '10px 12px',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  kpiLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 20,
    lineHeight: 1.1,
    color: 'var(--text)',
    fontWeight: 800,
  },
  search: {
    width: '100%',
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
    outline: 'none',
  },
  filters: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
    alignItems: 'center',
  },
  select: {
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
  },
  date: {
    minWidth: 0,
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
  },
  refreshBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
    cursor: 'pointer',
    maxWidth: '100%',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 860,
  },
  th: {
    textAlign: 'left',
    fontSize: 12,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    padding: '10px 8px',
    fontWeight: 700,
  },
  td: {
    fontSize: 13,
    color: 'var(--text-sub)',
    borderBottom: '1px solid var(--border)',
    padding: '10px 8px',
  },
  empty: {
    padding: '24px 8px',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  badge: {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 999,
    padding: '4px 10px',
    display: 'inline-block',
  },
  actions: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  rowBtn: {
    padding: '5px 8px',
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    maxWidth: '100%',
  },
  rowBtnActive: {
    padding: '5px 8px',
    border: '1px solid var(--accent)',
    background: 'rgba(34,197,94,0.12)',
    color: 'var(--accent)',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    fontWeight: 700,
  },
  dangerBtn: {
    padding: '5px 8px',
    border: '1px solid rgba(239,68,68,0.45)',
    background: 'rgba(239,68,68,0.1)',
    color: 'var(--danger)',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    fontWeight: 700,
  },
  rowSelect: {
    minWidth: 130,
    padding: '5px 7px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    fontSize: 12,
  },
  twilioLock: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 34,
    padding: '5px 9px',
    borderRadius: 8,
    border: '1px solid rgba(20, 131, 79, 0.22)',
    background: 'rgba(20, 131, 79, 0.08)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
  },
  errorChip: {
    display: 'inline-flex',
    maxWidth: 260,
    minHeight: 34,
    alignItems: 'center',
    padding: '5px 9px',
    borderRadius: 8,
    border: '1px solid rgba(255, 61, 113, 0.28)',
    background: 'rgba(255, 61, 113, 0.1)',
    color: 'var(--danger)',
    fontSize: 11,
    fontWeight: 700,
  },
  pagination: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  pageBtn: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 12,
  },
  pageInfo: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  checkboxWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--text-sub)',
    padding: '6px 4px',
  },
  auditDate: {
    fontSize: 12,
    color: 'var(--text-sub)',
    lineHeight: 1.2,
  },
  auditBy: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 14,
    padding: 6,
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  tabRowNarrow: {
    overflowX: 'auto',
    paddingBottom: 4,
    WebkitOverflowScrolling: 'touch',
  },
  tab: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  tabActive: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'rgba(34,197,94,0.12)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  callsIntro: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginBottom: 12,
    lineHeight: 1.45,
  },
  callsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  agentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 12,
    marginBottom: 4,
  },
  callForm: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  inline2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 8,
  },
  inlineActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  copyRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 8,
    alignItems: 'center',
  },
  copyLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginTop: 4,
  },
  agentStatusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    color: 'var(--text-sub)',
    fontSize: 13,
  },
  agentHistoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  agentFilterRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 10,
  },
  agentSearch: {
    flex: '1 1 260px',
    minWidth: 220,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
  },
  agentHistoryMeta: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  agentHealthBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  branchStatusBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  branchStatusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: 8,
  },
  branchStatusSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  branchSearchRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  branchStatusKpi: {
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: 'var(--surface-field)',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    color: 'var(--text-sub)',
    fontSize: 12,
    cursor: 'pointer',
  },
  branchStatusKpiActive: {
    borderColor: 'rgba(15,95,58,0.42)',
    background: 'rgba(34,197,94,0.10)',
    boxShadow: '0 0 0 2px rgba(15,95,58,0.08)',
  },
  branchFilterNotice: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
    color: 'var(--text-sub)',
    fontSize: 12,
    marginBottom: 10,
  },
  branchRolloutBox: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
  },
  branchRolloutTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    color: 'var(--text)',
    fontSize: 13,
  },
  branchRolloutBar: {
    height: 8,
    marginTop: 8,
    borderRadius: 999,
    background: 'rgba(15,95,58,0.10)',
    overflow: 'hidden',
  },
  branchRolloutFill: {
    height: '100%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #0f5f3a, #22c55e)',
  },
  branchRolloutMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 7,
    color: 'var(--text-sub)',
    fontSize: 12,
  },
  branchNavHint: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: 'rgba(15,95,58,0.045)',
    color: 'var(--text-sub)',
    fontSize: 12,
  },
  branchQueueBox: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: 'rgba(15,95,58,0.045)',
  },
  branchQueueHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  branchQueueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 8,
    marginTop: 7,
  },
  branchQueueItem: {
    minWidth: 0,
    textAlign: 'left',
    display: 'grid',
    gap: 3,
    padding: 9,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 12,
  },
  branchStatusCard: {
    minWidth: 0,
    textAlign: 'left',
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
    cursor: 'pointer',
  },
  branchStatusCardActive: {
    borderColor: 'rgba(15,95,58,0.42)',
    boxShadow: '0 0 0 2px rgba(15,95,58,0.08)',
  },
  branchStatusMeta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 4,
    color: 'var(--text-sub)',
    fontSize: 12,
    marginBottom: 8,
  },
  branchMiniBar: {
    height: 6,
    borderRadius: 999,
    background: 'rgba(15,95,58,0.10)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  branchMiniFill: {
    height: '100%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #22c55e, #0f7a4c)',
  },
  branchBlockers: {
    marginTop: 7,
    padding: 7,
    borderRadius: 8,
    background: 'rgba(245,158,11,0.10)',
    color: '#92400e',
    fontSize: 11,
    lineHeight: 1.35,
  },
  branchNextAction: {
    marginTop: 7,
    padding: 7,
    borderRadius: 8,
    background: 'rgba(15,95,58,0.08)',
    color: '#0f5f3a',
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 800,
  },
  branchStageBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px 7px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  branchStageOk: {
    background: 'rgba(34,197,94,0.13)',
    color: '#0f7a4c',
  },
  branchStageWarn: {
    background: 'rgba(245,158,11,0.14)',
    color: '#92400e',
  },
  branchStageBad: {
    background: 'rgba(239,68,68,0.12)',
    color: '#b91c1c',
  },
  branchSelectedBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: 'rgba(15,95,58,0.045)',
  },
  branchSelectedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  agentHealthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 8,
  },
  agentHealthItem: {
    minWidth: 0,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
  },
  agentHealthTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: 6,
  },
  agentHealthDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  agentHealthValue: {
    display: 'block',
    color: 'var(--text)',
    fontSize: 16,
    lineHeight: 1.25,
    marginBottom: 4,
    overflowWrap: 'anywhere',
  },
  integrationLogBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: 'var(--surface-field)',
  },
  integrationLogList: {
    display: 'grid',
    gap: 8,
  },
  integrationLogItem: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'start',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-glass)',
  },
  branchQuickStartBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: 'rgba(15,95,58,0.045)',
  },
  branchQuickStartSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
    gap: 8,
  },
  branchQuickStartStep: {
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 8,
    alignItems: 'start',
    padding: 9,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.10)',
    background: '#ffffff',
  },
  providerChecklistBox: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
  },
  providerChecklistHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
    color: 'var(--text)',
    fontSize: 13,
  },
  providerReadinessBar: {
    height: 7,
    borderRadius: 999,
    background: 'rgba(15,95,58,0.10)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  providerReadinessFill: {
    height: '100%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #22c55e, #0f7a4c)',
    transition: 'width 180ms ease',
  },
  providerBlockers: {
    marginBottom: 8,
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(245,158,11,0.32)',
    background: 'rgba(245,158,11,0.10)',
    color: '#92400e',
    fontSize: 12,
    lineHeight: 1.4,
  },
  providerReadyNote: {
    marginBottom: 8,
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(34,197,94,0.30)',
    background: 'rgba(34,197,94,0.10)',
    color: '#166534',
    fontSize: 12,
    lineHeight: 1.4,
  },
  providerChecklistList: {
    display: 'grid',
    gap: 7,
  },
  providerChecklistItem: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: 8,
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.10)',
    background: 'var(--surface-field)',
  },
  providerGuideBox: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: 'var(--surface-field)',
  },
  providerGuideList: {
    margin: '0 0 0 18px',
    padding: 0,
    color: 'var(--text-sub)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  agentReminderBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
  },
  agentReminderSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(15,107,63,0.045)',
    color: 'var(--text-sub)',
    fontSize: 13,
    marginBottom: 8,
  },
  agentReminderList: {
    display: 'grid',
    gap: 8,
  },
  agentReminderItem: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.13)',
    background: '#ffffff',
  },
  agentReminderText: {
    color: 'var(--text-sub)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  branchSmsTestBox: {
    marginTop: 4,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  agentLinks: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  okBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 999,
    background: 'rgba(34,197,94,0.12)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 800,
  },
  reviewBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 999,
    background: 'rgba(245,158,11,0.14)',
    color: '#b45309',
    fontSize: 12,
    fontWeight: 800,
  },
  neutralBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 999,
    background: 'var(--surface-glass)',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  issueList: {
    marginTop: 4,
    maxWidth: 180,
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.3,
  },
  agentDetailBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
  },
  agentDetailTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  agentDetailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 10,
  },
  agentDetailText: {
    minHeight: 54,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    fontSize: 13,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
  },
  agentFixForm: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  agentFixGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  agentSmsBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  agentSmsPreview: {
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    fontSize: 13,
    lineHeight: 1.45,
    marginBottom: 8,
  },
  telLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--accent)',
    fontWeight: 700,
    textDecoration: 'none',
    fontSize: 13,
  },
  telLinkSmall: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 8,
    marginTop: 4,
  },
  emptyMuted: {
    padding: '12px 4px',
    color: 'var(--text-muted)',
    fontSize: 13,
    marginBottom: 12,
  },
};
