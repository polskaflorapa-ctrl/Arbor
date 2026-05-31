import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const MONTHS = [
  'Styczen', 'Luty', 'Marzec', 'Kwiecien', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpien', 'Wrzesien', 'Pazdziernik', 'Listopad', 'Grudzien',
];

const SALES_DIRECTOR_ROLES = new Set([
  'Dyrektor Sprzedaży',
  'Dyrektor Sprzedazy',
  'Dyrektor działu sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor dzialu sprzedazy',
]);

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function canSeeAllBranches(user) {
  const role = normalizeRole(user?.rola);
  return ['prezes', 'dyrektor', 'administrator'].includes(role) ||
    SALES_DIRECTOR_ROLES.has(user?.rola) ||
    (role.includes('dyrektor') && role.includes('sprzed'));
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

function formatScore(value) {
  return Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
}

function formatHours(value) {
  return `${(Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} h`;
}

function teamScopeLabel(row) {
  const branch = row?.oddzial_nazwa || 'Brak oddzialu';
  return row?.brygadzista_nazwa ? `${branch} · ${row.brygadzista_nazwa}` : branch;
}

function WinnerCard({ title, subtitle, winner, Icon }) {
  return (
    <div className="ranking-brygad-winner-card" style={S.winnerCard}>
      <div style={S.winnerIcon}><Icon style={{ fontSize: 22 }} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={S.cardLabel}>{title}</div>
        <div style={S.cardTitle}>{winner?.ekipa_nazwa || 'Brak danych'}</div>
        <div style={S.cardSub}>{subtitle}</div>
        {winner && (
          <div style={S.metricLine}>
            <span>{formatScore(winner.score)} pkt</span>
            <span>{winner.completed_tasks}/{winner.total_tasks} z raportow</span>
            <span>{formatCurrency(winner.revenue)}</span>
            <span>{formatHours(winner.logged_hours || winner.planned_hours)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RankingTable({ rows }) {
  if (!rows?.length) {
    return <div style={S.empty}>Brak zlecen z przypisana ekipa w tym okresie.</div>;
  }
  return (
    <div className="modern-data-stack ranking-brygad-table">
      {rows.map((row) => (
        <ModernDataRow
          key={row.ekipa_id}
          idLabel="Ranking"
          idValue={`#${row.rank}`}
          title={row.ekipa_nazwa}
          subtitle={teamScopeLabel(row)}
          tone={row.rank <= 3 ? 'success' : 'info'}
          status={row.rank <= 3 ? 'TOP TEAM' : 'TRACKED'}
          statusValue={row.rank <= 3 ? 'success' : 'info'}
          statusState={row.rank <= 3 ? 'success' : 'info'}
          metrics={[
            { label: 'Punkty', value: formatScore(row.score), tone: row.rank <= 3 ? 'success' : undefined },
            { label: 'Raporty', value: row.reports_count || 0 },
            { label: 'Zlecenia', value: `${row.completed_tasks}/${row.total_tasks}` },
            { label: 'Skutecznosc', value: `${row.completion_rate}%`, tone: Number(row.completion_rate) >= 80 ? 'success' : 'warning' },
            { label: 'Wartosc', value: formatCurrency(row.revenue), tone: 'info' },
            { label: 'Godziny', value: formatHours(row.logged_hours || row.planned_hours) },
          ]}
        />
      ))}
    </div>
  );
}

export default function RankingBrygad() {
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [currentUser, setCurrentUser] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [oddzialy, setOddzialy] = useState([]);
  const [rok, setRok] = useState(now.getFullYear());
  const [miesiac, setMiesiac] = useState(now.getMonth() + 1);
  const [oddzialId, setOddzialId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadRanking = useCallback(async (userArg) => {
    const actor = userArg || currentUser;
    if (!actor) return;
    setLoading(true);
    try {
      const token = getStoredToken();
      const headers = authHeaders(token);
      const params = { as_of: `${rok}-${String(miesiac).padStart(2, '0')}-15` };
      if (oddzialId) params.oddzial_id = oddzialId;
      const rankingReq = api.get('/raporty/ranking-brygad', { headers, params, dedupe: false });
      const branchesReq = api.get('/oddzialy', { headers }).catch(() => ({ data: [] }));
      const [rankingRes, branchesRes] = await Promise.all([rankingReq, branchesReq]);
      setRanking(rankingRes.data);
      setOddzialy(Array.isArray(branchesRes.data) ? branchesRes.data : []);
      setMessage('');
    } catch (err) {
      setMessage(getApiErrorMessage(err, 'Nie udalo sie wczytac rankingu brygad'));
    } finally {
      setLoading(false);
    }
  }, [currentUser, miesiac, oddzialId, rok]);

  useEffect(() => {
    const parsed = getLocalStorageJson('user');
    if (!parsed) {
      navigate('/');
      return;
    }
    setCurrentUser(parsed);
  }, [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (currentUser) loadRanking(currentUser);
  }, [currentUser, loadRanking]);

  const globalView = canSeeAllBranches(currentUser);
  const monthlyRows = ranking?.periods?.month?.items || [];
  const activeWeek = ranking?.periods?.week || null;
  const branchRows = ranking?.branches?.month || [];
  const reportCount = monthlyRows.reduce((sum, row) => sum + Number(row.reports_count || 0), 0);
  const compact = viewportWidth < 720;

  return (
    <div className="ranking-brygad-shell" style={S.shell}>
      <Sidebar />
      <main className="ranking-brygad-main" style={{ ...S.main, ...(compact ? S.mainCompact : null) }}>
        <PageHeader
          variant="hero"
          showBack={!compact}
          title="Ranking brygad"
          subtitle={compact ? 'Liga z raportow dziennych.' : 'Liga brygad miedzy oddzialami liczona z raportow dziennych: raporty, wykonane zlecenia, czas, wartosc, zdjecia i problemy.'}
          icon={<EmojiEventsOutlined style={{ fontSize: 28 }} />}
          actions={
            <div style={{ ...S.actions, ...(compact ? S.actionsCompact : null) }}>
              <StatusMessage message={message} />
              <select style={{ ...S.select, ...(compact ? S.selectCompact : null) }} value={miesiac} onChange={(e) => setMiesiac(Number(e.target.value))}>
                {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
              <input style={{ ...S.yearInput, ...(compact ? S.yearInputCompact : null) }} type="number" value={rok} onChange={(e) => setRok(Number(e.target.value) || now.getFullYear())} />
              {globalView && oddzialy.length > 1 && (
                <select style={{ ...S.select, ...(compact ? S.branchSelectCompact : null) }} value={oddzialId} onChange={(e) => setOddzialId(e.target.value)}>
                  <option value="">Wszystkie oddzialy</option>
                  {oddzialy.map((o) => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                </select>
              )}
              <button type="button" style={S.iconBtn} onClick={() => loadRanking(currentUser)} disabled={loading} title="Odswiez ranking">
                <RefreshOutlined style={{ fontSize: 18 }} />
              </button>
            </div>
          }
        />

        {loading ? (
          <div className="ranking-brygad-empty" style={S.empty}>Ladowanie rankingu...</div>
        ) : (
          <>
            <section className="ranking-brygad-winners" style={{ ...S.winnerGrid, ...(compact ? S.singleColumnGrid : null) }}>
              <WinnerCard title="Najlepsza ekipa tygodnia" subtitle={activeWeek?.label || ''} winner={activeWeek?.winner} Icon={CalendarMonthOutlined} />
              <WinnerCard title="Najlepsza ekipa miesiaca" subtitle={ranking?.periods?.month?.label || ''} winner={ranking?.periods?.month?.winner} Icon={EmojiEventsOutlined} />
              <WinnerCard title="Najlepsza ekipa polrocza" subtitle={ranking?.periods?.half_year?.label || ''} winner={ranking?.periods?.half_year?.winner} Icon={TrendingUpOutlined} />
              <WinnerCard title="Najlepsza ekipa roku" subtitle={ranking?.periods?.year?.label || ''} winner={ranking?.periods?.year?.winner} Icon={GroupsOutlined} />
            </section>

            <section className="ranking-brygad-summary" style={S.summaryBar}>
              <div>
                <span style={S.summaryLabel}>Zakres</span>
                <strong>{oddzialId ? oddzialy.find((o) => String(o.id) === String(oddzialId))?.nazwa : 'Wszystkie oddzialy'}</strong>
              </div>
              <div>
                <span style={S.summaryLabel}>Ekipy w rankingu</span>
                <strong>{monthlyRows.length}</strong>
              </div>
              <div>
                <span style={S.summaryLabel}>Raporty dzienne</span>
                <strong>{reportCount}</strong>
              </div>
            </section>

            <section className="ranking-brygad-section" style={S.section}>
              <div style={{ ...S.sectionTitle, ...(compact ? S.sectionTitleCompact : null) }}>
                <CalendarMonthOutlined style={{ fontSize: 20 }} />
                {compact ? 'Liga oddzialow' : 'Liga oddzialow z raportow dziennych'}
              </div>
              <div style={{ ...S.weekGrid, ...(compact ? S.singleColumnGrid : null) }}>
                {branchRows.map((branch) => (
                  <div className="ranking-brygad-branch-card" key={branch.oddzial_id || branch.oddzial_nazwa} style={S.weekCard}>
                    <div style={S.cardLabel}>#{branch.rank} · {branch.teams_count} ekip</div>
                    <div style={S.weekWinner}>{branch.oddzial_nazwa}</div>
                    <div style={S.metricLine}>
                      <span>{formatScore(branch.score)} pkt</span>
                      <span>{branch.completed_tasks}/{branch.total_tasks} zlecen</span>
                      <span>{formatCurrency(branch.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="ranking-brygad-section ranking-brygad-month-section" style={S.section}>
              <div style={{ ...S.sectionTitle, ...(compact ? S.sectionTitleCompact : null) }}>
                <EmojiEventsOutlined style={{ fontSize: 20 }} />
                Pelny ranking miesiaca
              </div>
              <RankingTable rows={monthlyRows} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const S = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    background: 'transparent',
  },
  main: { flex: 1, padding: 28, minWidth: 0, overflowX: 'hidden' },
  mainCompact: { padding: '16px 12px 24px', width: 'calc(100vw - 68px)', maxWidth: 'calc(100vw - 68px)', boxSizing: 'border-box' },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  actionsCompact: { width: '100%', justifyContent: 'flex-start' },
  select: { minHeight: 38, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--glass-border)', background: '#fff', color: 'var(--text)', fontSize: 13, boxShadow: 'var(--shadow-sm)' },
  selectCompact: { flex: '0 1 132px', minWidth: 0, maxWidth: 150 },
  branchSelectCompact: { flex: '1 1 100%', width: '100%', minWidth: 0 },
  yearInput: { width: 92, minHeight: 38, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--glass-border)', background: '#fff', color: 'var(--text)', fontSize: 13, boxShadow: 'var(--shadow-sm)' },
  yearInputCompact: { flex: '0 1 92px' },
  iconBtn: { width: 38, height: 38, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  winnerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 16 },
  singleColumnGrid: { gridTemplateColumns: 'minmax(0, 1fr)' },
  winnerCard: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: 16,
    boxShadow: 'var(--shadow-sm)',
  },
  winnerIcon: { width: 40, height: 40, borderRadius: 8, background: 'rgba(155,217,87,0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border)' },
  cardLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 },
  cardTitle: { marginTop: 6, fontSize: 20, fontWeight: 800, color: 'var(--text)', overflowWrap: 'anywhere' },
  cardSub: { marginTop: 3, fontSize: 12, color: 'var(--text-sub)' },
  metricLine: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-sub)' },
  delegationText: { color: '#f59e0b', fontWeight: 800 },
  summaryBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
    marginBottom: 16,
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: 14,
    boxShadow: 'var(--shadow-sm)',
  },
  summaryLabel: {
    display: 'block',
    marginBottom: 4,
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  section: { marginTop: 16 },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--text)', fontWeight: 800, fontSize: 16 },
  sectionTitleCompact: { alignItems: 'flex-start', flexWrap: 'wrap', lineHeight: 1.25 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 },
  weekCard: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 14, boxShadow: 'var(--shadow-sm)' },
  weekWinner: { marginTop: 6, color: 'var(--text)', fontWeight: 800, fontSize: 15, overflowWrap: 'anywhere' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', boxShadow: 'var(--shadow-sm)' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 720 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px', fontSize: 13, color: 'var(--text)' },
  tdMuted: { padding: '12px', fontSize: 13, color: 'var(--text-sub)' },
  empty: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 24, color: 'var(--text-sub)', textAlign: 'center' },
};
