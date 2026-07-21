import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import OpsRadar from '../components/OpsRadar';
import TelemetryStatus from '../components/TelemetryStatus';
import DashboardPolskaFlora from './DashboardPolskaFlora';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName, hasAnyRole, normalizeRole } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { localDateKey } from '../utils/localDateKey';
import {
  CREW_REQUIRED_TASK_STATUSES,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
} from '../utils/taskWorkflow';

const SMART_FILTER_KEY = 'zlecenia_smart_filter';
const SMART_FILTER_INTENT_KEY = 'zlecenia_smart_filter_intent_at';

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
  const today = localDateKey(now);
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
      setLoading(false);

      const month = localDateKey().slice(0, 7);
      api.get('/payroll/month-close-status', {
        headers: h,
        params: { month },
      })
        .then((pRes) => {
          setPayrollClose({
            export_allowed: pRes.data?.export_allowed !== false,
            pending_count: Number(pRes.data?.pending_count) || 0,
          });
        })
        .catch(() => {
          setPayrollClose({ export_allowed: true, pending_count: 0 });
        });
    } catch (err) {
      const message = getApiErrorMessage(err, 'Nie udało się załadować danych dashboardu.');
      setError(/Validation failed \(numeric string is expected\)/i.test(message) ? '' : message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getStoredToken()) { navigate('/'); return; }
    const u = readStoredUser();
    if (u) setUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const openSmartTaskFilter = useCallback((filterKey) => {
    if (filterKey) {
      localStorage.setItem(SMART_FILTER_KEY, filterKey);
      localStorage.setItem(SMART_FILTER_INTENT_KEY, String(Date.now()));
    }
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
  const todayIso = localDateKey();
  const openTasks = allTasks.filter((z) => !isTaskClosed(z.status));
  const activeTasks = openTasks.filter((z) => isTaskInProgress(z.status));
  const overdueTasks = openTasks.filter((z) => {
    const day = taskDateKey(z);
    return day && day < todayIso;
  });
  const todayTasks = openTasks.filter((z) => taskDateKey(z) === todayIso);
  const unassignedTasks = openTasks.filter((z) => CREW_REQUIRED_TASK_STATUSES.has(z.status) && !z.ekipa_id);
  const todayUnassignedTasks = todayTasks.filter((z) => CREW_REQUIRED_TASK_STATUSES.has(z.status) && !z.ekipa_id);
  const dzisiaj = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const currentMonth = todayIso.slice(0, 7);
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
      sub: todayTasks.length
        ? (todayUnassignedTasks.length ? `${todayUnassignedTasks.length} bez ekipy dzisiaj` : 'Plan dnia obsadzony')
        : 'Brak prac w planie dnia',
      icon: 'nowe',
      tone: todayUnassignedTasks.length ? 'amber' : 'green',
      path: '/harmonogram',
    },
  ];

  const quickLinks = useMemo(() => [
    { label: 'Ranking brygad', sub: 'Liderzy tygodnia i miesiaca', path: '/ranking-brygad', color: '#a0af14', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Nowe zlecenie',  sub: 'Utwórz zlecenie',       path: '/nowe-zlecenie', color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Planowanie',     sub: 'Przypisz ekipy',         path: '/kierownik',     color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Ekipy',          sub: 'Zarządzaj ekipami',      path: '/ekipy',         color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Raporty',        sub: 'Analiza wydajności',     path: '/raporty',           color: 'var(--accent-dk)', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Misja dnia', sub: 'Tryb dziś — KPI i plan', path: '/misja-dnia', color: '#766440', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Autoplan dnia', sub: 'Przypisanie ekip (heurystyka)', path: '/autoplan-dnia', color: '#766440', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'KPI autoplan (tydzień)', sub: 'Historia apply / rollback', path: '/kpi-tydzien', color: '#f1f3d6', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Raport dzienny', sub: 'Pole — zlecenia, czasy, materiały', path: '/raport-dzienny', color: '#7f8c12', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Raporty mobilne', sub: 'KPI z ostatnich miesięcy', path: '/raporty-mobilne', color: '#766440', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia'] },
    { label: 'Flota i sprzęt', sub: 'Pojazdy i narzędzia',   path: '/flota',             color: '#bd701e', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Magazyn',        sub: 'Stan lokalny (jak w aplikacji mobilnej)', path: '/magazyn', color: '#a0af14', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Rezerwacje sprzętu', sub: 'Kalendarz rezerwacji', path: '/rezerwacje-sprzetu', color: '#766440', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Harmonogram',    sub: 'Kalendarz zleceń',       path: '/harmonogram',       color: '#f1f3d6', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Magazynier'] },
    { label: 'Centrum specjalisty ds. wyceny', sub: 'KPI oględzin i skróty (jak w mobile)', path: '/wyceniajacy-hub', color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Wyceny',         sub: 'Kalendarz, oględziny, zatwierdzanie', path: '/wycena-kalendarz',  color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Blokady kalendarza', sub: 'Daty bez nowych wycen (też mobilka)', path: '/blokady-kalendarza', color: '#c0492f', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Zatwierdzanie wycen', sub: 'Akceptacja i odrzucenie', path: '/zatwierdz-wyceny', color: '#7f8c12', roles: ['Kierownik','Administrator','Dyrektor','Specjalista'] },
    { label: 'Rozliczenie wyceny', sub: 'Stawka + % realizacji', path: '/wynagrodzenie-wyceniajacych', color: '#7f8c12', roles: ['Wyceniający','Kierownik','Dyrektor','Administrator'] },
    { label: 'Oddziały',       sub: 'Zarządzanie',            path: '/oddzialy',          color: '#f1f3d6', roles: ['Dyrektor','Administrator'] },
    { label: 'Użytkownicy',    sub: 'Konta i uprawnienia',    path: '/uzytkownicy',       color: '#c0492f', roles: ['Dyrektor','Administrator'] },
    { label: 'Role',           sub: 'Uprawnienia pracowników',path: '/zarzadzaj-rolami',  color: '#bd701e', roles: ['Dyrektor','Administrator'] },
    { label: 'Księgowość',     sub: 'Faktury i rozliczenia',  path: '/ksiegowosc',        color: '#bd701e', roles: ['Dyrektor','Administrator','Kierownik'] },
  ].filter(i => hasAnyRole(user?.rola, i.roles)), [user?.rola]);

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

  const scheduleItems = [...todayTasks]
    .sort((a, b) => new Date(a.data_planowana || a.data_zaplanowana || 0) - new Date(b.data_planowana || b.data_zaplanowana || 0))
    .slice(0, 6);

  const systemAlertItems = payrollClose.export_allowed
    ? []
    : [
        {
          title: 'Payroll wymaga raportów',
          sub: `Brakuje raportów dnia: ${payrollClose.pending_count}`,
          tone: 'warn',
        },
      ];
  const systemAlertCount = systemAlertItems.length;
  const commandCards = [
    {
      key: 'overdue',
      label: 'Po terminie',
      value: overdueTasks.length,
      detail: overdueTasks.length ? 'wymaga decyzji operacyjnej' : 'brak zaległości',
      tone: overdueTasks.length ? 'danger' : 'good',
      action: 'Otwórz zaległe',
      onClick: () => openSmartTaskFilter('overdue'),
    },
    {
      key: 'unassigned',
      label: 'Bez ekipy',
      value: unassignedTasks.length,
      detail: unassignedTasks.length ? 'blokuje harmonogram' : 'obsada kompletna',
      tone: unassignedTasks.length ? 'warning' : 'good',
      action: 'Przypisz ekipy',
      onClick: () => navigate('/kierownik'),
    },
    {
      key: 'today',
      label: 'Plan dnia',
      value: todayTasks.length,
      detail: todayUnassignedTasks.length ? `${todayUnassignedTasks.length} bez obsady dzisiaj` : 'gotowe do kontroli',
      tone: todayUnassignedTasks.length ? 'warning' : 'good',
      action: 'Harmonogram',
      onClick: () => navigate('/harmonogram'),
    },
    {
      key: 'payroll',
      label: 'Payroll',
      value: payrollClose.export_allowed ? 'OK' : payrollClose.pending_count,
      detail: payrollClose.export_allowed ? 'raporty zamknięte' : 'brak raportów dnia',
      tone: payrollClose.export_allowed ? 'good' : 'danger',
      action: 'Raporty',
      onClick: () => navigate('/raporty'),
    },
  ];

  return (
    <DashboardPolskaFlora
      user={user}
      error={error}
      loading={loading}
      dzisiaj={dzisiaj}
      monthLabel={monthLabel}
      branchLabel={branchLabel}
      allTasks={allTasks}
      openTasks={openTasks}
      activeTasks={activeTasks}
      todayTasks={todayTasks}
      unassignedTasks={unassignedTasks}
      overdueTasks={overdueTasks}
      completedMonth={completedMonth}
      monthTasks={monthTasks}
      monthRevenue={monthRevenue}
      sumaWartosci={sumaWartosci}
      allCrewNames={allCrewNames}
      activeCrewNames={activeCrewNames}
      ostatnie={ostatnie}
      scheduleItems={scheduleItems}
      operationalMetrics={operationalMetrics}
      navigate={navigate}
    />
  );

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
            <button
              type="button"
              onClick={() => navigate('/powiadomienia')}
              style={d.iconStatusBtn}
              aria-label={systemAlertCount ? `Powiadomienia: ${systemAlertCount}` : 'Powiadomienia'}
            >
              {systemAlertCount > 0 ? (
                <span data-testid="dashboard-system-alert-count" style={d.statusDot}>{systemAlertCount}</span>
              ) : null}
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
        <div className="dashboard-command-hero" style={d.hero}>
          <div style={d.heroBg} />
          <div style={d.heroLeft}>
            <div style={d.heroEyebrow}>Centrum dowodzenia</div>
            <div style={d.heroGreeting}>Dzień dobry, {user?.imie}</div>
            <div style={d.heroDate}>{dzisiaj}</div>
            <div style={d.rolaBadge}>
              {getRoleDisplayName(user?.rola)}{user?.oddzial_nazwa ? ` · ${user.oddzial_nazwa}` : ''}
            </div>
          </div>
          <div className="dashboard-hero-stats" style={d.heroStats}>
            <div style={d.heroStat}>
              <span style={d.heroStatLabel}>Otwarte</span>
              <strong style={d.heroStatValue}>{openTasks.length}</strong>
              <small style={d.heroStatDetail}>zlecenia aktywne</small>
            </div>
            <div style={d.heroStat}>
              <span style={d.heroStatLabel}>Dzisiaj</span>
              <strong style={d.heroStatValue}>{todayTasks.length}</strong>
              <small style={d.heroStatDetail}>w planie</small>
            </div>
            <div style={d.heroStat}>
              <span style={d.heroStatLabel}>Ryzyka</span>
              <strong style={d.heroStatValue}>{overdueTasks.length + unassignedTasks.length}</strong>
              <small style={d.heroStatDetail}>termin + obsada</small>
            </div>
          </div>
          <div className="dashboard-hero-actions" style={{ ...d.topActions, ...(isCompact ? d.topActionsCompact : {}) }}>
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

        <section className="dashboard-live-cockpit" aria-label="Live operations cockpit">
          <div className="dashboard-cockpit-map" aria-label="Operacyjny radar zleceń">
            <span className="dashboard-radar-sweep" />
            <span className="dashboard-radar-ring dashboard-radar-ring-one" />
            <span className="dashboard-radar-ring dashboard-radar-ring-two" />
            <span className="dashboard-radar-ring dashboard-radar-ring-three" />
            <div className="dashboard-cockpit-core">
              <span>Live ops</span>
              <strong>{openTasks.length}/{Math.max(allTasks.length, openTasks.length)}</strong>
              <small>{branchLabel}</small>
            </div>
            <div className="dashboard-cockpit-node dashboard-cockpit-node-a">
              <span>Załogi</span>
              <strong>{activeCrewNames.size}/{allCrewNames.size || activeCrewNames.size}</strong>
            </div>
            <div className="dashboard-cockpit-node dashboard-cockpit-node-b">
              <span>Ryzyko</span>
              <strong>{overdueTasks.length + unassignedTasks.length}</strong>
            </div>
            <div className="dashboard-cockpit-node dashboard-cockpit-node-c">
              <span>Dzisiaj</span>
              <strong>{todayTasks.length}</strong>
            </div>
            <div className="dashboard-cockpit-actions">
              <button type="button" onClick={() => navigate('/nowe-zlecenie')}>
                {QL_ICONS['/nowe-zlecenie']}
                Nowe zlecenie
              </button>
              <button type="button" onClick={() => navigate('/misja-dnia')}>
                {QL_ICONS['/misja-dnia']}
                Misja dnia
              </button>
            </div>
          </div>

          <div className="dashboard-cockpit-decisions">
            <div className="dashboard-cockpit-heading">
              <span>Decyzje teraz</span>
              <strong>{commandCards.reduce((sum, card) => sum + (Number(card.value) || 0), 0)}</strong>
            </div>
            <div className="dashboard-decision-strip dashboard-decision-stack" style={d.decisionStrip}>
              {commandCards.map((card, index) => (
                <button
                  key={card.key}
                  type="button"
                  className="dashboard-decision-card"
                  data-tone={card.tone}
                  data-index={index}
                  onClick={card.onClick}
                  style={{ ...d.decisionCard, ...(d[`decisionCard_${card.tone}`] || {}) }}
                >
                  <span style={d.decisionLabel}>{card.label}</span>
                  <strong style={d.decisionValue}>{card.value}</strong>
                  <small style={d.decisionDetail}>{card.detail}</small>
                  <span style={d.decisionAction}>{card.action}{QL_CHEVRON}</span>
                  <span className="dashboard-card-pulse" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-kpi-dock dashboard-kpi-grid" style={d.kpiGrid}>
            {topKpiData.map((kpi, index) => (
              <button
                key={kpi.label}
                type="button"
                className="dashboard-kpi-card"
                data-tone={kpi.tone}
                data-index={index}
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
                <span className="dashboard-kpi-progress" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-decision-strip" style={d.decisionStrip}>
          {commandCards.map((card, index) => (
            <button
              key={card.key}
              type="button"
              className="dashboard-decision-card"
              data-tone={card.tone}
              data-index={index}
              onClick={card.onClick}
              style={{ ...d.decisionCard, ...(d[`decisionCard_${card.tone}`] || {}) }}
            >
              <span style={d.decisionLabel}>{card.label}</span>
              <strong style={d.decisionValue}>{card.value}</strong>
              <small style={d.decisionDetail}>{card.detail}</small>
              <span style={d.decisionAction}>{card.action}{QL_CHEVRON}</span>
              <span className="dashboard-card-pulse" aria-hidden="true" />
            </button>
          ))}
        </section>

        {/* ─── KPI (grupa inset, jak iOS) ───────────────────────────────────── */}
        <section className="dashboard-kpi-grid" style={d.kpiGrid}>
          {topKpiData.map((kpi, index) => (
            <button
              key={kpi.label}
              type="button"
              className="dashboard-kpi-card"
              data-tone={kpi.tone}
              data-index={index}
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
              <span className="dashboard-kpi-progress" aria-hidden="true" />
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

      </main>
    </div>
  );
}

const d = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    background:
      'radial-gradient(circle at 18% 8%, rgba(34,211,142,0.14), transparent 28%), radial-gradient(circle at 78% 4%, rgba(56,189,248,0.12), transparent 24%), linear-gradient(90deg, rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(0deg, rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(135deg, #f0ebdd 0%, #f0ebdd 44%, #f0ebdd 100%)',
    backgroundSize: 'auto, auto, 44px 44px, 44px 44px, auto',
  },
  content: { flex: 1, padding: '22px clamp(16px, 2.4vw, 30px) 32px', overflowX: 'hidden', minWidth: 0, position: 'relative' },
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
    minHeight: 74,
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 520px) auto',
    alignItems: 'center',
    gap: 16,
    marginBottom: 14,
    padding: '16px 18px',
    border: '1px solid rgba(15,23,42,0.1)',
    borderRadius: 18,
    background:
      'linear-gradient(135deg, rgba(255,255,255,0.94), rgba(248,250,252,0.86))',
    backgroundSize: 'auto',
    boxShadow: '0 18px 44px rgba(15,23,42,0.08)',
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
    minHeight: 40,
    border: '1px solid rgba(15,95,58,0.16)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text-muted)',
    padding: '0 10px',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    color: '#2c2011',
    outline: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
  searchShortcut: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '2px 6px',
    background: 'var(--surface-field)',
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
    background: '#fae7d2',
    color: '#995510',
    fontSize: 10,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherBox: { display: 'flex', flexDirection: 'column', gap: 1, color: 'var(--text)', fontSize: 12, fontWeight: 850, border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8, padding: '7px 10px', background: '#ffffff' },
  dateBox: { display: 'flex', flexDirection: 'column', gap: 1, color: 'var(--text)', fontSize: 12, fontWeight: 850, border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8, padding: '7px 10px', background: '#ffffff' },
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
  kpiCard_green: { borderLeftColor: '#7f8c12' },
  kpiCard_lime:  { borderLeftColor: '#7f8c12' },
  kpiCard_blue:  { borderLeftColor: '#f1f3d6' },
  kpiCard_amber: { borderLeftColor: '#bd701e' },
  kpiCard_danger:{ borderLeftColor: '#c0492f' },
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
  kpiCardSub: { fontSize: 12, color: '#5a5040', fontWeight: 600, lineHeight: 1.25 },
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
    border: '1px solid rgba(15,23,42,0.09)',
    borderRadius: 22,
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 24px 70px rgba(15,23,42,0.1)',
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
    color: '#f1f3d6',
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
    border: '1px solid #f0ebdd',
    borderLeft: '3px solid #7f8c12',
    background: '#ffffff',
    color: '#2c2011',
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
    borderBottom: '1px solid #f0ebdd',
    borderRadius: 0,
    background: '#ffffff',
    color: '#2c2011',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  placeBadge: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '1px solid #f0ebdd',
    color: '#5a5040',
    background: '#f0ebdd',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  placeBadge_0: { color: '#fae7d2', border: '1px solid #fae7d2' },
  placeBadge_1: { color: '#e0d9c8', border: '1px solid #e0d9c8' },
  placeBadge_2: { color: '#bd701e', border: '1px solid #bd701e' },
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
  rankingMetric: { color: '#2c2011', fontSize: 12, fontWeight: 700, textAlign: 'right' },
  scheduleList: { padding: '8px 12px 12px' },
  scheduleRow: {
    display: 'grid',
    gridTemplateColumns: '52px 1fr 20px',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 44,
    border: 'none',
    borderBottom: '1px solid #f0ebdd',
    borderRadius: 0,
    background: '#ffffff',
    color: '#2c2011',
    cursor: 'pointer',
    textAlign: 'left',
    padding: '0 12px',
    fontFamily: 'inherit',
  },
  scheduleTime: { color: '#5a5040', fontWeight: 600, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  scheduleMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  scheduleArrow: { color: '#9a907a', display: 'inline-flex', justifyContent: 'flex-end' },
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
  alertIcon: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: '#f1f3d6' },
  alertIcon_danger:  { background: '#c0492f' },
  alertIcon_warning: { background: '#bd701e' },
  alertIcon_info:    { background: '#f1f3d6' },
  alertIcon_success: { background: '#7f8c12' },
  alertText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
  alertEmpty: { padding: '18px 14px', color: '#5a5040', fontSize: 12, fontWeight: 600 },
  metricList: { padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 },
  metricRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  metricTop: { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#2c2011', fontSize: 12, fontWeight: 600 },
  progressTrack: { height: 6, borderRadius: 8, overflow: 'hidden', background: '#f0ebdd' },
  progressFillLegacy: { display: 'block', height: '100%', borderRadius: 8, background: '#f1f3d6' },
  metricMeta: { color: '#5a5040', fontSize: 11, fontWeight: 500 },
  reportShortcuts: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 14px 14px' },
  reportBtn: {
    minHeight: 30,
    border: '1px solid #f0ebdd',
    borderRadius: 4,
    background: '#f0ebdd',
    color: '#5a5040',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  shortcutPanel: {
    border: '1px solid rgba(15,23,42,0.09)',
    borderRadius: 22,
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 24px 70px rgba(15,23,42,0.1)',
    marginBottom: 14,
    overflow: 'hidden',
  },
  shortcutGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 0, padding: 0, borderTop: '1px solid #f0ebdd' },
  shortcutGroup: { border: 'none', borderRight: '1px solid #f0ebdd', background: '#ffffff', padding: '12px 14px', minWidth: 0 },
  shortcutGroupTitle: { color: '#5a5040', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 },
  shortcutRow: {
    width: '100%',
    minHeight: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    background: 'transparent',
    color: '#2c2011',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  shortcutDot: { display: 'none' },

  // Hero
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 0.86fr) auto',
    gap: 18,
    position: 'relative', borderRadius: 24, padding: '44px 46px', marginBottom: 22,
    justifyContent: 'space-between', alignItems: 'stretch',
    background:
      'linear-gradient(90deg, rgba(148,163,184,0.14) 1px, transparent 1px), linear-gradient(0deg, rgba(148,163,184,0.1) 1px, transparent 1px), radial-gradient(circle at 78% 20%, rgba(132,204,22,0.28), transparent 30%), radial-gradient(circle at 12% 18%, rgba(37,99,235,0.22), transparent 28%), linear-gradient(135deg, #2c2011 0%, #5d6a0b 50%, #5d6a0b 100%)',
    backgroundSize: '54px 54px, 54px 54px, auto, auto, auto',
    border: '1px solid rgba(226,232,240,0.18)', overflow: 'hidden',
    boxShadow: '0 34px 90px rgba(15,23,42,0.2)',
  },
  heroCompact: {
    padding: '26px 16px 20px',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    borderRadius: 16,
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  heroBg: {
    display: 'none', position: 'absolute', top: -94, right: -72, width: 300, height: 300,
    borderRadius: '50%', background: 'transparent',
    pointerEvents: 'none',
  },
  heroLeft: { position: 'relative', minWidth: 0 },
  heroLeftCompact: { minWidth: 0 },
  heroEyebrow: { color: '#e4efd6', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 },
  heroGreeting: { fontSize: 34, fontWeight: 950, color: '#ffffff', marginBottom: 4, lineHeight: 1.04 },
  heroGreetingCompact: { fontSize: 24, lineHeight: 1.18 },
  heroDate: { fontSize: 13, color: 'rgba(255,255,255,0.78)', marginBottom: 12, textTransform: 'capitalize', fontWeight: 750 },
  rolaBadge: { display: 'inline-block', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 850, background: 'rgba(255,255,255,0.16)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)' },
  heroStats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, alignSelf: 'stretch' },
  heroStat: { background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: 12, display: 'grid', gap: 3, minWidth: 0, boxShadow: '0 12px 28px rgba(0,0,0,0.12)', backdropFilter: 'blur(16px)' },
  heroStatLabel: { color: 'rgba(226,232,240,0.78)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  heroStatValue: { color: '#ffffff', fontSize: 22, lineHeight: 1.05, fontWeight: 950, fontVariantNumeric: 'tabular-nums' },
  heroStatDetail: { color: 'rgba(226,232,240,0.74)', fontSize: 11, lineHeight: 1.25, fontWeight: 650 },
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
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'linear-gradient(135deg, #a0af14, #7f8c12)',
    color: '#2c2011',
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
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.26)',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 750,
    cursor: 'pointer',
  },
  decisionStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 16,
  },
  decisionCard: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto auto',
    gap: '3px 10px',
    minHeight: 106,
    padding: 14,
    background: '#ffffff',
    border: '1px solid rgba(15,23,42,0.09)',
    borderLeft: '0 solid transparent',
    borderRadius: 20,
    boxShadow: '0 20px 54px rgba(15,23,42,0.09)',
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  decisionCard_good: { borderLeftColor: '#7f8c12' },
  decisionCard_warning: { borderLeftColor: '#bd701e', background: 'rgba(255,251,235,0.9)' },
  decisionCard_danger: { borderLeftColor: '#c0492f', background: 'rgba(254,242,242,0.9)' },
  decisionLabel: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0, gridColumn: '1 / -1' },
  decisionValue: { color: '#456b1f', fontSize: 26, lineHeight: 1.05, fontWeight: 950, fontVariantNumeric: 'tabular-nums' },
  decisionDetail: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 650, lineHeight: 1.25, gridColumn: '1 / -1' },
  decisionAction: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#456b1f', fontSize: 12, fontWeight: 900, marginTop: 6, gridColumn: '1 / -1' },
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
    minHeight: 104,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '13px 14px',
    borderRadius: 20,
    border: '1px solid rgba(15,23,42,0.09)',
    borderLeft: '0 solid transparent',
    background: 'rgba(255,255,255,0.92)',
    color: '#2c2011',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 20px 54px rgba(15,23,42,0.09)',
    width: '100%',
  },
  kpiCardHover: { background: '#f0ebdd' },
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
  kpiCardValue: { marginTop: 6, fontSize: 26, fontWeight: 950, color: '#456b1f', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' },
  kpiCardTrend: { marginTop: 6, fontSize: 12, fontWeight: 600, color: '#5a5040' },
  boardGrid: { display: 'grid', gridTemplateColumns: '1.14fr .86fr', gap: 12, marginBottom: 12 },
  lowerGrid: { display: 'grid', gridTemplateColumns: '1.1fr .85fr .9fr', gap: 12, marginBottom: 12 },
  panel: {
    minWidth: 0,
    borderRadius: 22,
    border: '1px solid rgba(15,23,42,0.09)',
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 24px 70px rgba(15,23,42,0.1)',
    overflow: 'hidden',
    backdropFilter: 'none',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 14px 12px',
    borderBottom: '1px solid rgba(15,95,58,0.1)',
  },
  panelTitle: { fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 900, color: '#2c2011', textTransform: 'none', letterSpacing: 0 },
  panelSub: { marginTop: 4, fontSize: 12, fontWeight: 650, color: 'var(--text-muted)' },
  panelLink: {
    border: '1px solid #f0ebdd',
    borderRadius: 4,
    background: '#f0ebdd',
    color: '#5a5040',
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
    borderBottom: '1px solid #f0ebdd',
    background: 'transparent',
    color: '#2c2011',
    textAlign: 'left',
    cursor: 'pointer',
  },
  rankPlace: { width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' },
  rankPlaceLead: { color: '#bd701e', borderColor: 'rgba(234,179,8,0.5)', background: 'rgba(234,179,8,0.12)' },
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
    borderBottom: '1px solid #f0ebdd', background: '#ffffff', color: '#2c2011',
    borderRadius: 0, border: 'none', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#f0ebdd',
    width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  },
  progressFill: { display: 'block', height: '100%', borderRadius: 999, background: '#f1f3d6' },
};
