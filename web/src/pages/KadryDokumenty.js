import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import ModernDataRow from '../components/ModernDataRow';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken } from '../utils/storedToken';

const MANAGEMENT_ROLES = new Set(['Administrator', 'Dyrektor', 'Kierownik']);
const FIELD_ROLES = new Set(['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia']);

const SETTLEMENT_LABELS = {
  hourly: 'Godzinowo',
  daily: 'Dniówka',
  fixed: 'Stała miesięczna',
  percent_revenue: '% przychodu',
  percent_margin: '% marży',
  mixed: 'Mix',
  b2b: 'B2B',
};

function formatDateTime(value) {
  if (!value) return 'brak';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'brak';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fullName(row) {
  return row?.employee_name || [row?.imie, row?.nazwisko].filter(Boolean).join(' ') || row?.login || 'Pracownik';
}

function isFieldWorker(card) {
  const role = String(card?.employee_role || card?.rola || '');
  const position = String(card?.stanowisko || '').toLowerCase();
  return FIELD_ROLES.has(role) || position.includes('arbor') || position.includes('pilarz') || position.includes('teren');
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return `${num.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

function formatSettlement(card) {
  const parts = [];
  if (card.fixed_amount_pln) parts.push(`fix ${formatMoney(card.fixed_amount_pln)}`);
  if (card.daily_rate_pln) parts.push(`${formatMoney(card.daily_rate_pln)} / dzień`);
  if (card.hourly_rate_pln) parts.push(`${formatMoney(card.hourly_rate_pln)} / h`);
  if (card.revenue_percent) parts.push(`${card.revenue_percent}% przychodu`);
  if (card.margin_percent) parts.push(`${card.margin_percent}% marży`);
  return parts.length ? parts.join(' · ') : SETTLEMENT_LABELS[card.settlement_type] || 'indywidualnie';
}

function statusMeta(card) {
  if (!card?.updated_at) return { key: 'missing', label: 'Brak karty', tone: 'danger' };
  if (card.acknowledgement_status === 'confirmed') return { key: 'confirmed', label: 'Podpisano', tone: 'ok' };
  return { key: 'pending', label: 'Do podpisu', tone: 'warn' };
}

function buildCsv(cards) {
  const header = ['Pracownik', 'Rola', 'Stanowisko', 'Status', 'Aktualizacja', 'Podpis', 'Rozliczenie'];
  const rows = cards.map((card) => [
    fullName(card),
    card.employee_role || '',
    card.stanowisko || '',
    statusMeta(card).label,
    formatDateTime(card.updated_at),
    formatDateTime(card.acknowledged_at),
    formatSettlement(card),
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
}

export default function KadryDokumenty() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const stored = readStoredUser();
    if (!getStoredToken() || !stored) {
      navigate('/');
      return;
    }
    setUser(stored);
    loadCards();
  }, [navigate]);

  async function loadCards() {
    setLoading(true);
    setMessage('');
    try {
      const res = await api.get('/position-cards');
      setCards(Array.isArray(res.data?.cards) ? res.data.cards : []);
    } catch (err) {
      setMessage(err?.response?.data?.error || 'Nie udało się załadować dokumentów kadrowych.');
    } finally {
      setLoading(false);
    }
  }

  const allowed = MANAGEMENT_ROLES.has(user?.rola);
  const roles = useMemo(() => {
    const list = [...new Set(cards.map((card) => card.employee_role).filter(Boolean))];
    return list.sort((a, b) => a.localeCompare(b, 'pl'));
  }, [cards]);

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      const meta = statusMeta(card);
      const matchesStatus = statusFilter === 'all' || meta.key === statusFilter;
      const matchesRole = roleFilter === 'all' || card.employee_role === roleFilter;
      const haystack = [fullName(card), card.employee_role, card.stanowisko, card.cenny_produkt]
        .join(' ')
        .toLowerCase();
      return matchesStatus && matchesRole && (!needle || haystack.includes(needle));
    });
  }, [cards, query, roleFilter, statusFilter]);

  const summary = useMemo(() => {
    const saved = cards.filter((card) => card.updated_at);
    const confirmed = saved.filter((card) => card.acknowledgement_status === 'confirmed');
    const pending = saved.filter((card) => card.acknowledgement_status !== 'confirmed');
    const missing = cards.filter((card) => !card.updated_at);
    const field = cards.filter(isFieldWorker);
    return { saved, confirmed, pending, missing, field };
  }, [cards]);

  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${buildCsv(filteredCards)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbor-kadry-dokumenty-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell" style={S.wrap}>
      <Sidebar />
      <main className="app-main" style={S.main}>
        <header style={S.header}>
          <div>
            <div style={S.eyebrow}>Kadry i dokumenty</div>
            <h1 style={S.title}>Rejestr kart stanowiskowych</h1>
            <p style={S.subtitle}>
              Kontrola wersji kart, podpisów pracowników i warunków rozliczenia w jednym miejscu.
            </p>
          </div>
          <div style={S.headerActions}>
            <button type="button" style={S.secondaryBtn} onClick={loadCards}>Odśwież</button>
            <button type="button" style={S.primaryBtn} onClick={() => navigate('/profil')}>Edytuj kartę</button>
          </div>
        </header>

        {!allowed ? (
          <section style={S.panel}>
            <div style={S.empty}>Ten widok jest dostępny dla Administratora, Dyrektora i Kierownika.</div>
          </section>
        ) : (
          <>
            <section style={S.stats}>
              <div style={S.stat}><span style={S.statLabel}>Zapisane karty</span><strong style={S.statValue}>{summary.saved.length}</strong><small style={S.statHint}>{cards.length} pracowników w rejestrze</small></div>
              <div style={S.stat}><span style={S.statLabel}>Do podpisu</span><strong style={S.statValue}>{summary.pending.length}</strong><small style={S.statHint}>wymagają reakcji pracownika</small></div>
              <div style={S.stat}><span style={S.statLabel}>Podpisane</span><strong style={S.statValue}>{summary.confirmed.length}</strong><small style={S.statHint}>wersje potwierdzone</small></div>
              <div style={S.stat}><span style={S.statLabel}>Braki</span><strong style={S.statValue}>{summary.missing.length}</strong><small style={S.statHint}>bez opublikowanej karty</small></div>
              <div style={S.stat}><span style={S.statLabel}>Teren / BHP</span><strong style={S.statValue}>{summary.field.length}</strong><small style={S.statHint}>role z checklistą terenową</small></div>
            </section>

            <section style={S.panel}>
              <div style={S.toolbar}>
                <input
                  style={S.input}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Szukaj pracownika, roli, stanowiska..."
                  aria-label="Szukaj dokumentów"
                />
                <select style={S.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status dokumentu">
                  <option value="all">Wszystkie statusy</option>
                  <option value="pending">Do podpisu</option>
                  <option value="confirmed">Podpisane</option>
                  <option value="missing">Brak karty</option>
                </select>
                <select style={S.select} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Rola">
                  <option value="all">Wszystkie role</option>
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button type="button" style={S.secondaryBtn} onClick={exportCsv} disabled={!filteredCards.length}>
                  Eksport CSV
                </button>
              </div>
              {message ? <div style={S.alert}>{message}</div> : null}
              {loading ? (
                <div style={S.empty}>Ładowanie rejestru dokumentów...</div>
              ) : filteredCards.length === 0 ? (
                <div style={S.empty}>Brak dokumentów pasujących do filtrów.</div>
              ) : (
                <div className="modern-data-stack">
                  {filteredCards.map((card) => {
                    const meta = statusMeta(card);
                    return (
                      <ModernDataRow
                        key={card.user_id}
                        idLabel="Employee ID"
                        idValue={`USR-${card.user_id}`}
                        title={fullName(card)}
                        subtitle={card.employee_role || 'brak roli'}
                        tone={meta.tone === 'ok' ? 'success' : meta.tone === 'danger' ? 'danger' : 'warning'}
                        status={meta.label}
                        statusValue={meta.label}
                        statusState={meta.tone === 'ok' ? 'success' : meta.tone === 'danger' ? 'danger' : 'warning'}
                        metrics={[
                          { label: 'Dokument', value: card.stanowisko || 'Brak stanowiska', mono: false },
                          { label: 'Typ', value: isFieldWorker(card) ? 'Karta + BHP terenowe' : 'Karta stanowiska', mono: false },
                          { label: 'Rozliczenie', value: formatSettlement(card), mono: false },
                          { label: 'Wersja', value: formatDateTime(card.updated_at) },
                          { label: 'Podpis', value: formatDateTime(card.acknowledged_at), tone: card.acknowledged_at ? 'success' : 'warning' },
                          { label: 'Potwierdził', value: card.acknowledged_by_name || 'brak', mono: false },
                        ]}
                        actions={
                          <>
                            <button type="button" style={S.rowBtn} onClick={() => navigate(`/profil/${card.user_id}`)}>
                              Profil
                            </button>
                            <button type="button" style={S.rowBtnPrimary} onClick={() => navigate(`/kadry-dokumenty/druk/${card.user_id}`)}>
                              PDF
                            </button>
                          </>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main: { flex: 1, padding: '24px 28px 48px', minWidth: 0 },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    padding: 18,
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    marginBottom: 14,
  },
  eyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  title: { margin: '4px 0 8px', color: 'var(--text)', fontSize: 28, lineHeight: 1.1, fontWeight: 900 },
  subtitle: { margin: 0, color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.45, fontWeight: 650, maxWidth: 720 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryBtn: {
    minHeight: 40,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 900,
  },
  secondaryBtn: {
    minHeight: 40,
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    color: 'var(--text-sub)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 850,
  },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10, marginBottom: 14 },
  stat: {
    minHeight: 92,
    display: 'grid',
    gap: 5,
    alignContent: 'space-between',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    padding: '12px 14px',
  },
  statLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  statValue: { color: 'var(--accent)', fontSize: 24, fontWeight: 950, lineHeight: 1.1 },
  statHint: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  panel: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    padding: 14,
    minWidth: 0,
  },
  toolbar: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 12 },
  input: {
    minHeight: 40,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 700,
    outline: 'none',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  select: {
    minHeight: 40,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 750,
    outline: 'none',
  },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 980 },
  th: {
    textAlign: 'left',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    background: 'var(--bg-deep)',
    borderBottom: '1px solid var(--border)',
    padding: '10px 12px',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px', verticalAlign: 'top', color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.4 },
  name: { display: 'block', color: 'var(--text)', fontSize: 14, fontWeight: 900 },
  cellTitle: { display: 'block', color: 'var(--text)', fontSize: 13, fontWeight: 850 },
  muted: { display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, marginTop: 2 },
  settlement: { display: 'block', color: 'var(--text-sub)', fontWeight: 800 },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 26,
    padding: '4px 9px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    fontSize: 12,
    fontWeight: 900,
  },
  badgeOk: { color: '#34D399', borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.09)' },
  badgeWarn: { color: '#F9A825', borderColor: 'rgba(249,168,37,0.35)', background: 'rgba(249,168,37,0.09)' },
  badgeDanger: { color: '#F87171', borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.09)' },
  rowBtn: {
    minHeight: 34,
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
  },
  rowBtnPrimary: {
    minHeight: 34,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
  },
  rowActions: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  alert: {
    border: '1px solid rgba(248,113,113,0.35)',
    borderRadius: 8,
    background: 'rgba(248,113,113,0.08)',
    color: '#F87171',
    padding: '10px 12px',
    marginBottom: 10,
    fontSize: 13,
    fontWeight: 800,
  },
  empty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '16px 12px',
    color: 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.45,
  },
};
