import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { telHref, normalizePhone } from '../utils/telLink';

export default function Telefonia() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sms, setSms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [updatedByFilter, setUpdatedByFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyUpdatedToday, setOnlyUpdatedToday] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [manualSending, setManualSending] = useState(false);
  const [page, setPage] = useState(1);
  const [manualForm, setManualForm] = useState({
    recipient_name: '',
    recipient_phone: '',
    text: '',
  });

  const [tab, setTab] = useState('sms');
  const [oddzialy, setOddzialy] = useState([]);
  const [callRows, setCallRows] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [telLoading, setTelLoading] = useState(false);
  const [telError, setTelError] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [savingCb, setSavingCb] = useState(false);
  const [updatingCbId, setUpdatingCbId] = useState(null);
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

  const SMS_LIMIT = 480;
  const PAGE_SIZE = 15;
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

  useEffect(() => {
    const user = getLocalStorageJson('user');
    if (!user || !getStoredToken()) {
      navigate('/');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const token = getStoredToken();
      const res = await api.get('/sms/historia', { headers: authHeaders(token) });
      setSms(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udało się pobrać historii SMS.'));
    } finally {
      setLoading(false);
    }
  };

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
    if (tab === 'calls') loadTelephonyExtras();
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
    try {
      const token = getStoredToken();
      const taskId = toIntLocal(callForm.task_id);
      await api.post(
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
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udało się zapisać połączenia.'));
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
    try {
      const token = getStoredToken();
      const cbTaskId = toIntLocal(cbForm.task_id);
      await api.post(
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
    } catch (e2) {
      setTelError(getApiErrorMessage(e2, 'Nie udało się dodać zadania oddzwonienia.'));
    } finally {
      setSavingCb(false);
    }
  };

  const patchCallback = async (id, status) => {
    setUpdatingCbId(id);
    setTelError('');
    try {
      const token = getStoredToken();
      await api.patch(`/telephony/callbacks/${id}/status`, { status }, { headers: authHeaders(token) });
      await loadTelephonyExtras();
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
    const q = query.trim().toLowerCase();
    return sms.filter((x) => {
      const date = x.created_at ? new Date(x.created_at) : null;
      const dateOkFrom =
        !dateFrom ||
        (date && date >= new Date(`${dateFrom}T00:00:00`));
      const dateOkTo =
        !dateTo ||
        (date && date <= new Date(`${dateTo}T23:59:59`));
      const statusOk = statusFilter === 'all' || x.status === statusFilter;
      const updatedByOk = updatedByFilter === 'all' || x.updated_by_name === updatedByFilter;
      const todayOk = !onlyUpdatedToday || (
        x.updated_at &&
        new Date(x.updated_at).toDateString() === new Date().toDateString()
      );
      const qOk =
        !q ||
        [x.recipient_name, x.recipient_phone, x.typ, x.status, x.created_by_name, String(x.task_id || '')]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      return dateOkFrom && dateOkTo && statusOk && updatedByOk && todayOk && qOk;
    });
  }, [query, sms, statusFilter, updatedByFilter, dateFrom, dateTo, onlyUpdatedToday]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, updatedByFilter, dateFrom, dateTo, onlyUpdatedToday]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const exportCsv = () => {
    const rows = [
      ['data', 'zlecenie_id', 'klient', 'telefon', 'typ', 'status', 'wyslal'],
      ...filtered.map((x) => [
        x.created_at ? new Date(x.created_at).toISOString() : '',
        x.task_id || '',
        x.recipient_name || '',
        x.recipient_phone || '',
        x.typ || '',
        x.status || '',
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

  const resendSms = async (row) => {
    if (!row?.task_id) return;
    setSendingId(row.id);
    setError('');
    try {
      const token = getStoredToken();
      await api.post(`/sms/zlecenie/${row.task_id}`, { typ: row.typ || 'manual' }, { headers: authHeaders(token) });
      await load();
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
      await load();
    } catch (e2) {
      setError(getApiErrorMessage(e2, 'Nie udalo sie wyslac SMS.'));
    } finally {
      setManualSending(false);
    }
  };

  const stats = useMemo(() => {
    let sent = 0;
    let missing = 0;
    for (const x of filtered) {
      if (x.status === 'wyslano_demo') sent += 1;
      else if (x.status === 'brak_numeru') missing += 1;
    }
    return {
      total: filtered.length,
      sent,
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

  const statusBadgeStyle = (status) => {
    if (status === 'wyslano_demo') return { bg: 'rgba(16,185,129,0.18)', fg: '#10b981' };
    if (status === 'brak_numeru') return { bg: 'rgba(248,113,113,0.18)', fg: '#f87171' };
    if (status === 'dostarczono') return { bg: 'rgba(34,197,94,0.18)', fg: '#22c55e' };
    if (status === 'blad') return { bg: 'rgba(239,68,68,0.2)', fg: '#ef4444' };
    if (status === 'w_kolejce') return { bg: 'rgba(250,204,21,0.18)', fg: '#f59e0b' };
    return { bg: 'rgba(148,163,184,0.18)', fg: 'var(--text-sub)' };
  };

  const STATUS_CHOICES = ['wyslano_demo', 'w_kolejce', 'dostarczono', 'blad', 'brak_numeru', 'anulowano'];

  const updateSmsStatus = async (id, status) => {
    setUpdatingStatusId(id);
    setError('');
    try {
      const token = getStoredToken();
      await api.patch(`/sms/historia/${id}/status`, { status }, { headers: authHeaders(token) });
      await load();
    } catch (e) {
      setError(getApiErrorMessage(e, 'Nie udalo sie zaktualizowac statusu SMS.'));
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div style={s.root}>
      <Sidebar />
      <div style={s.content}>
        <PageHeader
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.18 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9a16 16 0 0 0 6.9 6.9l1.36-1.35a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          }
          title="Telefonia"
          subtitle={
            tab === 'sms'
              ? `Historia SMS: ${filtered.length}`
              : `Log połączeń: ${callRows.length} · kolejka oddzwonień: ${callbacks.filter((x) => x.status === 'open').length}`
          }
          actions={
            <>
              {tab === 'sms' && (
                <button type="button" style={s.refreshBtn} onClick={exportCsv}>
                  Eksport CSV
                </button>
              )}
              <button type="button" style={s.refreshBtn} onClick={() => (tab === 'sms' ? load() : loadTelephonyExtras())}>
                Odswiez
              </button>
            </>
          }
        />

        <div style={s.tabRow}>
          <button type="button" style={tab === 'sms' ? s.tabActive : s.tab} onClick={() => setTab('sms')}>
            SMS
          </button>
          <button type="button" style={tab === 'calls' ? s.tabActive : s.tab} onClick={() => setTab('calls')}>
            Połączenia i oddzwonienia
          </button>
        </div>

        {!!error && tab === 'sms' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={error} type="error" />
          </div>
        )}
        {!!telError && tab === 'calls' && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={telError} type="error" />
          </div>
        )}

        {tab === 'calls' && (
          <div style={s.panel}>
            <div style={s.callsIntro}>
              Kliknięcie „Zadzwoń” otwiera aplikację telefonu (<code>tel:</code>) — działa na komputerze z softphone lub na telefonie. Zapis połączenia i kolejka oddzwonień są w bazie aplikacji (integracja VoIP możliwa później).
            </div>
            {telLoading && <div style={s.empty}>Ładowanie…</div>}
            <div style={s.callsGrid}>
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

            <div style={s.sectionTitle}>Kolejka oddzwonień (otwarte)</div>
            {callbacks.filter((x) => x.status === 'open').length === 0 ? (
              <div style={s.emptyMuted}>Brak otwartych zadań.</div>
            ) : (
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Oddział</th>
                      <th style={s.th}>Telefon</th>
                      <th style={s.th}>Zlecenie</th>
                      <th style={s.th}>Kontakt</th>
                      <th style={s.th}>Termin</th>
                      <th style={s.th}>Priorytet</th>
                      <th style={s.th}>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callbacks
                      .filter((x) => x.status === 'open')
                      .map((x) => (
                        <tr key={x.id}>
                          <td style={s.td}>{oddzialLabel(x.oddzial_id)}</td>
                          <td style={s.td}>
                            {x.phone}
                            {telHref(x.phone) ? (
                              <>
                                {' '}
                                <a href={telHref(x.phone)} style={s.telLinkSmall}>
                                  Zadzwoń
                                </a>
                              </>
                            ) : null}
                          </td>
                          <td style={s.td}>
                            {x.task_id ? (
                              <button type="button" style={s.rowBtn} onClick={() => navigate(`/zlecenia/${x.task_id}`)}>
                                #{x.task_id}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={s.td}>{x.lead_name || '—'}</td>
                          <td style={s.td}>
                            {x.due_at ? new Date(x.due_at).toLocaleDateString('pl-PL') : '—'}
                          </td>
                          <td style={s.td}>{x.priority || 'normal'}</td>
                          <td style={s.td}>
                            <div style={s.actions}>
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
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={s.sectionTitle}>Ostatnie połączenia (log)</div>
            {callRows.length === 0 ? (
              <div style={s.emptyMuted}>Brak wpisów — zarejestruj pierwsze połączenie powyżej.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Data</th>
                      <th style={s.th}>Oddział</th>
                      <th style={s.th}>Numer</th>
                      <th style={s.th}>Zlecenie</th>
                      <th style={s.th}>Typ</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Czas (s)</th>
                      <th style={s.th}>Kontakt</th>
                      <th style={s.th}>Notatka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callRows.slice(0, 80).map((x) => (
                      <tr key={x.id}>
                        <td style={s.td}>{x.created_at ? new Date(x.created_at).toLocaleString('pl-PL') : '—'}</td>
                        <td style={s.td}>{oddzialLabel(x.oddzial_id)}</td>
                        <td style={s.td}>
                          {x.phone}
                          {telHref(x.phone) ? (
                            <>
                              {' '}
                              <a href={telHref(x.phone)} style={s.telLinkSmall}>
                                tel
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td style={s.td}>
                          {x.task_id ? (
                            <button type="button" style={s.rowBtn} onClick={() => navigate(`/zlecenia/${x.task_id}`)}>
                              #{x.task_id}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={s.td}>{x.call_type || '—'}</td>
                        <td style={s.td}>{x.status || '—'}</td>
                        <td style={s.td}>{x.duration_sec != null ? x.duration_sec : '—'}</td>
                        <td style={s.td}>{x.lead_name || '—'}</td>
                        <td style={s.td}>{x.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'sms' && (
        <div style={s.panel}>
          <form style={s.manualBox} onSubmit={sendManualSms}>
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

          <div style={s.kpis}>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Wpisy</div>
              <div style={s.kpiValue}>{stats.total}</div>
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Wyslane</div>
              <div style={{ ...s.kpiValue, color: '#10b981' }}>{stats.sent}</div>
            </div>
            <div style={s.kpiCard}>
              <div style={s.kpiLabel}>Brak numeru</div>
              <div style={{ ...s.kpiValue, color: '#f87171' }}>{stats.missing}</div>
            </div>
          </div>

          <div style={s.filters}>
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

          {loading ? (
            <div style={s.empty}>Ladowanie historii SMS...</div>
          ) : filtered.length === 0 ? (
            <div style={s.empty}>Brak wpisow w historii SMS.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Data</th>
                    <th style={s.th}>Zlecenie</th>
                    <th style={s.th}>Klient</th>
                    <th style={s.th}>Telefon</th>
                    <th style={s.th}>Typ</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Status (edycja)</th>
                    <th style={s.th}>Wyslal</th>
                    <th style={s.th}>Ost. zmiana</th>
                    <th style={s.th}>Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((x) => (
                    <tr key={x.id}>
                      <td style={s.td}>{x.created_at ? new Date(x.created_at).toLocaleString('pl-PL') : '-'}</td>
                      <td style={s.td}>#{x.task_id || '-'}</td>
                      <td style={s.td}>{x.recipient_name || '-'}</td>
                      <td style={s.td}>
                        {x.recipient_phone ? (
                          <>
                            {x.recipient_phone}
                            {telHref(x.recipient_phone) ? (
                              <>
                                {' '}
                                <a href={telHref(x.recipient_phone)} style={s.telLinkSmall}>
                                  Zadzwoń
                                </a>
                              </>
                            ) : null}
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td style={s.td}>{x.typ || '-'}</td>
                      <td style={s.td}>
                        <span
                          style={{
                            ...s.badge,
                            background: statusBadgeStyle(x.status).bg,
                            color: statusBadgeStyle(x.status).fg,
                          }}
                        >
                          {x.status || '-'}
                        </span>
                      </td>
                      <td style={s.td}>
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
                      </td>
                      <td style={s.td}>{x.created_by_name || '-'}</td>
                      <td style={s.td}>
                        {x.updated_at ? (
                          <div>
                            <div style={s.auditDate}>
                              {new Date(x.updated_at).toLocaleString('pl-PL')}
                            </div>
                            <div style={s.auditBy}>
                              {x.updated_by_name || '-'}
                            </div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td style={s.td}>
                        <div style={s.actions}>
                          <button
                            type="button"
                            style={s.rowBtn}
                            disabled={!x.task_id}
                            onClick={() => navigate(`/zlecenia/${x.task_id}`)}
                          >
                            Otworz
                          </button>
                          <button
                            type="button"
                            style={s.rowBtn}
                            disabled={!x.task_id || sendingId === x.id}
                            onClick={() => resendSms(x)}
                          >
                            {sendingId === x.id ? 'Wysylanie...' : 'Ponow SMS'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

const s = {
  root: {
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text)',
  },
  content: {
    marginLeft: 252,
    padding: '22px 24px',
  },
  panel: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 14,
  },
  manualBox: {
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
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
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
  },
  textarea: {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
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
    border: '1px solid var(--border2)',
    background: 'var(--bg-card)',
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
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '10px 12px',
  },
  kpiLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    minWidth: 260,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
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
    minWidth: 180,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
  },
  date: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
  },
  refreshBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card)',
    color: 'var(--text)',
    cursor: 'pointer',
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
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
  },
  rowSelect: {
    minWidth: 130,
    padding: '5px 7px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--input-bg)',
    color: 'var(--text-sub)',
    fontSize: 12,
  },
  pagination: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  pageBtn: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
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
  },
  tab: {
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  tabActive: {
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid var(--accent)',
    background: 'rgba(34,197,94,0.12)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
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
  callForm: {
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  inline2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  inlineActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  telLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card)',
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
