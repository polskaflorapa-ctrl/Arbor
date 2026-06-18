import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AssignmentTurnedIn from '@mui/icons-material/AssignmentTurnedIn';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { Button } from '../components/ui/Button';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { RefreshCw, Save, UserPlus } from 'lucide-react';

const FILTERS = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'needsContact', label: 'Do kontaktu' },
  { key: 'today', label: 'Dzisiaj' },
  { key: 'withPhone', label: 'Z telefonem' },
  { key: 'converted', label: 'W CRM' },
];

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

function isToday(value) {
  if (!value) return false;
  return String(value).slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function needsContact(item) {
  return !item.client_id && ['new', 'contacted'].includes(item.status || 'new');
}

function leadScore(item) {
  let score = 0;
  if (needsContact(item)) score += 20;
  if (String(item.phone || '').trim()) score += 8;
  if (String(item.message || '').trim()) score += 5;
  if (isToday(item.created_at)) score += 4;
  if (item.client_id) score -= 30;
  if ((item.status || 'new') === 'closed') score -= 20;
  return score;
}

export default function DemoRequests() {
  const navigate = useNavigate();
  const { message, showMessage } = useTimedMessage();
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('needsContact');

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
      const updated = {
        ...item,
        ...(res.data?.item || {}),
        client_id: res.data?.client_id || res.data?.item?.client_id || item.client_id,
        crm_lead_id: res.data?.crm_lead_id || res.data?.item?.crm_lead_id || item.crm_lead_id,
      };
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
    const todayCount = items.filter((item) => isToday(item.created_at)).length;
    const withPhone = items.filter((item) => String(item.phone || '').trim()).length;
    const openCount = items.filter((item) => !['closed'].includes(item.status || 'new')).length;
    const convertedCount = items.filter((item) => item.client_id).length;
    const needsContactCount = items.filter(needsContact).length;
    return [
      { label: 'Wszystkie', value: total },
      { label: 'Dzisiaj', value: todayCount },
      { label: 'Do kontaktu', value: needsContactCount },
      { label: 'Otwarte', value: openCount },
      { label: 'W CRM', value: convertedCount },
      { label: 'Z telefonem', value: withPhone },
    ];
  }, [items, total]);

  const filteredItems = useMemo(() => {
    const matches = items.filter((item) => {
      if (activeFilter === 'needsContact') return needsContact(item);
      if (activeFilter === 'today') return isToday(item.created_at);
      if (activeFilter === 'withPhone') return Boolean(String(item.phone || '').trim());
      if (activeFilter === 'converted') return Boolean(item.client_id);
      return true;
    });
    return [...matches].sort((a, b) => leadScore(b) - leadScore(a));
  }, [activeFilter, items]);

  return (
    <div className="demo-requests-shell" style={styles.shell}>
      <CommandSidebar active="dashboard" />
      <main className="demo-requests-main" style={styles.main}>
        <PageHeader
          title="Zgłoszenia demo"
          subtitle="Leady z publicznego formularza na landing page Polska Flora."
          icon={<AssignmentTurnedIn />}
          actions={(
            <Button type="button" variant="outline" leftIcon={RefreshCw} style={styles.refreshButton} onClick={loadData}>
              Odśwież
            </Button>
          )}
        />
        <StatusMessage message={message} />

        <section className="demo-requests-stats" style={styles.statsGrid}>
          {stats.map((stat) => (
            <article className="demo-requests-stat-card" style={styles.statCard} key={stat.label}>
              <span style={styles.statLabel}>{stat.label}</span>
              <strong style={styles.statValue}>{stat.value}</strong>
            </article>
          ))}
        </section>

        <section className="demo-requests-panel" style={styles.panel}>
          <div className="demo-requests-panel-header" style={styles.panelHeader}>
            <div>
              <strong>Lista zgłoszeń</strong>
              <span style={styles.panelHint}>Najwyzej sa leady, ktore trzeba najszybciej oddzwonic.</span>
            </div>
            <span>{loading ? 'Ładowanie...' : `${filteredItems.length} widocznych`}</span>
          </div>
          <div style={styles.filterBar} aria-label="Filtry zgloszen demo">
            {FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.key}
                style={{
                  ...styles.filterButton,
                  ...(activeFilter === filter.key ? styles.filterButtonActive : {}),
                }}
                onClick={() => setActiveFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={styles.emptyState}>Ładowanie zgłoszeń demo...</div>
          ) : filteredItems.length === 0 ? (
            <div style={styles.emptyState}>Brak zgloszen dla wybranego filtra.</div>
          ) : (
            <div className="demo-requests-table-wrap" style={styles.tableWrap}>
              <table className="demo-requests-table" style={styles.table}>
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
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td style={styles.td}>{formatDate(item.created_at)}</td>
                      <td style={styles.td}>
                        <strong style={styles.primaryText}>{item.company}</strong>
                        <span style={styles.mutedLine}>{item.source || 'landing-page'}</span>
                        {needsContact(item) ? <span style={styles.hotBadge}>Najpierw dzwon</span> : null}
                      </td>
                      <td style={styles.td}>
                        <strong style={styles.primaryText}>{item.name}</strong>
                        <a style={styles.link} href={`mailto:${item.email}`}>{item.email}</a>
                      </td>
                      <td style={styles.td}>
                        {item.phone ? <a style={styles.link} href={`tel:${item.phone}`}>{item.phone}</a> : <span style={styles.mutedLine}>Brak telefonu</span>}
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
                        <Button
                          type="button"
                          leftIcon={Save}
                          style={styles.saveButton}
                          onClick={() => saveLead(item)}
                          loading={savingId === item.id}
                        >
                          {savingId === item.id ? 'Zapis...' : 'Zapisz'}
                        </Button>
                        {item.client_id ? (
                          <div style={styles.clientBadge}>
                            Klient #{item.client_id}
                            <button
                              type="button"
                              style={styles.clientLink}
                              onClick={() => navigate(`/klienci?klient=${item.client_id}`)}
                            >
                              Otworz CRM
                            </button>
                            {item.crm_lead_id ? (
                              <button
                                type="button"
                                style={styles.clientLink}
                                onClick={() => navigate(`/crm/pipeline?lead_id=${item.crm_lead_id}`)}
                              >
                                Szansa #{item.crm_lead_id}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            leftIcon={UserPlus}
                            style={styles.convertButton}
                            onClick={() => convertLead(item)}
                            loading={convertingId === item.id}
                          >
                            {convertingId === item.id ? 'Tworzę...' : 'Utwórz klienta'}
                          </Button>
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
  panelHint: {
    display: 'block',
    marginTop: 4,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 750,
  },
  filterBar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    padding: '12px 18px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface-field)',
  },
  filterButton: {
    minHeight: 32,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 999,
    padding: '0 12px',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
  },
  filterButtonActive: {
    borderColor: 'color-mix(in srgb, var(--accent) 46%, var(--border))',
    backgroundColor: 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))',
    color: 'var(--accent)',
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
  hotBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    marginTop: 8,
    border: '1px solid color-mix(in srgb, var(--warning) 36%, var(--border))',
    borderRadius: 999,
    padding: '0 8px',
    background: 'color-mix(in srgb, var(--warning) 12%, var(--bg-card))',
    color: 'var(--warning)',
    fontSize: 11,
    fontWeight: 900,
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
    appearance: 'none',
    border: 0,
    background: 'transparent',
    padding: 0,
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
  },
};
