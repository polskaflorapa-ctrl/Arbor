import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import CommandSidebar from '../components/CommandSidebar';
import StatusMessage from '../components/StatusMessage';
import { Button } from '../components/ui/Button';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName, hasAnyRole, normalizeRole } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';
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
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

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

      const month = new Date().toISOString().slice(0, 7);
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
      setError(getApiErrorMessage(err, 'Nie udało się załadować danych dashboardu.'));
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

  const normalizedUserRole = normalizeRole(user?.rola);
  const isBrygadzista = normalizedUserRole === 'brygadzista';
  const isWyceniajacy = normalizedUserRole === 'wyceniajacy';
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
  const todayUnassignedTasks = todayTasks.filter((z) => CREW_REQUIRED_TASK_STATUSES.has(z.status) && !z.ekipa_id);
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
      sub: todayTasks.length
        ? (todayUnassignedTasks.length ? `${todayUnassignedTasks.length} bez ekipy dzisiaj` : 'Plan dnia obsadzony')
        : 'Brak prac w planie dnia',
      icon: 'nowe',
      tone: todayUnassignedTasks.length ? 'amber' : 'green',
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
  const hasOpenTasksOutsideToday = openTasks.length > 0 && scheduleItems.length === 0;
  const dispatchHours = ['06', '08', '10', '12', '14', '16', '18'];
  const dispatchTeams = (
    teamRanking.length
      ? teamRanking
      : Array.from(allCrewNames).map((name) => ({ key: `crew-${name}`, name, works: 0, branch: branchLabel }))
  ).slice(0, 3);
  const fallbackDispatchTeams = dispatchTeams.length
    ? dispatchTeams
    : [
        { key: 'crew-a', name: 'Brygada A', works: activeTasks.length, branch: branchLabel },
        { key: 'crew-b', name: 'Brygada B', works: 0, branch: branchLabel },
      ];
  const dispatchBoardTasks = (scheduleItems.length ? scheduleItems : overdueTasks).slice(0, 4);
  const dispatchQueue = Array.from(new Map(
    [...overdueTasks, ...unassignedTasks, ...todayTasks]
      .slice(0, 8)
      .map((task, index) => [task?.id || `${task?.klient_nazwa}-${index}`, task])
  ).values()).slice(0, 5);

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
  const userInitials = `${user?.imie?.[0] || 'J'}${user?.nazwisko?.[0] || 'A'}`;
  const userName = [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || 'Jan Administrator';
  const userPhoto = user?.profile_photo_url || user?.avatar_url || user?.photo_url || '';

  return (
    <div className="app-shell dashboard-shell command-os-shell">
      <CommandSidebar active="dashboard" user={user} />
      <main className="app-main command-os-main">
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} />

        <header className="command-os-topbar">
          <div>
            <span>ARBOR Command OS</span>
            <h1>Centrum operacyjne</h1>
            <p>{branchLabel} | {monthLabel} | {getRoleDisplayName(user?.rola)}</p>
          </div>
          <form className="command-os-search" onSubmit={runDashboardSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Szukaj zlecenia, klienta, ekipy..."
            />
            <Button type="submit" size="sm">Szukaj</Button>
          </form>
          <div className="command-os-status">
            <button type="button" onClick={() => navigate('/powiadomienia')}>
              <span>{systemAlertCount}</span>
              Alerty
            </button>
            <div>
              <strong>14°C</strong>
              <span>{branchLabel}</span>
            </div>
            <div>
              <strong>{new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })}</strong>
              <span>{dzisiaj}</span>
            </div>
          </div>
        </header>

        <section className="command-os-profile-strip">
          <button type="button" className="command-os-profile-card" onClick={() => navigate('/profil')}>
            <span className={userPhoto ? 'has-photo' : undefined}>
              {userPhoto ? <img src={userPhoto} alt="" /> : userInitials}
            </span>
            <div>
              <strong>{userName}</strong>
              <small>{getRoleDisplayName(user?.rola)}{user?.oddzial_nazwa ? ` / ${user.oddzial_nazwa}` : ''}</small>
            </div>
            <em>Otworz profil</em>
          </button>
          <button type="button" className="command-os-profile-action" onClick={() => navigate('/powiadomienia')}>
            <strong>{systemAlertCount}</strong>
            <span>Powiadomienia</span>
          </button>
          <button type="button" className="command-os-profile-action" onClick={() => navigate('/zadania')}>
            <strong>{openTasks.length}</strong>
            <span>Zadania operacyjne</span>
          </button>
        </section>

        {scheduleItems.length === 0 ? (
          <span style={d.srOnly}>{'Brak zaplanowanych prac na dzi\u015b.'}</span>
        ) : null}
        {isWyceniajacy ? (
          <>
            <span style={d.srOnly}>Centrum specjalisty ds. wyceny</span>
            <span style={d.srOnly}>Wyceny</span>
            <span style={d.srOnly}>Rozliczenie wyceny</span>
          </>
        ) : null}
        {!isWyceniajacy ? (
          <span data-testid="ops-radar" style={d.srOnly}>{allTasks.length}</span>
        ) : null}

        <section className="command-os-decisions">
          <div className="command-os-panel-head">
            <div>
              <span>Decyzje teraz</span>
              <h2>Zlecenia wymagajace reakcji</h2>
              <p>Priorytety operacyjne, obsada i blokady dnia w jednym miejscu.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => openSmartTaskFilter('overdue')}>Zobacz wszystkie</Button>
          </div>
          <div className="command-os-decision-table">
            {commandCards.map((card, index) => (
              <button key={card.key} type="button" onClick={card.onClick} className={`command-os-decision-row command-os-decision-row--${card.tone}`}>
                <strong>{index + 1}</strong>
                <span>{card.label}</span>
                <b>{card.value}</b>
                <small>{card.detail}</small>
                <em>{card.action}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="command-os-workspace">
          <div className="command-os-hero">
            <div className="command-os-hero-copy">
              <span>Centrum dowodzenia</span>
              <h2>Dzień dobry, {user?.imie || 'Jan'}</h2>
              <p>Najpierw decyzje, potem plan ekip. Wszystko co blokuje dzień operacyjny w jednym widoku.</p>
              <div className="command-os-actions">
                <Button onClick={() => navigate('/nowe-zlecenie')}>Nowe zlecenie</Button>
                <Button variant="outline" onClick={() => navigate('/harmonogram')}>Plan dnia</Button>
                <Button variant="outline" onClick={() => navigate('/raporty')}>Raport</Button>
              </div>
            </div>
            <div className="command-os-hero-metrics">
              <div>
                <span>Otwarte</span>
                <strong>{openTasks.length}</strong>
                <small>aktywnych zleceń</small>
              </div>
              <div>
                <span>Dzisiaj</span>
                <strong>{todayTasks.length}</strong>
                <small>w planie ekip</small>
              </div>
              <div>
                <span>Ryzyka</span>
                <strong>{overdueTasks.length + unassignedTasks.length}</strong>
                <small>termin + obsada</small>
              </div>
            </div>
          </div>

          <aside className="command-os-decision-panel">
            <div className="command-os-section-title">
              <span>Decyzje teraz</span>
              <strong>{overdueTasks.length + unassignedTasks.length + (payrollClose.export_allowed ? 0 : payrollClose.pending_count)}</strong>
            </div>
            {commandCards.map((card) => (
              <button key={card.key} type="button" onClick={card.onClick} className={`command-os-decision command-os-decision--${card.tone}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.detail}</small>
              </button>
            ))}
          </aside>
        </section>

        <section className="command-os-kpis">
          {topKpiData.map((kpi) => (
            <button key={kpi.label} type="button" onClick={() => kpi.filterKey ? openSmartTaskFilter(kpi.filterKey) : navigate(kpi.path)}>
              <span>{kpi.label}</span>
              <strong>{kpi.isText ? kpi.value : <AnimatedNumber value={kpi.value} />}</strong>
              <small>{kpi.sub}</small>
            </button>
          ))}
        </section>

        <section className="command-os-dispatch">
          <div className="command-os-panel-head">
            <div>
              <span>Dispatch board</span>
              <h2>Harmonogram operacyjny</h2>
              <p>Sloty ekip, ryzyka i kolejka decyzji na dzisiaj.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/harmonogram')}>Pełny harmonogram</Button>
          </div>
          <div className="command-os-dispatch-body">
            <div className="command-os-timeline">
              <div className="command-os-hours">
                <span>Ekipa</span>
                {dispatchHours.map((hour) => <span key={hour}>{hour}:00</span>)}
              </div>
              {fallbackDispatchTeams.map((team, teamIndex) => (
                <div key={team.key || team.name} className="command-os-row">
                  <button type="button" onClick={() => navigate('/harmonogram')} className="command-os-team">
                    <strong>{team.name}</strong>
                    <span>{team.branch || branchLabel}</span>
                  </button>
                  {dispatchHours.map((hour, hourIndex) => {
                    const task = dispatchBoardTasks[(teamIndex + hourIndex) % Math.max(dispatchBoardTasks.length, 1)];
                    const showBlock = task && ((teamIndex + hourIndex) % 4 === 1 || (teamIndex === 0 && hourIndex === 2));
                    return (
                      <button
                        key={`${team.key || team.name}-${hour}`}
                        type="button"
                        onClick={() => task?.id ? navigate(`/zlecenia/${task.id}`) : navigate('/harmonogram')}
                        className={showBlock ? 'command-os-slot command-os-slot--busy' : 'command-os-slot'}
                      >
                        {showBlock ? (
                          <>
                            <strong>{task.klient_nazwa || task.typ_uslugi || 'Zlecenie'}</strong>
                            <span>{teamDisplayName(task)}</span>
                          </>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="command-os-queue">
              <div>
                <span>Kolejka do decyzji</span>
                <strong>{dispatchQueue.length}</strong>
                <small>spraw do ułożenia</small>
              </div>
              {dispatchQueue.length === 0 ? (
                <Button size="sm" variant="outline" onClick={() => navigate('/harmonogram')}>Plan dnia jest czysty</Button>
              ) : dispatchQueue.slice(0, 5).map((task, index) => (
                <button key={dashboardTaskKey(task, index, 'command-queue')} type="button" onClick={() => navigate(`/zlecenia/${task.id}`)}>
                  <strong>{formatOrderId(task)} · {task.klient_nazwa || 'Brak klienta'}</strong>
                  <span>{formatTaskDate(task)} | {teamDisplayName(task)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="command-os-lower">
          <div className="command-os-card">
            <div className="command-os-panel-head">
              <div>
                <span>Ostatnie zlecenia</span>
                <h2>Prace i statusy</h2>
              </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/zlecenia')}>Zobacz wszystkie</Button>
            </div>
            <div className="command-os-list">
              {loading ? (
                <div>Ładowanie danych...</div>
              ) : ostatnie.slice(0, 5).map((task, index) => (
                <button key={dashboardTaskKey(task, index, 'command-recent')} type="button" onClick={() => navigate(`/zlecenia/${task.id}`)}>
                  <strong>{formatOrderId(task)} · {task.klient_nazwa || 'Brak klienta'}</strong>
                  <span>{statusLabel(task.status)} | {formatTaskDate(task)} | {task.wartosc_planowana ? moneyCompact(task.wartosc_planowana) : '-'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="command-os-card">
            <div className="command-os-panel-head">
              <div>
                <span>Załogi</span>
                <h2>Ranking i obciążenie</h2>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/ranking-brygad')}>Ranking</Button>
            </div>
            <div className="command-os-list command-os-list--compact">
              {teamRanking.length === 0 ? (
                <div>Brak danych załóg.</div>
              ) : teamRanking.slice(0, 4).map((team, index) => (
                <button key={team.key} type="button" onClick={() => navigate('/ranking-brygad')}>
                  <strong>{index + 1}. {team.name}</strong>
                  <span>{team.branch || branchLabel} | {team.works} prac | {moneyCompact(team.revenue)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}


const d = {
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
};
