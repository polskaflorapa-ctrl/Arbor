import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AssignmentTurnedIn from '@mui/icons-material/AssignmentTurnedIn';
import PersonAdd from '@mui/icons-material/PersonAdd';
import Refresh from '@mui/icons-material/Refresh';
import Save from '@mui/icons-material/Save';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function normalizeItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nowe' },
  { value: 'contacted', label: 'W kontakcie' },
  { value: 'qualified', label: 'Zakwalifikowane' },
  { value: 'closed', label: 'Zamknięte' },
];

export default function DemoRequests() {
  const navigate = useNavigate();
  const { message, showMessage } = useTimedMessage();
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/login');
        return;
      }
      const res = await api.get('/demo-requests?limit=100', { headers: authHeaders(token) });
      const nextItems = normalizeItems(res.data);
      setItems(nextItems);
      setDrafts(Object.fromEntries(nextItems.map((item) => [
        item.id,
        { status: item.status || 'new', sales_note: item.sales_note || '' },
      ])));
      setTotal(Number(res.data?.total || 0));
    } catch {
      showMessage(errorMessage('Nie udało się pobrać zgłoszeń demo.'));
    } finally {
      setLoading(false);
    }
  }, [navigate, showMessage]);

  const updateDraft = (id, patch) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), ...patch },
    }));
  };

  const saveLead = async (item) => {
    const token = getStoredToken();
    if (!token) {
      navigate('/login');
      return;
    }
    const draft = drafts[item.id] || {};
    setSavingId(item.id);
    try {
      const res = await api.patch(`/demo-requests/${item.id}`, {
        status: draft.status || 'new',
        sales_note: draft.sales_note || '',
      }, { headers: authHeaders(token) });
      const updated = res.data?.item || { ...item, ...draft };
      setItems((current) => current.map((row) => (row.id === item.id ? updated : row)));
      setDrafts((current) => ({
        ...current,
        [item.id]: { status: updated.status || 'new', sales_note: updated.sales_note || '' },
      }));
      showMessage(successMessage('Zapisano obsługę zgłoszenia demo.'));
    } catch {
      showMessage(errorMessage('Nie udało się zapisać statusu zgłoszenia.'));
    } finally {
      setSavingId(null);
    }
  };

  const convertLead = async (item) => {
    const token = getStoredToken();
    if (!token) {
      navigate('/login');
      return;
    }

    setConvertingId(item.id);
    try {
      const res = await api.post(`/demo-requests/${item.id}/convert-client`, {}, {
        headers: authHeaders(token),
      });
      const updated = res.data?.item || { ...item, client_id: res.data?.client_id };
      setItems((current) => current.map((row) => (row.id === item.id ? updated : row)));
      setDrafts((current) => ({
        ...current,
        [item.id]: { status: updated.status || 'qualified', sales_note: updated.sales_note || '' },
      }));
      showMessage(successMessage(res.data?.alreadyConverted
        ? 'To zgłoszenie jest już połączone z klientem.'
        : 'Utworzono klienta w CRM ze zgłoszenia demo.'));
    } catch {
      showMessage(errorMessage('Nie udało się utworzyć klienta ze zgłoszenia.'));
    } finally {
      setConvertingId(null);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = items.filter((item) => String(item.created_at || '').slice(0, 10) === today).length;
    const withPhone = items.filter((item) => String(item.phone || '').trim()).length;
    const openCount = items.filter((item) => !['closed'].includes(item.status || 'new')).length;
    const convertedCount = items.filter((item) => item.client_id).length;
    return [
      { label: 'Wszystkie', value: total },
      { label: 'Dzisiaj', value: todayCount },
      { label: 'Otwarte', value: openCount },
      { label: 'W CRM', value: convertedCount },
      { label: 'Z telefonem', value: withPhone },
    ];
  }, [items, total]);

  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.main}>
        <PageHeader
          title="Zgłoszenia demo"
          subtitle="Leady z publicznego formularza na landing page Arbor OS."
          icon={<AssignmentTurnedIn />}
          actions={(
            <button type="button" style={styles.refreshButton} onClick={loadData}>
              <Refresh style={{ fontSize: 18 }} />
              Odśwież
            </button>
          )}
        />
        <StatusMessage message={message} />

        <section style={styles.statsGrid}>
          {stats.map((stat) => (
            <article style={styles.statCard} key={stat.label}>
              <span style={styles.statLabel}>{stat.label}</span>
              <strong style={styles.statValue}>{stat.value}</strong>
            </article>
          ))}
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <strong>Lista zgłoszeń</strong>
            <span>{loading ? 'Ładowanie...' : `${items.length} widocznych`}</span>
          </div>

          {loading ? (
            <div style={styles.emptyState}>Ładowanie zgłoszeń demo...</div>
          ) : items.length === 0 ? (
            <div style={styles.emptyState}>Nie ma jeszcze zgłoszeń z landing page.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Data</th>
                    <th style={styles.th}>Firma</th>
                    <th style={styles.th}>Kontakt</th>
                    <th style={styles.th}>Telefon</th>
                    <th style={styles.th}>Procesy</th>
                    <th style={styles.th}>Obsługa</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td style={styles.td}>{formatDate(item.created_at)}</td>
                      <td style={styles.td}>
                        <strong style={styles.primaryText}>{item.company}</strong>
                        <span style={styles.mutedLine}>{item.source || 'landing-page'}</span>
                      </td>
                      <td style={styles.td}>
                        <strong style={styles.primaryText}>{item.name}</strong>
                        <a style={styles.link} href={`mailto:${item.email}`}>{item.email}</a>
                      </td>
                      <td style={styles.td}>
                        {item.phone ? <a style={styles.link} href={`tel:${item.phone}`}>{item.phone}</a> : '-'}
                      </td>
                      <td style={{ ...styles.td, ...styles.messageCell }}>{item.message || '-'}</td>
                      <td style={{ ...styles.td, ...styles.salesCell }}>
                        <select
                          style={styles.select}
                          value={drafts[item.id]?.status || item.status || 'new'}
                          onChange={(event) => updateDraft(item.id, { status: event.target.value })}
                          aria-label={`Status zgłoszenia ${item.company}`}
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <textarea
                          style={styles.note}
                          value={drafts[item.id]?.sales_note ?? item.sales_note ?? ''}
                          onChange={(event) => updateDraft(item.id, { sales_note: event.target.value })}
                          placeholder="Notatka po kontakcie..."
                          rows="3"
                          aria-label={`Notatka do zgłoszenia ${item.company}`}
                        />
                        <button
                          type="button"
                          style={styles.saveButton}
                          onClick={() => saveLead(item)}
                          disabled={savingId === item.id}
                        >
                          <Save style={{ fontSize: 16 }} />
                          {savingId === item.id ? 'Zapis...' : 'Zapisz'}
                        </button>
                        {item.client_id ? (
                          <div style={styles.clientBadge}>
                            Klient #{item.client_id}
                            <a style={styles.clientLink} href="#/klienci">Otwórz CRM</a>
                          </div>
                        ) : (
                          <button
                            type="button"
                            style={styles.convertButton}
                            onClick={() => convertLead(item)}
                            disabled={convertingId === item.id}
                          >
                            <PersonAdd style={{ fontSize: 16 }} />
                            {convertingId === item.id ? 'Tworzę...' : 'Utwórz klienta'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    background: 'var(--bg)',
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: '24px clamp(16px, 3vw, 32px) 48px',
  },
  refreshButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 14px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 850,
    cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  statCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 18,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
  },
  statLabel: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 850,
    textTransform: 'uppercase',
  },
  statValue: {
    display: 'block',
    marginTop: 8,
    color: 'var(--text)',
    fontSize: 30,
    lineHeight: 1,
  },
  panel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '16px 18px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
    fontWeight: 850,
  },
  emptyState: {
    padding: 28,
    color: 'var(--text-muted)',
    fontWeight: 750,
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 1080,
  },
  th: {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 900,
    textAlign: 'left',
    textTransform: 'uppercase',
  },
  td: {
    padding: '14px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-sub)',
    fontSize: 14,
    verticalAlign: 'top',
  },
  primaryText: {
    display: 'block',
    color: 'var(--text)',
    fontWeight: 850,
  },
  mutedLine: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  link: {
    display: 'block',
    marginTop: 3,
    color: 'var(--accent)',
    fontWeight: 800,
    textDecoration: 'none',
  },
  messageCell: {
    maxWidth: 340,
    lineHeight: 1.45,
  },
  salesCell: {
    minWidth: 260,
  },
  select: {
    width: '100%',
    minHeight: 36,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 10px',
    background: 'var(--input-bg)',
    color: 'var(--text)',
    fontWeight: 800,
    outline: 'none',
  },
  note: {
    width: '100%',
    minHeight: 74,
    marginTop: 8,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 10,
    background: 'var(--input-bg)',
    color: 'var(--text)',
    font: '700 13px/1.4 var(--font-sans)',
    resize: 'vertical',
    outline: 'none',
  },
  saveButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 34,
    marginTop: 8,
    border: '1px solid var(--border2)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 850,
    cursor: 'pointer',
  },
  convertButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 34,
    marginTop: 8,
    marginLeft: 8,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontWeight: 850,
    cursor: 'pointer',
  },
  clientBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    marginTop: 8,
    marginLeft: 8,
    border: '1px solid color-mix(in srgb, var(--success) 35%, var(--border))',
    borderRadius: 8,
    padding: '0 10px',
    background: 'color-mix(in srgb, var(--success) 10%, var(--bg-card))',
    color: 'var(--text)',
    fontWeight: 850,
  },
  clientLink: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    textDecoration: 'none',
  },
};
