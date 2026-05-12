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
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const MONTHS = [
  'Styczen', 'Luty', 'Marzec', 'Kwiecien', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpien', 'Wrzesien', 'Pazdziernik', 'Listopad', 'Grudzien',
];

const SALES_DIRECTOR_ROLES = new Set([
  'Dyrektor Sprzedazy',
  'Dyrektor SprzedaĹĽy',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor dziaĹ‚u sprzedaĹĽ',
]);

function canSeeAllBranches(user) {
  return ['Prezes', 'Dyrektor'].includes(user?.rola) || SALES_DIRECTOR_ROLES.has(user?.rola);
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

function formatScore(value) {
  return Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
}

function WinnerCard({ title, subtitle, winner, Icon }) {
  return (
    <div style={S.winnerCard}>
      <div style={S.winnerIcon}><Icon style={{ fontSize: 22 }} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={S.cardLabel}>{title}</div>
        <div style={S.cardTitle}>{winner?.ekipa_nazwa || 'Brak danych'}</div>
        <div style={S.cardSub}>{subtitle}</div>
        {winner && (
          <div style={S.metricLine}>
            <span>{formatScore(winner.score)} pkt</span>
            <span>{winner.zakonczone}/{winner.zadania} zakonczone</span>
            <span>{formatCurrency(winner.wartosc)}</span>
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
    <div style={S.tableWrap}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Miejsce</th>
            <th style={S.th}>Ekipa</th>
            <th style={S.th}>Oddzial</th>
            <th style={S.th}>Punkty</th>
            <th style={S.th}>Zlecenia</th>
            <th style={S.th}>Skutecznosc</th>
            <th style={S.th}>Wartosc</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ekipa_id} style={S.tr}>
              <td style={S.td}><strong>#{row.miejsce}</strong></td>
              <td style={S.td}>{row.ekipa_nazwa}</td>
              <td style={S.tdMuted}>{row.oddzial_nazwa || '-'}</td>
              <td style={S.td}>{formatScore(row.score)}</td>
              <td style={S.td}>{row.zakonczone}/{row.zadania}</td>
              <td style={S.td}>{row.skutecznosc}%</td>
              <td style={S.td}>{formatCurrency(row.wartosc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      const params = { rok, miesiac };
      if (oddzialId) params.oddzial_id = oddzialId;
      const rankingReq = api.get('/ekipy/ranking', { headers, params, dedupe: false });
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
  const monthlyRows = ranking?.month?.ranking || [];
  const compact = viewportWidth < 720;

  return (
    <div style={S.shell}>
      <Sidebar />
      <main style={{ ...S.main, ...(compact ? S.mainCompact : null) }}>
        <PageHeader
          variant="hero"
          showBack={!compact}
          title="Ranking brygad"
          subtitle={compact ? 'Ranking okresow.' : 'Najlepsza brygada tygodnia, miesiaca, polrocza i roku wedlug zakonczonych zlecen, wartosci i planowanych godzin.'}
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
          <div style={S.empty}>Ladowanie rankingu...</div>
        ) : (
          <>
            <section style={{ ...S.winnerGrid, ...(compact ? S.singleColumnGrid : null) }}>
              <WinnerCard title="Najlepsza ekipa miesiaca" subtitle={ranking?.month?.label || ''} winner={ranking?.month?.winner} Icon={EmojiEventsOutlined} />
              <WinnerCard title="Najlepsza ekipa polrocza" subtitle={ranking?.halfYear?.label || ''} winner={ranking?.halfYear?.winner} Icon={TrendingUpOutlined} />
              <WinnerCard title="Najlepsza ekipa roku" subtitle={ranking?.year?.label || ''} winner={ranking?.year?.winner} Icon={GroupsOutlined} />
            </section>

            <section style={S.section}>
              <div style={{ ...S.sectionTitle, ...(compact ? S.sectionTitleCompact : null) }}>
                <CalendarMonthOutlined style={{ fontSize: 20 }} />
                {compact ? 'Tygodniowi liderzy miesiaca' : 'Najlepsza brygada w kazdym tygodniu miesiaca'}
              </div>
              <div style={{ ...S.weekGrid, ...(compact ? S.singleColumnGrid : null) }}>
                {(ranking?.weeks || []).map((week) => (
                  <div key={week.key} style={S.weekCard}>
                    <div style={S.cardLabel}>{week.label}</div>
                    <div style={S.weekWinner}>{week.winner?.ekipa_nazwa || 'Brak danych'}</div>
                    {week.winner && (
                      <div style={S.metricLine}>
                        <span>{formatScore(week.winner.score)} pkt</span>
                        <span>{formatCurrency(week.winner.wartosc)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section style={S.section}>
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
    background: 'var(--forest-pattern), linear-gradient(180deg, rgba(20,53,31,0.28) 0%, var(--bg-deep) 100%)',
  },
  main: { flex: 1, padding: 28, minWidth: 0, overflowX: 'hidden' },
  mainCompact: { padding: '16px 12px 24px', width: 'calc(100vw - 68px)', maxWidth: 'calc(100vw - 68px)', boxSizing: 'border-box' },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  actionsCompact: { width: '100%', justifyContent: 'flex-start' },
  select: { minHeight: 38, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'rgba(5,10,7,0.7)', color: 'var(--text)', fontSize: 13 },
  selectCompact: { flex: '0 1 132px', minWidth: 0, maxWidth: 150 },
  branchSelectCompact: { flex: '1 1 100%', width: '100%', minWidth: 0 },
  yearInput: { width: 92, minHeight: 38, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'rgba(5,10,7,0.7)', color: 'var(--text)', fontSize: 13 },
  yearInputCompact: { flex: '0 1 92px' },
  iconBtn: { width: 38, height: 38, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  winnerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 16 },
  singleColumnGrid: { gridTemplateColumns: 'minmax(0, 1fr)' },
  winnerCard: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    border: '1px solid rgba(191,225,146,0.18)',
    borderRadius: 8,
    padding: 16,
    boxShadow: 'var(--shadow-sm)',
  },
  winnerIcon: { width: 40, height: 40, borderRadius: 8, background: 'rgba(155,217,87,0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border2)' },
  cardLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 },
  cardTitle: { marginTop: 6, fontSize: 20, fontWeight: 800, color: 'var(--text)', overflowWrap: 'anywhere' },
  cardSub: { marginTop: 3, fontSize: 12, color: 'var(--text-sub)' },
  metricLine: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-sub)' },
  section: { marginTop: 16 },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--text)', fontWeight: 800, fontSize: 16 },
  sectionTitleCompact: { alignItems: 'flex-start', flexWrap: 'wrap', lineHeight: 1.25 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 },
  weekCard: { background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))', border: '1px solid rgba(191,225,146,0.18)', borderRadius: 8, padding: 14, boxShadow: 'var(--shadow-sm)' },
  weekWinner: { marginTop: 6, color: 'var(--text)', fontWeight: 800, fontSize: 15, overflowWrap: 'anywhere' },
  tableWrap: { overflowX: 'auto', border: '1px solid rgba(191,225,146,0.18)', borderRadius: 8, background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))', boxShadow: 'var(--shadow-sm)' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 720 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(191,225,146,0.14)' },
  tr: { borderBottom: '1px solid rgba(191,225,146,0.1)' },
  td: { padding: '12px', fontSize: 13, color: 'var(--text)' },
  tdMuted: { padding: '12px', fontSize: 13, color: 'var(--text-sub)' },
  empty: { background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))', border: '1px solid rgba(191,225,146,0.18)', borderRadius: 8, padding: 24, color: 'var(--text-sub)', textAlign: 'center' },
};
