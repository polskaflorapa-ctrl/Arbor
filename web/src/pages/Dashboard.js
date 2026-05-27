import { Fragment, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import OpsRadar from '../components/OpsRadar';
import TelemetryStatus from '../components/TelemetryStatus';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import {
  CREW_REQUIRED_TASK_STATUSES,
  getTaskStatusColor,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
} from '../utils/taskWorkflow';

function taskDateKey(task) {
  return String(task?.data_planowana || task?.data_wykonania || '').slice(0, 10);
}

function moneyCompact(value) {
  return `${(Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`;
}

function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(value) / Number(total)) * 100)));
}

function formatOrderId(task) {
  return task?.numer || task?.kod || `ZLE-${String(task?.id || '').padStart(4, '0')}`;
}

function formatTaskDate(task) {
  const raw = task?.data_planowana || task?.data_wykonania;
  if (!raw) return 'Brak terminu';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return String(raw).slice(0, 10);
  return dt.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTaskTime(task) {
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  const raw = task?.data_planowana || '';
  if (String(raw).includes('T')) return String(raw).slice(11, 16);
  return '--:--';
}

function getTaskLocation(task) {
  return task?.miasto || task?.oddzial_nazwa || task?.adres || 'Brak lokalizacji';
}

function teamDisplayName(task) {
  if (task?.ekipa_nazwa) return task.ekipa_nazwa;
  if (task?.ekipa_id) return `Ekipa #${task.ekipa_id}`;
  return 'Nieprzypisana';
}

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function canViewTeamRanking(user) {
  const role = normalizeRole(user?.rola);
  return ['prezes', 'dyrektor', 'administrator', 'kierownik'].includes(role) ||
    (role.includes('dyrektor') && role.includes('sprzed'));
}

function currentRankingParams() {
  const now = new Date();
  return { rok: now.getFullYear(), miesiac: now.getMonth() + 1 };
}

function teamRankingScope(row, fallback = '') {
  const home = row?.ekipa_oddzial_nazwa || '';
  const target = row?.oddzial_nazwa || '';
  if ((Number(row?.delegowane_zadania) || 0) > 0 && home && target && home !== target) {
    return `${home} -> ${target}`;
  }
  return target || home || fallback || 'Oddzial';
}

function pickDashboardWeek(ranking) {
  const weeks = ranking?.weeks || [];
  if (!weeks.length) return null;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return weeks.find((week) => week.start <= today && week.end >= today) || weeks.find((week) => week.winner) || weeks[0];
}

function dashboardTaskKey(task, index, scope) {
  const stableId = task?.id ?? task?.numer ?? task?.kod ?? task?.uuid;
  return stableId ? `${scope}-${stableId}-${index}` : `${scope}-row-${index}`;
}

function isDashboardOperationalTask(task) {
  const id = Number(task?.id);
  const client = String(task?.klient_nazwa || '').trim().toLowerCase();
  const description = String(task?.opis || task?.opis_pracy || '').trim().toLowerCase();
  const searchable = [
    task?.numer,
    task?.kod,
    task?.klient_nazwa,
    task?.opis,
    task?.opis_pracy,
    task?.notatki_wewnetrzne,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const isLegacyTestFixture =
    Number.isFinite(id) &&
    id < 100 &&
    client.startsWith('test klient') &&
    description.startsWith('testowe zlecenie');
  const isSmokeFixture = /\bsmoke\b/.test(searchable);
  return !isLegacyTestFixture && !isSmokeFixture;
}

function AnimatedNumber({ value, duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const start = Date.now();
    const end = parseFloat(value) || 0;
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      setDisplay(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span>{display.toLocaleString('pl-PL')}</span>;
}

const QL_CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// SVG ikony KPI i quick links
const KPI_ICONS = {
  nowe:       <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/></svg>,
  realizacja: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  zakonczone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  wartosc:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
};
const QL_ICONS = {
  '/nowe-zlecenie': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  '/kierownik':     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  '/ekipy':         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  '/raporty':       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  '/raport-dzienny': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  '/raporty-mobilne': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  '/misja-dnia': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  '/autoplan-dnia': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3v18M3 12h18"/><path d="m7 12 2 2 4-4 4 4"/></svg>,
  '/kpi-tydzien': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3v18h18"/><path d="m7 13 3 3 7-7"/></svg>,
  '/ranking-brygad': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5 7 22l5-3 5 3-1.5-9.5"/><path d="M9.5 8 11 9.5 14.5 6"/></svg>,
  '/flota':         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  '/harmonogram':   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  '/oddzialy':      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  '/uzytkownicy':   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  '/ksiegowosc':    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  '/wycena-kalendarz': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="4" height="4" rx="0.5"/></svg>,
  '/blokady-kalendarza': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 17l2-2 2 2 4-4"/></svg>,
  '/zatwierdz-wyceny': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  '/wynagrodzenie-wyceniajacych': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  '/zarzadzaj-rolami': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
};

const CMD_ICONS = {
  zlecenia: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  ),
  harmonogram: QL_ICONS['/harmonogram'],
  powiadomienia: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

/** Wspólne style listy „inset” (KPI, centrum operacyjne). Kategorie skrótów web — ścieżki jak na mobilce. */
const WEB_QUICK_CAT_ORDER = ['operations', 'quotes', 'fleetMagazyn', 'reports', 'finance', 'administration'];

const WEB_QUICK_CAT_TITLE = {
  operations: 'Operacje i plan',
  quotes: 'Wyceny i teren',
  fleetMagazyn: 'Flota i sprzęt',
  reports: 'Raporty',
  finance: 'Finanse',
  administration: 'Administracja',
};

function webQuickCategory(path) {
  if (['/zarzadzaj-rolami', '/uzytkownicy', '/oddzialy'].includes(path)) return 'administration';
  if (path === '/ksiegowosc' || path === '/wynagrodzenie-wyceniajacych') return 'finance';
  if (
    path === '/raporty' ||
    path === '/ranking-brygad' ||
    path.startsWith('/raporty/') ||
    ['/raport-dzienny', '/raporty-mobilne', '/misja-dnia', '/autoplan-dnia', '/kpi-tydzien'].includes(path)
  )
    return 'reports';
  if (['/wycena-kalendarz', '/blokady-kalendarza', '/zatwierdz-wyceny', '/wyceniajacy-hub'].includes(path))
    return 'quotes';
  if (['/flota', '/magazyn', '/rezerwacje-sprzetu'].includes(path)) return 'fleetMagazyn';
  return 'operations';
}

const INSET_LIST = {
  group: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
  },
  hairline: {
    height: 1,
    marginLeft: 56,
    background: 'var(--border)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 52,
    padding: '12px 14px',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    transition: 'background 0.12s ease',
    boxSizing: 'border-box',
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: 'var(--text-sub)',
    background: 'var(--surface-field)',
    border: '1px solid var(--border)',
  },
  rowTexts: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-start',
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: 0,
    color: 'var(--text)',
    lineHeight: 1.25,
  },
  rowSub: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-muted)',
    lineHeight: 1.3,
  },
  rowChevron: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    color: 'var(--text-muted)',
    opacity: 0.75,
  },
};

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [allTasks, setAllTasks] = useState([]);
  const [ostatnie, setOstatnie] = useState([]);
  const [teamRankingApi, setTeamRankingApi] = useState(null);
  const [payrollClose, setPayrollClose] = useState({
    export_allowed: true,
    pending_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const isCompact = viewportWidth < 900;
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setError('');
      const token = getStoredToken();
      const h = authHeaders(token);
      const actor = readStoredUser();
      const rankingParams = currentRankingParams();
      const rankingReq = canViewTeamRanking(actor)
        ? api.get('/ekipy/ranking', { headers: h, params: rankingParams, dedupe: false }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null });
      const [zRes, rRes] = await Promise.all([
        api.get('/tasks/wszystkie', { headers: h }),
        rankingReq,
      ]);
      const taskRows = (Array.isArray(zRes.data) ? zRes.data : []).filter(isDashboardOperationalTask);
      setAllTasks(taskRows);
      setOstatnie(taskRows.slice(0, 8));
      setTeamRankingApi(rRes.data || null);
      try {
        const month = new Date().toISOString().slice(0, 7);
        const pRes = await api.get('/payroll/month-close-status', {
          headers: h,
          params: { month },
        });
        setPayrollClose({
          export_allowed: pRes.data?.export_allowed !== false,
          pending_count: Number(pRes.data?.pending_count) || 0,
        });
      } catch {
        setPayrollClose({ export_allowed: true, pending_count: 0 });
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udało się załadować danych dashboardu.'));
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!getStoredToken()) { navigate('/'); return; }
    const u = readStoredUser();
    if (u) setUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const openSmartTaskFilter = useCallback((filterKey) => {
    if (filterKey) localStorage.setItem('zlecenia_smart_filter', filterKey);
    navigate('/zlecenia');
  }, [navigate]);

  const openTaskDetail = useCallback((taskId) => {
    if (!taskId) return;
    navigate(`/zlecenia/${taskId}`);
  }, [navigate]);

  const runDashboardSearch = useCallback((event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    navigate(`/zlecenia?search=${encodeURIComponent(query)}`);
  }, [navigate, searchQuery]);

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isWyceniajacy = user?.rola === 'Wyceniający';
  const sumaWartosci = allTasks.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const openTasks = allTasks.filter((z) => !isTaskClosed(z.status));
  const activeTasks = openTasks.filter((z) => isTaskInProgress(z.status));
  const overdueTasks = openTasks.filter((z) => {
    const day = taskDateKey(z);
    return day && day < todayIso;
  });
  const todayTasks = openTasks.filter((z) => taskDateKey(z) === todayIso);
  const unassignedTasks = openTasks.filter((z) => CREW_REQUIRED_TASK_STATUSES.has(z.status) && !z.ekipa_id);
  const statusCounts = allTasks.reduce((acc, z) => {
    const key = z.status || 'Nowe';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dzisiaj = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthTasks = allTasks.filter((z) => String(z.data_planowana || z.data_wykonania || z.created_at || '').startsWith(currentMonth));
  const monthRevenue = monthTasks.reduce((s, z) => s + (Number(z.wartosc_planowana) || 0), 0);
  const completedMonth = monthTasks.filter((z) => isTaskDone(z.status)).length;
  const allCrewNames = new Set(allTasks.filter((z) => z.ekipa_id || z.ekipa_nazwa).map(teamDisplayName));
  const activeCrewNames = new Set(activeTasks.filter((z) => z.ekipa_id || z.ekipa_nazwa).map(teamDisplayName));
  const crewAvailability = allCrewNames.size ? percent(activeCrewNames.size, allCrewNames.size) : 0;
  const branchLabel = user?.oddzial_nazwa || 'Wszystkie oddziały';
  const monthLabel = new Date().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  const topKpiData = [
    {
      label: 'Zlecenia otwarte',
      value: openTasks.length,
      sub: `${overdueTasks.length} po terminie`,
      icon: 'nowe',
      tone: overdueTasks.length ? 'danger' : 'green',
      path: '/zlecenia',
      filterKey: overdueTasks.length ? 'overdue' : '',
    },
    {
      label: 'Prace w trakcie',
      value: activeTasks.length,
      sub: `${activeCrewNames.size} ekip aktywnych`,
      icon: 'realizacja',
      tone: 'blue',
      path: '/zlecenia',
    },
    {
      label: 'Przychód miesiąca',
      value: moneyCompact(monthRevenue || sumaWartosci),
      sub: `${completedMonth} zamkniętych prac`,
      icon: 'wartosc',
      tone: 'green',
      path: '/raporty',
      isText: true,
    },
    {
      label: 'Skuteczność miesiąca',
      value: `${percent(completedMonth, monthTasks.length)}%`,
      sub: `${completedMonth} / ${monthTasks.length || 0} zleceń`,
      icon: 'zakonczone',
      tone: 'lime',
      path: '/kpi-tydzien',
      isText: true,
    },
    {
      label: 'Załogi w terenie',
      value: `${activeCrewNames.size}/${allCrewNames.size || 0}`,
      sub: `${crewAvailability}% aktywnych`,
      icon: 'realizacja',
      tone: 'blue',
      path: '/ekipy',
      isText: true,
    },
    {
      label: 'Dzisiaj w planie',
      value: todayTasks.length,
      sub: `${unassignedTasks.length} bez ekipy`,
      icon: 'nowe',
      tone: unassignedTasks.length ? 'amber' : 'green',
      path: '/harmonogram',
    },
  ];

  const quickLinks = useMemo(() => [
    { label: 'Ranking brygad', sub: 'Liderzy tygodnia i miesiaca', path: '/ranking-brygad', color: '#A3E635', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Nowe zlecenie',  sub: 'Utwórz zlecenie',       path: '/nowe-zlecenie', color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Planowanie',     sub: 'Przypisz ekipy',         path: '/kierownik',     color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Ekipy',          sub: 'Zarządzaj ekipami',      path: '/ekipy',         color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Raporty',        sub: 'Analiza wydajności',     path: '/raporty',           color: 'var(--accent-dk)', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Misja dnia', sub: 'Tryb dziś — KPI i plan', path: '/misja-dnia', color: '#38BDF8', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Autoplan dnia', sub: 'Przypisanie ekip (heurystyka)', path: '/autoplan-dnia', color: '#22D3EE', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'KPI autoplan (tydzień)', sub: 'Historia apply / rollback', path: '/kpi-tydzien', color: '#67E8F9', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Raport dzienny', sub: 'Pole — zlecenia, czasy, materiały', path: '/raport-dzienny', color: '#34D399', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Raporty mobilne', sub: 'KPI z ostatnich miesięcy', path: '/raporty-mobilne', color: '#2DD4BF', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Flota i sprzęt', sub: 'Pojazdy i narzędzia',   path: '/flota',             color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Magazyn',        sub: 'Stan lokalny (jak w aplikacji mobilnej)', path: '/magazyn', color: '#A3E635', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Rezerwacje sprzętu', sub: 'Kalendarz rezerwacji', path: '/rezerwacje-sprzetu', color: '#22D3EE', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Harmonogram',    sub: 'Kalendarz zleceń',       path: '/harmonogram',       color: '#60A5FA', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Magazynier'] },
    { label: 'Centrum specjalisty ds. wyceny', sub: 'KPI oględzin i skróty (jak w mobile)', path: '/wyceniajacy-hub', color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Wyceny',         sub: 'Kalendarz, oględziny, zatwierdzanie', path: '/wycena-kalendarz',  color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Blokady kalendarza', sub: 'Daty bez nowych wycen (też mobilka)', path: '/blokady-kalendarza', color: '#F87171', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Zatwierdzanie wycen', sub: 'Akceptacja i odrzucenie', path: '/zatwierdz-wyceny', color: '#34D399', roles: ['Kierownik','Administrator','Dyrektor','Specjalista'] },
    { label: 'Rozliczenie wyceny', sub: 'Stawka + % realizacji', path: '/wynagrodzenie-wyceniajacych', color: '#34D399', roles: ['Wyceniający','Kierownik','Dyrektor','Administrator'] },
    { label: 'Oddziały',       sub: 'Zarządzanie',            path: '/oddzialy',          color: '#60A5FA', roles: ['Dyrektor','Administrator'] },
    { label: 'Użytkownicy',    sub: 'Konta i uprawnienia',    path: '/uzytkownicy',       color: '#F87171', roles: ['Dyrektor','Administrator'] },
    { label: 'Role',           sub: 'Uprawnienia pracowników',path: '/zarzadzaj-rolami',  color: '#F59E0B', roles: ['Dyrektor','Administrator'] },
    { label: 'Księgowość',     sub: 'Faktury i rozliczenia',  path: '/ksiegowosc',        color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik'] },
  ].filter(i => i.roles.includes(user?.rola)), [user?.rola]);

  const visibleQuickLinks = useMemo(() => {
    const reportEntry = quickLinks.find((item) => webQuickCategory(item.path) === 'reports');
    const nonReports = quickLinks.filter((item) => webQuickCategory(item.path) !== 'reports');
    return reportEntry
      ? [
          ...nonReports,
          {
            ...reportEntry,
            label: 'Centrum raportow',
            sub: 'Raport dnia, KPI, misja i autoplan',
            path: '/raporty',
            color: 'var(--accent-dk)',
          },
        ]
      : nonReports;
  }, [quickLinks]);

  const quickLinkSections = useMemo(() => {
    const by = Object.fromEntries(WEB_QUICK_CAT_ORDER.map((k) => [k, []]));
    for (const item of visibleQuickLinks) {
      const c = webQuickCategory(item.path);
      (by[c] ?? by.operations).push(item);
    }
    return WEB_QUICK_CAT_ORDER
      .filter((k) => by[k].length > 0)
      .map((key) => ({
        key,
        title: WEB_QUICK_CAT_TITLE[key],
        items: by[key],
      }));
  }, [visibleQuickLinks]);

  const operationalMetrics = [
    { label: 'Wykonanie planu prac', value: percent(completedMonth, monthTasks.length || openTasks.length), meta: `${completedMonth} / ${monthTasks.length || openTasks.length || 0}` },
    { label: 'Załogi aktywne', value: crewAvailability, meta: `${activeCrewNames.size} / ${allCrewNames.size || 0}` },
    { label: 'Terminowość', value: percent(openTasks.length - overdueTasks.length, openTasks.length), meta: `${overdueTasks.length} po terminie` },
    { label: 'Obsada zleceń', value: percent(openTasks.length - unassignedTasks.length, openTasks.length), meta: `${unassignedTasks.length} bez ekipy` },
  ];
  const reportShortcuts = [
    { label: 'P&L', path: '/raporty/analityka' },
    { label: 'Prace', path: '/raporty' },
    { label: 'Załogi', path: '/kpi-tydzien' },
    { label: 'Finanse', path: '/ksiegowosc' },
  ].filter((item) => visibleQuickLinks.some((link) => link.path === item.path) || item.path === '/raporty/analityka');

  const statusLabel = (value) => String(value || 'Nowe').replace('_', ' ');

  const apiTeamRanking = useMemo(() => {
    const rows = teamRankingApi?.month?.ranking || [];
    return rows.slice(0, 5).map((row) => ({
      key: `api-${row.ekipa_id}`,
      name: row.ekipa_nazwa || `Ekipa #${row.ekipa_id}`,
      branch: teamRankingScope(row, branchLabel),
      works: Number(row.zadania || 0),
      revenue: Number(row.wartosc || 0),
      effectiveness: Number(row.skutecznosc || 0),
      score: Number(row.score || 0),
      delegations: Number(row.delegowane_zadania || 0),
    }));
  }, [branchLabel, teamRankingApi]);

  const fallbackTeamRanking = useMemo(() => {
    const map = new Map();
    for (const z of ostatnie) {
      const name = z.ekipa_nazwa || z.ekipa || 'Bez przypisanej ekipy';
      const prev = map.get(name) || { name, count: 0, value: 0, works: 0, revenue: 0, branch: z.miasto || z.oddzial_nazwa || '', effectiveness: 0 };
      prev.count += 1;
      prev.value += Number(z.wartosc_rzeczywista || z.wartosc_planowana || 0);
      prev.works += 1;
      prev.revenue += Number(z.wartosc_rzeczywista || z.wartosc_planowana || 0);
      prev.effectiveness = 0;
      if (!prev.branch) prev.branch = z.miasto || z.oddzial_nazwa || '';
      map.set(name, prev);
    }
    return Array.from(map.entries())
      .map(([key, team]) => ({ ...team, key }))
      .sort((a, b) => b.revenue - a.revenue || b.works - a.works)
      .slice(0, 5);
  }, [ostatnie]);
  const teamRanking = apiTeamRanking.length ? apiTeamRanking : fallbackTeamRanking;
  const activeRankingWeek = useMemo(() => pickDashboardWeek(teamRankingApi), [teamRankingApi]);

  const scheduleItems = useMemo(() => [...ostatnie]
    .sort((a, b) => new Date(a.data_planowana || a.data_zaplanowana || 0) - new Date(b.data_planowana || b.data_zaplanowana || 0))
    .slice(0, 6), [ostatnie]);

  const systemAlertItems = payrollClose.export_allowed
    ? []
    : [
        {
          title: 'Payroll wymaga raportów',
          sub: `Brakuje raportów dnia: ${payrollClose.pending_count}`,
          tone: 'warn',
        },
      ];

  return (
    <div className="app-shell dashboard-shell" style={d.root}>
      <Sidebar />
      <main className="app-main dashboard-main" style={d.content}>
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={d.errorBanner} />

        <header className="dashboard-topbar" style={d.topbar}>
          <div style={d.topbarTitleWrap}>
            <button type="button" style={d.menuBtn} aria-label="Menu">
              <span style={d.menuLine} />
              <span style={d.menuLine} />
              <span style={d.menuLine} />
            </button>
            <div>
              <h1 style={d.pageTitle}>Pulpit</h1>
              <div style={d.pageSub}>Oddział: {branchLabel} | {monthLabel}</div>
            </div>
          </div>
          <form style={d.searchBox} onSubmit={runDashboardSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runDashboardSearch(event);
              }}
              style={d.searchInput}
              placeholder="Szukaj zleceń, klientów, prac..."
            />
            <button type="submit" style={d.searchShortcut}>Enter</button>
          </form>
          <div style={d.topbarMeta}>
            <button type="button" onClick={() => navigate('/powiadomienia')} style={d.iconStatusBtn} aria-label="Powiadomienia">
              <span style={d.statusDot}>{systemAlertItems.length}</span>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
            <div style={d.weatherBox}>
              <strong>14°C</strong>
              <span>{branchLabel}</span>
            </div>
            <div style={d.dateBox}>
              <strong>{new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })}</strong>
              <span>{dzisiaj}</span>
            </div>
          </div>
        </header>

        {/* ─── HERO HEADER ─────────────────────────────────────────────────── */}
        <div style={d.hero}>
          <div style={d.heroBg} />
          <div style={d.heroLeft}>
            <div style={d.heroGreeting}>Dzień dobry, {user?.imie}</div>
            <div style={d.heroDate}>{dzisiaj}</div>
            <div style={d.rolaBadge}>
              {getRoleDisplayName(user?.rola)}{user?.oddzial_nazwa ? ` · ${user.oddzial_nazwa}` : ''}
            </div>
          </div>
          <div style={{ ...d.topActions, ...(isCompact ? d.topActionsCompact : {}) }}>
            <button type="button" onClick={() => navigate('/nowe-zlecenie')} style={d.primaryAction}>
              {QL_ICONS['/nowe-zlecenie']}
              Nowe zlecenie
            </button>
            <button type="button" onClick={() => navigate('/misja-dnia')} style={d.secondaryAction}>
              {QL_ICONS['/misja-dnia']}
              Misja dnia
            </button>
          </div>
        </div>

        {/* ─── KPI (grupa inset, jak iOS) ───────────────────────────────────── */}
        <section className="dashboard-kpi-grid" style={d.kpiGrid}>
          {topKpiData.map((kpi, index) => (
            <button
              key={kpi.label}
              type="button"
              onClick={() => kpi.filterKey ? openSmartTaskFilter(kpi.filterKey) : navigate(kpi.path)}
              onMouseEnter={() => setHovered(`top-kpi-${index}`)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...d.kpiCard,
                ...(d[`kpiCard_${kpi.tone}`] || {}),
                transform: hovered === `top-kpi-${index}` ? 'translateY(-2px)' : 'none',
              }}
            >
              <span style={d.kpiIcon}>{KPI_ICONS[kpi.icon]}</span>
              <span style={d.kpiCardText}>
                <span style={d.kpiCardLabel}>{kpi.label}</span>
                <strong style={d.kpiCardValue}>
                  {kpi.isText ? kpi.value : <AnimatedNumber value={kpi.value} />}
                </strong>
                <span style={d.kpiCardSub}>{kpi.sub}</span>
              </span>
            </button>
          ))}
        </section>

        {!isWyceniajacy && (
          <OpsRadar
            tasks={allTasks}
            payrollClose={payrollClose}
            onOpenFilter={openSmartTaskFilter}
            onOpenTask={openTaskDetail}
            onOpenPath={(path) => navigate(path)}
          />
        )}

        <section className="dashboard-content-grid" style={d.referenceGrid}>
          <div style={d.panelWide}>
            <div style={d.panelHeader}>
              <div>
                <h2 style={d.panelTitle}>{isBrygadzista ? 'Moje zlecenia' : 'Ostatnie zlecenia'}</h2>
                <p style={d.panelSub}>Operacyjny podgląd prac, statusów i wartości.</p>
              </div>
              <button type="button" onClick={() => navigate('/zlecenia')} style={d.linkBtn}>Zobacz wszystkie</button>
            </div>
            <div className="dashboard-orders-table" style={d.tableShell}>
              <div style={d.tableHead}>
                <span>ID</span>
                <span>Klient</span>
                <span>Status</span>
                <span>Termin</span>
                <span>Wartość</span>
              </div>
              {loading ? (
                <div style={d.tableEmpty}>Ładowanie danych...</div>
              ) : ostatnie.length === 0 ? (
                <div style={d.tableEmpty}>Brak zleceń do pokazania.</div>
              ) : (
                ostatnie.slice(0, 5).map((task, index) => (
                  <button key={dashboardTaskKey(task, index, 'recent-table')} type="button" onClick={() => navigate(`/zlecenia/${task.id}`)} style={d.tableRow}>
                    <span style={d.tableId}>{formatOrderId(task)}</span>
                    <span style={d.tableStrong}>{task.klient_nazwa || 'Brak klienta'}</span>
                    <span>
                      <TelemetryStatus value={task.status} label={statusLabel(task.status)} />
                    </span>
                    <span>{formatTaskDate(task)}</span>
                    <span style={d.tableValue}>{task.wartosc_planowana ? moneyCompact(task.wartosc_planowana) : '-'}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <h2 style={d.panelTitle}>Ranking załóg</h2>
                <p style={d.panelSub}>Miesiąc: {monthLabel}</p>
              </div>
              <button type="button" onClick={() => navigate('/ranking-brygad')} style={d.linkBtn}>Ranking</button>
            </div>
            <div style={d.rankingList}>
              {activeRankingWeek?.winner && (
                <button type="button" onClick={() => navigate('/ranking-brygad')} style={d.rankingLeader}>
                  Tydzien: {activeRankingWeek.winner.ekipa_nazwa} | {Number(activeRankingWeek.winner.score || 0).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} pkt
                </button>
              )}
              {teamRanking.length === 0 ? (
                <div style={d.tableEmpty}>Brak danych załóg.</div>
              ) : teamRanking.map((team, index) => (
                <button key={team.key} type="button" onClick={() => navigate('/ranking-brygad')} style={d.rankingRow}>
                  <span style={{ ...d.placeBadge, ...(index < 3 ? d[`placeBadge_${index}`] : {}) }}>{index + 1}</span>
                  <span style={d.teamLeaf} aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 22V8" />
                      <path d="M5 12c0-5 4-8 7-10 3 2 7 5 7 10 0 4-3 7-7 7s-7-3-7-7Z" />
                      <path d="M12 16c2-2 4-4 6-4" />
                      <path d="M12 14c-2-2-4-3-6-3" />
                    </svg>
                  </span>
                  <span style={d.rankingName}>
                    <strong>{team.name}</strong>
                    <small>{team.branch || branchLabel}{team.delegations ? ` | delegacje: ${team.delegations}` : ''}</small>
                  </span>
                  <span style={d.rankingMetric}>{team.score ? `${team.score} pkt` : team.works}</span>
                  <span style={d.rankingMetric}>{moneyCompact(team.revenue)}</span>
                  <span style={d.rankingMetric}>{team.effectiveness}%</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="dashboard-lower-grid" style={d.lowerGrid}>
          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <h2 style={d.panelTitle}>Harmonogram prac</h2>
                <p style={d.panelSub}>Dziś | {dzisiaj}</p>
              </div>
              <button type="button" onClick={() => navigate('/harmonogram')} style={d.linkBtn}>Pełny kalendarz</button>
            </div>
            <div style={d.scheduleList}>
              {scheduleItems.length === 0 ? (
                <div style={d.tableEmpty}>Brak zaplanowanych prac na dziś.</div>
              ) : scheduleItems.map((task, index) => (
                <button key={dashboardTaskKey(task, index, 'schedule')} type="button" onClick={() => navigate(`/zlecenia/${task.id}`)} style={d.scheduleRow}>
                  <span style={d.scheduleTime}>{formatTaskTime(task)}</span>
                  <span style={d.scheduleMain}>
                    <strong>{task.typ_uslugi || task.klient_nazwa || 'Zlecenie'}</strong>
                    <small>{getTaskLocation(task)} | {teamDisplayName(task)}</small>
                  </span>
                  <span style={d.scheduleArrow}>{QL_CHEVRON}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <h2 style={d.panelTitle}>Powiadomienia systemowe</h2>
                <p style={d.panelSub}>Komunikaty spoza radaru decyzji.</p>
              </div>
            </div>
            <div style={d.alertList}>
              {systemAlertItems.length === 0 ? (
                <div style={d.alertEmpty}>Brak dodatkowych alarmów systemowych.</div>
              ) : (
                systemAlertItems.map((alert, index) => (
                  <button key={`${alert.title}-${index}`} type="button" onClick={() => navigate('/powiadomienia')} style={d.alertRow}>
                    <span style={{ ...d.alertIcon, ...(d[`alertIcon_${alert.tone}`] || {}) }} />
                    <span style={d.alertText}>
                      <strong>{alert.title}</strong>
                      <small>{alert.sub}</small>
                    </span>
                    <span style={d.scheduleArrow}>{QL_CHEVRON}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <h2 style={d.panelTitle}>Wskaźniki operacyjne</h2>
                <p style={d.panelSub}>Aktualny puls firmy.</p>
              </div>
            </div>
            <div style={d.metricList}>
              {operationalMetrics.map((metric) => (
                <div key={metric.label} style={d.metricRow}>
                  <div style={d.metricTop}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}%</strong>
                  </div>
                  <div style={d.progressTrack}>
                    <span style={{ ...d.progressFill, width: `${metric.value}%` }} />
                  </div>
                  <small style={d.metricMeta}>{metric.meta}</small>
                </div>
              ))}
            </div>
            <div style={d.reportShortcuts}>
              {reportShortcuts.map((item) => (
                <button key={item.path} type="button" onClick={() => navigate(item.path)} style={d.reportBtn}>{item.label}</button>
              ))}
            </div>
          </div>
        </section>

        <section style={d.shortcutPanel}>
          <div style={d.panelHeader}>
            <div>
              <h2 style={d.panelTitle}>Skróty modułów</h2>
              <p style={d.panelSub}>Najczęściej używane ścieżki dla Twojej roli.</p>
            </div>
          </div>
          <div className="dashboard-shortcuts-grid" style={d.shortcutGrid}>
            {quickLinkSections.slice(0, 4).map((sec) => (
              <div key={sec.key} style={d.shortcutGroup}>
                <div style={d.shortcutGroupTitle}>{sec.title}</div>
                {sec.items.slice(0, 3).map((item) => (
                  <button key={item.path} type="button" onClick={() => navigate(item.path)} style={d.shortcutRow}>
                    <span style={{ ...d.shortcutDot, background: item.color || 'var(--accent)' }} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <div style={d.commandGrid}>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Centrum operacyjne</div>
            <div style={d.commandText}>Priorytetowe akcje na teraz</div>
            <div style={d.insetGroupLift}>
              {[
                { label: 'Zarządzaj zleceniami', sub: 'Lista i statusy zleceń', path: '/zlecenia', icon: 'zlecenia' },
                { label: 'Sprawdź harmonogram', sub: 'Plan dnia i ekip', path: '/harmonogram', icon: 'harmonogram' },
                { label: 'Powiadomienia', sub: 'Alerty systemowe', path: '/powiadomienia', icon: 'powiadomienia' },
              ].map((row, i) => (
                <Fragment key={row.path}>
                  {i > 0 ? <div style={d.insetHairline} /> : null}
                  <button
                    type="button"
                    onClick={() => navigate(row.path)}
                    onMouseEnter={() => setHovered(`cmd${i}`)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      ...d.insetRow,
                      background: hovered === `cmd${i}` ? 'rgba(255,255,255,0.06)' : 'var(--surface-field)',
                    }}
                  >
                    <span style={d.insetIconTile}>{CMD_ICONS[row.icon]}</span>
                    <span style={d.insetRowTexts}>
                      <span style={d.insetRowTitle}>{row.label}</span>
                      <span style={d.insetRowSub}>{row.sub}</span>
                    </span>
                    <span style={d.insetRowChevron}>{QL_CHEVRON}</span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Pipeline live</div>
            <div style={d.commandText}>Zlecenia w ostatniej próbce (max 8)</div>
            <div style={d.insetGroupLift}>
              {[
                { label: 'Nowe', value: statusCounts.Nowe || 0 },
                { label: 'Oględziny / wycena', value: statusCounts.Wycena_Terenowa || 0 },
                { label: 'Do zatwierdzenia', value: statusCounts.Do_Zatwierdzenia || 0 },
                { label: 'Zaplanowane', value: statusCounts.Zaplanowane || 0 },
                { label: 'W realizacji', value: statusCounts.W_Realizacji || 0 },
                { label: 'Zakończone', value: statusCounts.Zakonczone || 0 },
              ].map((row, i) => (
                <Fragment key={row.label}>
                  {i > 0 ? <div style={d.pipeHairline} /> : null}
                  <div style={d.pipeRow}>
                    <span style={d.pipeLabel}>{row.label}</span>
                    <span style={d.pipeValue}>{row.value}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* ─── GŁÓWNA SIATKA ───────────────────────────────────────────────── */}
        <div style={d.mainGrid}>

          {/* Ostatnie zlecenia */}
          {!isWyceniajacy && (
            <div style={d.card}>
              <div style={d.cardHeader}>
                <span style={d.cardTitle}>{isBrygadzista ? 'Moje zlecenia' : 'Ostatnie zlecenia'}</span>
                <button onClick={() => navigate('/zlecenia')} style={d.seeAll}>
                  Wszystkie
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>

              {loading ? (
                <div style={d.emptyState}>
                  <div style={d.spinner} />
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>Ładowanie...</p>
                </div>
              ) : ostatnie.length === 0 ? (
                <div style={d.emptyState}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Brak zleceń</p>
                </div>
              ) : ostatnie.map((z, i) => (
                <div key={dashboardTaskKey(z, i, 'recent-card')}
                  onClick={() => navigate(`/zlecenia/${z.id}`)}
                  onMouseEnter={() => setHovered(`z${z.id}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ ...d.zRow, borderLeftColor: getTaskStatusColor(z.status, '#334155'),
                    background: hovered === `z${z.id}` ? 'rgba(20,131,79,0.06)' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={d.zKlient}>{z.klient_nazwa}</div>
                    <div style={d.zMeta}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {z.adres}{z.typ_uslugi ? ` · ${z.typ_uslugi}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <TelemetryStatus value={z.status} label={z.status?.replace('_', ' ')} />
                    {!isBrygadzista && z.wartosc_planowana && (
                      <div style={d.zWartosc}>{parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Szybki dostęp — kategorie + listy inset (iOS) */}
          <div style={{ ...d.card, ...(isWyceniajacy ? { gridColumn: '1 / -1' } : {}) }}>
            <div style={d.cardHeader}>
              <span style={d.cardTitle}>Szybki dostęp</span>
            </div>
            {quickLinks.length === 0 ? (
              <div style={d.qlEmpty}>Brak skrótów dla tej roli.</div>
            ) : (
              quickLinkSections.map((sec, si) => (
                <div key={sec.key} style={si === 0 ? d.quickSectionWrapFirst : d.quickSectionWrap}>
                  <div style={d.quickSectionTitle}>{sec.title}</div>
                  <div style={d.insetGroup}>
                    {sec.items.map((item, i) => (
                      <Fragment key={`${sec.key}-${item.path}-${i}`}>
                        {i > 0 ? <div style={d.insetHairline} /> : null}
                        <button
                          type="button"
                          onClick={() => navigate(item.path)}
                          onMouseEnter={() => setHovered(`ql-${sec.key}-${i}`)}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            ...d.insetRow,
                            background: hovered === `ql-${sec.key}-${i}` ? 'rgba(255,255,255,0.06)' : 'var(--surface-field)',
                          }}
                        >
                          <span style={d.insetIconTile}>
                            {QL_ICONS[item.path] || (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" />
                              </svg>
                            )}
                          </span>
                          <span style={d.insetRowTexts}>
                            <span style={d.insetRowTitle}>{item.label}</span>
                            <span style={d.insetRowSub}>{item.sub}</span>
                          </span>
                          <span style={d.insetRowChevron}>{QL_CHEVRON}</span>
                        </button>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const d = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    background: '#f5f6f8',
  },
  content: { flex: 1, padding: '18px clamp(16px, 2.4vw, 28px) 28px', overflowX: 'hidden', minWidth: 0, position: 'relative' },
  errorBanner: {
    padding: '10px 14px',
    borderRadius: 12,
    border: '1px solid rgba(255,61,113,0.28)',
    background: 'rgba(255,61,113,0.1)',
    color: 'var(--danger)',
    marginBottom: 16,
    fontSize: 14,
    fontWeight: 600,
  },
  topbar: {
    minHeight: 68,
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 520px) auto',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
    padding: '14px 16px',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: 'var(--shadow-sm)',
  },
  topbarTitleWrap: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
  menuBtn: {
    width: 36,
    height: 36,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--accent)',
    display: 'inline-flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
    flexShrink: 0,
  },
  menuLine: { width: 15, height: 2, borderRadius: 4, background: 'currentColor', opacity: 0.86 },
  pageTitleLegacy: { margin: 0, fontSize: 22, lineHeight: 1.1, fontWeight: 900, color: 'var(--text)' },
  pageSub: { marginTop: 4, fontSize: 12, color: 'var(--text-muted)', fontWeight: 750, textTransform: 'capitalize' },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.92)',
    color: 'var(--text-muted)',
    padding: '0 10px',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    color: '#323338',
    outline: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
  searchShortcut: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '2px 6px',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 850,
  },
  topbarMeta: { display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' },
  iconStatusBtn: {
    position: 'relative',
    width: 36,
    height: 36,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  statusDot: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 99,
    background: '#f2b84b',
    color: '#1b1203',
    fontSize: 10,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherBox: { display: 'flex', flexDirection: 'column', gap: 1, color: 'var(--text)', fontSize: 12, fontWeight: 850, border: '1px solid var(--glass-border)', borderRadius: 8, padding: '7px 10px', background: 'var(--surface-field)' },
  dateBox: { display: 'flex', flexDirection: 'column', gap: 1, color: 'var(--text)', fontSize: 12, fontWeight: 850, border: '1px solid var(--glass-border)', borderRadius: 8, padding: '7px 10px', background: 'var(--surface-field)' },
  kpiGridLegacy: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(145px, 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  kpiCardLegacy: {
    minHeight: 104,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: 14,
    display: 'grid',
    gridTemplateColumns: '42px 1fr',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiCard_green: { borderLeftColor: '#00c875' },
  kpiCard_lime:  { borderLeftColor: '#00c875' },
  kpiCard_blue:  { borderLeftColor: '#579bfc' },
  kpiCard_amber: { borderLeftColor: '#fdab3d' },
  kpiCard_danger:{ borderLeftColor: '#e2445c' },
  kpiIconLegacy: {
    width: 42,
    height: 42,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    background: 'var(--logo-tint-bg)',
    border: '1px solid var(--logo-tint-border)',
  },
  kpiCardText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  kpiCardLabelLegacy: { fontSize: 11, color: 'var(--text-sub)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.2 },
  kpiCardValueLegacy: { fontSize: 24, color: 'var(--text)', fontWeight: 950, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' },
  kpiCardSub: { fontSize: 12, color: '#676879', fontWeight: 600, lineHeight: 1.25 },
  referenceGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.05fr) minmax(360px, .95fr)',
    gap: 14,
    marginBottom: 14,
  },
  lowerGridLegacy: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 1.25fr) minmax(300px, .9fr) minmax(300px, .9fr)',
    gap: 14,
    marginBottom: 14,
  },
  panelLegacy: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--surface-glass), var(--surface-field))',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
  },
  panelWide: {
    border: '1px solid rgba(15,95,58,0.12)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 12px 32px rgba(16,34,24,0.08)',
    overflow: 'hidden',
  },
  panelHeaderLegacy: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
  },
  panelTitleLegacy: { margin: 0, fontSize: 15, color: 'var(--text)', fontWeight: 950, textTransform: 'uppercase', lineHeight: 1.25 },
  panelSubLegacy: { margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  linkBtn: {
    border: 'none',
    background: 'transparent',
    color: '#579bfc',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  tableShell: { padding: '0 14px 14px', overflowX: 'auto' },
  tableHeadLegacy: {
    display: 'grid',
    gridTemplateColumns: '110px minmax(190px, 1.3fr) minmax(110px, .8fr) 110px 100px 100px',
    gap: 12,
    minWidth: 0,
    padding: '12px 0 9px',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)',
  },
  tableRowLegacy: {
    display: 'grid',
    gridTemplateColumns: '110px minmax(190px, 1.3fr) minmax(110px, .8fr) 110px 100px 100px',
    gap: 12,
    alignItems: 'center',
    minWidth: 760,
    width: '100%',
    minHeight: 46,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-sub)',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 750,
  },
  tableId: { color: 'var(--text)', fontWeight: 900 },
  tableStrongLegacy: { color: 'var(--text)', fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tableValue: { color: 'var(--text)', fontWeight: 900, textAlign: 'right' },
  tableEmpty: { padding: 18, color: 'var(--text-muted)', fontSize: 13, fontWeight: 750 },
  rankingList: { padding: '8px 12px 12px' },
  rankingLeader: {
    width: '100%',
    marginBottom: 8,
    padding: '8px 10px',
    borderRadius: 4,
    border: '1px solid #e6e9ef',
    borderLeft: '3px solid #00c875',
    background: '#ffffff',
    color: '#323338',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rankingRow: {
    display: 'grid',
    gridTemplateColumns: '34px 34px minmax(120px, 1fr) 44px 86px 52px',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minHeight: 46,
    border: 'none',
    borderBottom: '1px solid #e6e9ef',
    borderRadius: 0,
    background: '#ffffff',
    color: '#323338',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  placeBadge: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '1px solid #e6e9ef',
    color: '#676879',
    background: '#f5f6f8',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  placeBadge_0: { color: '#f2b84b', border: '1px solid #f2b84b' },
  placeBadge_1: { color: '#cbd5e1', border: '1px solid #cbd5e1' },
  placeBadge_2: { color: '#c47f3b', border: '1px solid #c47f3b' },
  teamLeaf: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'var(--logo-tint-bg)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankingName: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  rankingMetric: { color: '#323338', fontSize: 12, fontWeight: 700, textAlign: 'right' },
  scheduleList: { padding: '8px 12px 12px' },
  scheduleRow: {
    display: 'grid',
    gridTemplateColumns: '52px 1fr 20px',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 44,
    border: 'none',
    borderBottom: '1px solid #e6e9ef',
    borderRadius: 0,
    background: '#ffffff',
    color: '#323338',
    cursor: 'pointer',
    textAlign: 'left',
    padding: '0 12px',
    fontFamily: 'inherit',
  },
  scheduleTime: { color: '#676879', fontWeight: 600, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  scheduleMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  scheduleArrow: { color: '#b3b7cb', display: 'inline-flex', justifyContent: 'flex-end' },
  alertListLegacy: { padding: '8px 12px 12px' },
  alertRowLegacy: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr 22px',
    gap: 9,
    alignItems: 'center',
    width: '100%',
    minHeight: 48,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  alertIcon: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: '#579bfc' },
  alertIcon_danger:  { background: '#e2445c' },
  alertIcon_warning: { background: '#fdab3d' },
  alertIcon_info:    { background: '#579bfc' },
  alertIcon_success: { background: '#00c875' },
  alertText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
  alertEmpty: { padding: '18px 14px', color: '#676879', fontSize: 12, fontWeight: 600 },
  metricList: { padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 },
  metricRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  metricTop: { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#323338', fontSize: 12, fontWeight: 600 },
  progressTrack: { height: 6, borderRadius: 8, overflow: 'hidden', background: '#e6e9ef' },
  progressFillLegacy: { display: 'block', height: '100%', borderRadius: 8, background: '#579bfc' },
  metricMeta: { color: '#676879', fontSize: 11, fontWeight: 500 },
  reportShortcuts: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 14px 14px' },
  reportBtn: {
    minHeight: 30,
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    background: '#f5f6f8',
    color: '#676879',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  shortcutPanel: {
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    background: '#ffffff',
    boxShadow: 'none',
    marginBottom: 14,
    overflow: 'hidden',
  },
  shortcutGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 0, padding: 0, borderTop: '1px solid #e6e9ef' },
  shortcutGroup: { border: 'none', borderRight: '1px solid #e6e9ef', background: '#ffffff', padding: '12px 14px', minWidth: 0 },
  shortcutGroupTitle: { color: '#676879', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 },
  shortcutRow: {
    width: '100%',
    minHeight: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    background: 'transparent',
    color: '#323338',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  shortcutDot: { display: 'none' },

  // Hero
  hero: {
    display: 'flex',
    position: 'relative', borderRadius: 8, padding: '26px 28px', marginBottom: 18,
    justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(135deg, #07301f 0%, #0f6b3f 58%, #2fbe72 100%)',
    border: '1px solid rgba(255,255,255,0.24)', overflow: 'hidden',
    boxShadow: 'var(--shadow-md)',
  },
  heroCompact: {
    padding: '26px 16px 20px',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    borderRadius: 8,
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  heroBg: {
    display: 'block', position: 'absolute', top: -94, right: -72, width: 300, height: 300,
    borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.22), transparent 66%)',
    pointerEvents: 'none',
  },
  heroLeft: { position: 'relative' },
  heroLeftCompact: { minWidth: 0 },
  heroGreeting: { fontSize: 30, fontWeight: 950, color: '#ffffff', marginBottom: 4 },
  heroGreetingCompact: { fontSize: 24, lineHeight: 1.18 },
  heroDate: { fontSize: 13, color: 'rgba(255,255,255,0.78)', marginBottom: 12, textTransform: 'capitalize', fontWeight: 750 },
  rolaBadge: { display: 'inline-block', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 850, background: 'rgba(255,255,255,0.16)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)' },
  heroBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
    background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s',
    position: 'relative', flexShrink: 0, boxShadow: 'var(--shadow-sm)',
  },
  heroBtnCompact: {
    width: 'calc(100vw - 116px)',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 46,
    maxWidth: '100%',
  },

  insetGroup: INSET_LIST.group,
  insetGroupLift: { ...INSET_LIST.group, marginTop: 12 },
  insetHairline: INSET_LIST.hairline,
  insetRow: INSET_LIST.row,
  insetRowCompact: { gap: 10, padding: '11px 12px', minHeight: 50 },
  kpiRowCompact: { flexWrap: 'wrap' },
  insetIconTile: INSET_LIST.iconTile,
  insetRowTexts: INSET_LIST.rowTexts,
  insetRowTitle: INSET_LIST.rowTitle,
  insetRowSub: INSET_LIST.rowSub,
  insetRowChevron: INSET_LIST.rowChevron,
  pipeHairline: {
    height: 1,
    marginLeft: 14,
    marginRight: 14,
    background: 'var(--border)',
  },
  pipeRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    padding: '11px 14px',
    background: 'var(--surface-field)',
  },
  pipeLabel: { fontSize: 15, fontWeight: 500, color: 'var(--text-sub)' },
  pipeValue: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: 0,
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text)',
  },
  commandGrid: { display: 'none', gridTemplateColumns: '1.3fr .9fr', gap: 16, marginBottom: 20 },
  commandCard: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 18,
    boxShadow: 'var(--shadow-sm)',
  },
  commandTitle: { fontSize: 16, fontWeight: 700, letterSpacing: 0, color: 'var(--text)' },
  commandText: { marginTop: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' },

  // Main grid
  mainGrid: { display: 'none', gridTemplateColumns: '1.5fr 1fr', gap: 20 },
  card: {
    background: 'var(--surface-glass)',
    borderRadius: 8, padding: 18, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)'
  },
  cardCompact: { padding: 16, borderRadius: 14, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardHeaderCompact: { alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  seeAll: { fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0' },
  spinner: { width: 28, height: 28, border: '2px solid var(--border)', borderTop: '2px solid #34D399', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },

  // Zlecenia
  zRow: {
    display: 'flex', alignItems: 'center', padding: '10px 10px 10px 14px',
    borderLeft: '3px solid #334155', borderRadius: '0 10px 10px 0',
    marginBottom: 6, cursor: 'pointer', transition: 'all 0.15s',
  },
  zRowCompact: { alignItems: 'stretch', gap: 8, padding: '10px 10px 10px 12px' },
  zKlient: { fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  zMeta: { fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 },
  statusBadge: { fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '3px 10px', display: 'inline-block', marginBottom: 3 },
  zWartosc: { fontSize: 12, fontWeight: 700, color: 'var(--accent)' },

  qlEmpty: {
    padding: '18px 14px',
    fontSize: 13,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    marginBottom: 18,
  },
  topBarCompact: { flexDirection: 'column', alignItems: 'stretch' },
  topTitleGroup: { minWidth: 0 },
  pageTitle: { fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.15 },
  topMeta: { marginTop: 5, fontSize: 13, fontWeight: 600, color: 'var(--text-sub)' },
  topActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  topActionsCompact: { width: '100%', display: 'grid', gridTemplateColumns: '1fr', alignItems: 'stretch' },
  primaryAction: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.28)',
    background: '#ffffff',
    color: '#0f6b3f',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: 'none',
    letterSpacing: 0,
    textTransform: 'none',
  },
  secondaryAction: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.26)',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 750,
    cursor: 'pointer',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 16,
    border: 'none',
    borderRadius: 0,
    overflow: 'visible',
    background: 'transparent',
  },
  kpiGridNarrow: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  kpiGridCompact: { gridTemplateColumns: 'minmax(0, 1fr)' },
  kpiCard: {
    minHeight: 112,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    borderLeft: '5px solid var(--accent)',
    background: '#ffffff',
    color: '#323338',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
    width: '100%',
  },
  kpiCardHover: { background: '#f5f6f8' },
  kpiIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: '1px solid rgba(15,95,58,0.12)',
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
  },
  kpiCardBody: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  kpiCardLabel: { fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0 },
  kpiCardValue: { marginTop: 6, fontSize: 26, fontWeight: 950, color: '#0b3825', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' },
  kpiCardTrend: { marginTop: 6, fontSize: 12, fontWeight: 600, color: '#676879' },
  boardGrid: { display: 'grid', gridTemplateColumns: '1.14fr .86fr', gap: 12, marginBottom: 12 },
  lowerGrid: { display: 'grid', gridTemplateColumns: '1.1fr .85fr .9fr', gap: 12, marginBottom: 12 },
  panel: {
    minWidth: 0,
    borderRadius: 4,
    border: '1px solid #e6e9ef',
    background: '#ffffff',
    boxShadow: 'none',
    overflow: 'hidden',
    backdropFilter: 'none',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 14px 12px',
    borderBottom: '1px solid #e6e9ef',
  },
  panelTitle: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#323338', textTransform: 'uppercase', letterSpacing: '0.08em' },
  panelSub: { marginTop: 4, fontSize: 12, fontWeight: 500, color: '#676879' },
  panelLink: {
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    background: '#f5f6f8',
    color: '#676879',
    minHeight: 28,
    padding: '0 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  table: { overflowX: 'hidden' },
  tableRow: {
    width: '100%',
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: '64px minmax(86px,1fr) 94px 76px 68px',
    gap: 8,
    alignItems: 'center',
    padding: '10px 10px 10px 12px',
    border: 'none',
    borderLeft: '3px solid transparent',
    borderBottom: '1px solid rgba(15,95,58,0.1)',
    background: '#ffffff',
    color: 'var(--text)',
    textAlign: 'left',
    font: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
  tableHead: {
    display: 'grid',
    gridTemplateColumns: '64px minmax(86px,1fr) 94px 76px 68px',
    gap: 8,
    minWidth: 0,
    padding: '8px 10px 8px 12px',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-display)',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderBottom: '1px solid rgba(15,95,58,0.1)',
    background: 'rgba(20,91,54,0.045)',
    cursor: 'default',
  },
  tableCode: { color: 'var(--text-muted)', fontWeight: 750, fontFamily: 'var(--font-mono)' },
  tableStrong: { color: 'var(--text)', fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tableMoney: { color: 'var(--text)', fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap' },
  rankList: { padding: '4px 12px 12px' },
  rankRow: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '34px 34px minmax(0,1fr) 44px 112px',
    gap: 10,
    alignItems: 'center',
    padding: '10px 0',
    border: 'none',
    borderBottom: '1px solid #e6e9ef',
    background: 'transparent',
    color: '#323338',
    textAlign: 'left',
    cursor: 'pointer',
  },
  rankPlace: { width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' },
  rankPlaceLead: { color: '#eab308', borderColor: 'rgba(234,179,8,0.5)', background: 'rgba(234,179,8,0.12)' },
  rankLeaf: { color: 'var(--accent)', display: 'grid', placeItems: 'center' },
  rankName: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  rankMetric: { fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  timeline: { padding: '6px 14px 14px' },
  timelineRow: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '58px minmax(0,1fr) 92px',
    gap: 10,
    alignItems: 'center',
    minHeight: 38,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-sub)',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
  },
  timelineDate: { color: 'var(--info)', fontFamily: 'var(--font-mono)', fontWeight: 800 },
  timelineName: { color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  timelineBranch: { textAlign: 'right', color: 'var(--text-muted)' },
  emptyLine: { padding: '14px 0', color: 'var(--text-muted)', fontSize: 13 },
  alertList: { padding: '0' },
  alertRow: {
    display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px',
    borderBottom: '1px solid #e6e9ef', background: '#ffffff', color: '#323338',
    borderRadius: 0, border: 'none', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#e6e9ef',
    width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  },
  alertDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  alertWarn: { background: '#fdab3d' },
  alertOk: { background: '#00c875' },
  alertInfo: { background: '#579bfc' },
  opsList: { padding: '10px 14px 14px' },
  opsRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px', gap: 10, alignItems: 'center', marginBottom: 12, color: 'var(--text-sub)', fontSize: 12 },
  progress: { gridColumn: '1 / -1', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { display: 'block', height: '100%', borderRadius: 999, background: '#579bfc' },
  quickPanel: {
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    background: 'var(--surface-glass)',
    boxShadow: 'var(--shadow-md)',
    paddingBottom: 14,
  },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, padding: '0 14px' },
  quickTile: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: '#fff',
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  quickIcon: { width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--accent)', border: '1px solid var(--border)', flexShrink: 0 },
  quickSectionWrapFirst: { marginTop: 8 },
  quickSectionWrap: { marginTop: 20 },
  quickSection: { marginTop: 16 },
  quickSectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
};
