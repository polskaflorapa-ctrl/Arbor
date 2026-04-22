import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

export default function Telefonia() {
  const navigate = useNavigate();
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

  const normalizePhone = (value) => String(value || '').replace(/[^\d+]/g, '');
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
          title="Telefonia (SMS)"
          subtitle={`Historia wysylek SMS: ${filtered.length}`}
          actions={
            <>
              <button type="button" style={s.refreshBtn} onClick={exportCsv}>
                Eksport CSV
              </button>
              <button type="button" style={s.refreshBtn} onClick={load}>
                Odswiez
              </button>
            </>
          }
        />

        {!!error && (
          <div style={{ marginBottom: 12 }}>
            <StatusMessage message={error} type="error" />
          </div>
        )}

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
                      <td style={s.td}>{x.recipient_phone || '-'}</td>
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
};
