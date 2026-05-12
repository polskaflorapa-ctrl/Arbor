import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import FlashOnOutlined from '@mui/icons-material/FlashOnOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const ACTIVE_STATUSES = new Set(['W_Realizacji', 'W realizacji']);
const DONE_STATUSES = new Set(['Zakonczone', 'Zakończone']);

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function taskDateKey(task) {
  const raw = task?.data_planowana || task?.data_zaplanowana || task?.data_wykonania || '';
  return String(raw).slice(0, 10);
}

function taskHour(task) {
  const raw = task?.godzina_rozpoczecia || task?.start_time || '';
  return raw ? String(raw).slice(0, 5) : '--:--';
}

function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function isUrgent(task) {
  return ['pilny', 'wysoki', 'high'].includes(String(task?.priorytet || '').toLowerCase());
}

function isDone(task) {
  return DONE_STATUSES.has(task?.status);
}

function isActive(task) {
  return ACTIVE_STATUSES.has(task?.status);
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function KpiCard({ icon, label, value, tone = 'accent' }) {
  return (
    <div style={s.kpiCard}>
      <div style={{ ...s.kpiIcon, color: `var(--${tone})` }}>{icon}</div>
      <div>
        <div style={s.kpiValue}>{value}</div>
        <div style={s.kpiLabel}>{label}</div>
      </div>
    </div>
  );
}

function TaskRow({ task, onOpen }) {
  return (
    <button type="button" onClick={onOpen} style={s.taskRow}>
      <span style={s.taskHour}>{taskHour(task)}</span>
      <span style={s.taskMain}>
        <span style={s.taskTitle}>{task.klient_nazwa || `Zlecenie #${task.id}`}</span>
        <span style={s.taskMeta}>{[task.miasto, task.adres].filter(Boolean).join(', ') || 'Brak adresu'}</span>
      </span>
      <span style={{ ...s.statusPill, ...(isUrgent(task) ? s.statusUrgent : {}) }}>
        {task.priorytet || task.status || '-'}
      </span>
    </button>
  );
}

export default function MisjaDnia() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const todayKey = localDateKey();

  const load = useCallback(async () => {
    const token = getStoredToken();
    const storedUser = readStoredUser();
    if (!token || !storedUser) {
      navigate('/');
      return;
    }
    setUser(storedUser);
    setLoading(true);
    setError('');
    try {
      const teamScoped = ['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(storedUser.rola);
      const endpoint = teamScoped ? `/tasks/moje?data=${todayKey}` : '/tasks/wszystkie?limit=100&offset=0';
      const res = await api.get(endpoint, { headers: authHeaders(token) });
      setTasks(normalizeList(res.data));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udało się załadować misji dnia.'));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [navigate, todayKey]);

  useEffect(() => {
    load();
  }, [load]);

  const todayTasks = useMemo(
    () => tasks.filter((task) => taskDateKey(task) === todayKey),
    [tasks, todayKey],
  );
  const activeNow = useMemo(() => todayTasks.filter(isActive), [todayTasks]);
  const urgentToday = useMemo(() => todayTasks.filter(isUrgent), [todayTasks]);
  const remainingToday = useMemo(() => todayTasks.filter((task) => !isDone(task)), [todayTasks]);
  const completion = todayTasks.length
    ? Math.round(((todayTasks.length - remainingToday.length) / todayTasks.length) * 100)
    : 0;
  const etaMinutes = remainingToday.reduce((sum, task) => sum + (isActive(task) ? 75 : 95), 0);
  const etaLabel = remainingToday.length === 0
    ? 'Dzień zamknięty'
    : etaMinutes <= 120
      ? 'Do domknięcia bez przeciążenia'
      : etaMinutes <= 240
        ? 'Średnie obciążenie dnia'
        : 'Ciężki dzień operacyjny';

  const quickActions = [
    { label: 'Zlecenia', sub: 'Lista i statusy', path: '/zlecenia', Icon: AssignmentTurnedInOutlined },
    { label: 'Raport dzienny', sub: 'Przejdź do raportów', path: '/raporty', Icon: DescriptionOutlined },
    { label: 'Harmonogram', sub: 'Plan ekip', path: '/harmonogram', Icon: CalendarTodayOutlined },
    { label: 'Nowe zlecenie', sub: 'Dodaj temat', path: '/nowe-zlecenie', Icon: FlashOnOutlined },
  ];

  return (
    <div style={s.root}>
      <Sidebar />
      <main style={s.content}>
        <PageHeader
          title="Misja dnia"
          subtitle={`Tryb operacyjny na dziś: ${todayKey}. Widok zbiera zlecenia, postęp dnia, aktywne tematy i szybkie przejścia.`}
          icon={<FlashOnOutlined />}
          actions={(
            <button type="button" onClick={load} style={s.secondaryButton} disabled={loading}>
              <RefreshOutlined style={{ fontSize: 18 }} />
              {loading ? 'Odświeżanie...' : 'Odśwież'}
            </button>
          )}
        />

        <StatusMessage message={error} tone={error ? 'error' : undefined} />

        <section style={s.kpiGrid} aria-label="KPI dnia">
          <KpiCard icon={<AssignmentTurnedInOutlined />} label="Zleceń dziś" value={todayTasks.length} />
          <KpiCard icon={<ScheduleOutlined />} label="W realizacji" value={activeNow.length} tone="warning" />
          <KpiCard icon={<ReportProblemOutlined />} label="Pilne" value={urgentToday.length} tone="danger" />
          <KpiCard icon={<CheckCircleOutline />} label="Postęp dnia" value={`${completion}%`} tone="success" />
        </section>

        <section style={s.grid}>
          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Postęp i ETA</h2>
                <p style={s.cardSub}>{etaLabel}</p>
              </div>
              <span style={s.bigMetric}>{remainingToday.length}</span>
            </div>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${completion}%` }} />
            </div>
            <div style={s.progressMeta}>
              <span>{todayTasks.length - remainingToday.length}/{todayTasks.length || 0} zakończonych</span>
              <span>{formatDuration(etaMinutes)} pracy szacunkowej</span>
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Aktywne teraz</h2>
                <p style={s.cardSub}>Zlecenia z aktualnym statusem realizacji</p>
              </div>
            </div>
            {loading ? (
              <div style={s.empty}>Ładowanie...</div>
            ) : activeNow.length === 0 ? (
              <div style={s.empty}>Brak aktywnych zleceń w tej chwili.</div>
            ) : (
              <div style={s.list}>
                {activeNow.slice(0, 4).map((task) => (
                  <TaskRow key={task.id} task={task} onOpen={() => navigate(`/zlecenia/${task.id}`)} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section style={s.gridWide}>
          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Plan dnia</h2>
                <p style={s.cardSub}>Najbliższe zlecenia w kolejności godzinowej</p>
              </div>
            </div>
            {loading ? (
              <div style={s.empty}>Ładowanie planu...</div>
            ) : todayTasks.length === 0 ? (
              <div style={s.empty}>Na dziś nie ma zaplanowanych zleceń.</div>
            ) : (
              <div style={s.list}>
                {[...todayTasks]
                  .sort((a, b) => taskHour(a).localeCompare(taskHour(b)))
                  .slice(0, 10)
                  .map((task) => (
                    <TaskRow key={task.id} task={task} onOpen={() => navigate(`/zlecenia/${task.id}`)} />
                  ))}
              </div>
            )}
          </div>

          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Szybkie akcje</h2>
                <p style={s.cardSub}>Najczęstsze przejścia z trybu dnia</p>
              </div>
            </div>
            <div style={s.actionList}>
              {quickActions.map(({ label, sub, path, Icon }, idx) => (
                <Fragment key={path}>
                  {idx > 0 ? <div style={s.hairline} /> : null}
                  <button type="button" onClick={() => navigate(path)} style={s.actionRow}>
                    <span style={s.actionIcon}><Icon style={{ fontSize: 18 }} /></span>
                    <span style={s.actionText}>
                      <span style={s.actionLabel}>{label}</span>
                      <span style={s.actionSub}>{sub}</span>
                    </span>
                    <span style={s.chevron}>›</span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        {user ? (
          <div style={s.footerNote}>
            Widok dla: {user.imie} {user.nazwisko} · {user.rola}
          </div>
        ) : null}
      </main>
    </div>
  );
}

const s = {
  root: { display: 'flex', minHeight: '100vh', background: 'var(--forest-pattern), linear-gradient(180deg, rgba(20,53,31,0.28) 0%, var(--bg-deep) 100%)' },
  content: { flex: 1, minWidth: 0, padding: 'clamp(16px, 4vw, 32px)', overflowX: 'hidden' },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card2)',
    color: 'var(--text)',
    borderRadius: 10,
    padding: '9px 13px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 14, marginBottom: 18 },
  kpiCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    boxShadow: 'var(--shadow-sm)',
    padding: 16,
    minHeight: 82,
  },
  kpiIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-deep)',
    border: '1px solid var(--border2)',
  },
  kpiValue: { fontSize: 24, fontWeight: 750, letterSpacing: '0', color: 'var(--text)', lineHeight: 1 },
  kpiLabel: { marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18, marginBottom: 18 },
  gridWide: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18 },
  card: {
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    boxShadow: 'var(--shadow-sm)',
    padding: 18,
    minWidth: 0,
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 750, color: 'var(--text)', letterSpacing: '0' },
  cardSub: { margin: '4px 0 0', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', lineHeight: 1.4 },
  bigMetric: { fontSize: 30, fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' },
  progressTrack: { height: 12, borderRadius: 999, background: 'var(--bg-deep)', border: '1px solid var(--border2)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--success), var(--accent))', transition: 'width 0.25s ease' },
  progressMeta: { marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--text-sub)', fontWeight: 650 },
  empty: { padding: '18px 0', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 },
  list: { borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(191,225,146,0.14)', background: 'rgba(5,10,7,0.68)' },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 58,
    padding: '11px 12px',
    border: 0,
    borderBottom: '1px solid var(--border2)',
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
  },
  taskHour: { width: 48, flexShrink: 0, color: 'var(--info)', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  taskMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  taskTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  taskMeta: { fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  statusPill: {
    flexShrink: 0,
    borderRadius: 999,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card2)',
    color: 'var(--text-sub)',
    padding: '4px 9px',
    fontSize: 11,
    fontWeight: 750,
  },
  statusUrgent: { color: 'var(--danger)', background: 'rgba(248,113,113,0.12)', borderColor: 'rgba(248,113,113,0.24)' },
  actionList: { borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(191,225,146,0.14)', background: 'rgba(5,10,7,0.68)' },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 58,
    padding: '12px 14px',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-card2)',
    border: '1px solid var(--border2)',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  actionText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  actionLabel: { fontSize: 14, fontWeight: 750, color: 'var(--text)' },
  actionSub: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 550 },
  chevron: { fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 },
  hairline: { height: 1, marginLeft: 58, background: 'var(--border2)' },
  footerNote: { marginTop: 18, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 },
};
