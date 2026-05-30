import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { DashboardSkeleton } from '../components/ui/skeleton-block';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumCard } from '../components/ui/platinum-card';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PlatinumPressable } from '../components/ui/platinum-pressable';
import { colorWithAlpha, elevationCard, shadowStyle } from '../constants/elevation';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { getRolaColor, type Theme } from '../constants/theme';
import {
  getOddzialFeatureConfig,
  isFeatureEnabledForOddzial,
  sortPathsByOddzialPriority,
} from '../utils/oddzial-features';
import { pushRecentContext, readRecentContexts, type RecentContextItem } from '../utils/command-center-history';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession, type StoredUser } from '../utils/session';
import { openAddressInMaps } from '../utils/maps-link';
import { triggerHaptic } from '../utils/haptics';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getRoleDisplayName } from '../utils/role-display';
import { getTaskFieldExecutionSummary } from '../utils/task-field-execution';
import { TASK_STATUS, isTaskClosed, makeTaskStatusColorMap, normalizeTaskStatus } from '../constants/task-workflow';

// ─── Typy ikon Ionicons ────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DASHBOARD_CACHE_KEY = 'arbor-mobile-dashboard-cache-v2';

interface DashboardStats {
  nowe?: number;
  w_realizacji?: number;
  zaplanowane?: number;
  zakonczone?: number;
  [key: string]: number | undefined;
}

type DashboardCache = {
  zlecenia: any[];
  stats: DashboardStats;
  savedAt: string;
};

function readArrayPayload(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

async function fetchJsonWithStatus(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

/** Lokalna paleta dashboardu wyprowadzona z tokenów motywu — reaguje na zmianę motywu. */
function arborColors(t: Theme) {
  return {
    bg: t.bg,
    bgSoft: t.surface3,
    paper: t.cardBg,
    paperSoft: t.surface2,
    forest: t.accent,
    leaf: t.success,
    leafSoft: t.successBg,
    moss: t.chartSecondary,
    line: t.border,
    text: t.text,
    muted: t.textMuted,
    warning: t.warning,
    warningSoft: t.warningBg,
    warningBorder: colorWithAlpha(t.warning, 0.5),
    warningText: t.warning,
    danger: t.danger,
    dangerSoft: t.dangerBg,
    leafBorder: colorWithAlpha(t.success, 0.4),
    onAccent: t.accentText,
    inactive: t.navInactive,
  };
}

interface QuickAction {
  label: string;
  icon: IoniconName;
  path: string;
  color: string;
}

interface WorkflowStep {
  key: string;
  title: string;
  subtitle: string;
  value: number;
  icon: IoniconName;
  color: string;
  path: string;
}

type QuickCategoryId =
  | 'start'
  | 'sales'
  | 'planning'
  | 'execution'
  | 'company'
  | 'reports';
type QuickFilterKey = 'focus' | 'all' | QuickCategoryId;

const QUICK_CATEGORY_ORDER: QuickCategoryId[] = [
  'start',
  'sales',
  'planning',
  'execution',
  'company',
  'reports',
];

function quickCategoryForAction(path: string, _label: string): QuickCategoryId {
  if (['/task-command-center', '/profil', '/powiadomienia', '/api-diagnostyka'].includes(path)) return 'start';
  if ([
    '/crm-mobile',
    '/crm-pipeline-mobile',
    '/klienci-mobile',
    '/telefonia-mobile',
    '/wyceniajacy-hub',
    '/wycena-kalendarz',
    '/wyceny-terenowe',
    '/wyceny-do-biura',
    '/zatwierdz-wyceny',
    '/ogledziny',
    '/plan-ogledzin',
  ].includes(path)) return 'sales';
  if (['/nowe-zlecenie', '/zlecenia', '/harmonogram', '/autoplan-dnia', '/blokady-kalendarza'].includes(path)) return 'planning';
  if (['/misja-dnia', '/raport-dzienny', '/potwierdzenia-ekip', '/flota-mobile', '/rezerwacje-sprzetu', '/magazyn-mobile'].includes(path)) return 'execution';
  if (['/uzytkownicy-mobile', '/oddzialy-mobile', '/oddzial-funkcje-admin', '/rozliczenia', '/wyceniajacy-finanse'].includes(path)) return 'company';
  if (['/raporty-mobilne', '/kpi-tydzien'].includes(path)) return 'reports';
  return 'planning';
}

function dashboardFocusHint(path: string) {
  const hints: Record<string, string> = {
    '/nowe-zlecenie': 'Szybkie przyjecie zlecenia, zdjecia i formularz terenowy.',
    '/plan-ogledzin': 'Lista wizyt specjalisty ds. wyceny na dzisiaj.',
    '/wyceny-terenowe': 'Wyceny u klienta, zdjecia i szkic.',
    '/wyceny-do-biura': 'Pakiety z terenu do domkniecia przez biuro.',
    '/harmonogram': 'Plan ekip, terminy i kolejnosc prac.',
    '/zlecenia': 'Aktualne zlecenia i statusy pracy.',
    '/raport-dzienny': 'Raport brygady po pracy.',
    '/rozliczenia': 'Godziny, finanse i rozliczenia.',
    '/magazyn-mobile': 'Sprzet, materialy i wydania.',
    '/rezerwacje-sprzetu': 'Dostepnosc sprzetu pod prace.',
  };
  return hints[path] || 'Otworz modul i kontynuuj prace.';
}

function dashboardRoleText(role: unknown) {
  return String(role || '').toLowerCase();
}

function isEstimatorRoleValue(role: unknown) {
  return dashboardRoleText(role).includes('wyceniaj');
}

function filterDashboardOrdersForUser(tasks: any[], user: StoredUser | null) {
  if (!isEstimatorRoleValue(user?.rola)) return tasks;
  return tasks.filter((task) => String(task?.wyceniajacy_id || '') === String(user?.id || ''));
}

function dashboardNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dashboardOpenProblemCount(task: any) {
  const direct = dashboardNumber(
    task?.problem_open ??
    task?.issues_open ??
    task?.unresolved_issues_count ??
    task?.open_problems_count ??
    task?.problemy_otwarte,
  );
  if (direct > 0) return direct;
  const rows = Array.isArray(task?.problemy)
    ? task.problemy
    : Array.isArray(task?.issues)
      ? task.issues
      : [];
  return rows.filter((row: any) => {
    const status = String(row?.status || row?.state || '').toLowerCase();
    return !status || (!status.includes('rozw') && !status.includes('closed') && !status.includes('done'));
  }).length;
}

function dashboardTaskNeedsSignal(task: any) {
  if (isTaskClosed(task?.status)) return false;
  const status = normalizeTaskStatus(task?.status);
  const field = getTaskFieldExecutionSummary(task);
  const crewStage = status === TASK_STATUS.ZAPLANOWANE || status === TASK_STATUS.W_REALIZACJI;
  const fieldStage = status === TASK_STATUS.WYCENA_TERENOWA || status === TASK_STATUS.DO_ZATWIERDZENIA;
  const missingCheckin = field.key === 'missing';
  const missingPhotos = field.relevant && field.missingPhotoLabels.length > 0 && (crewStage || fieldStage);
  return missingCheckin || missingPhotos || dashboardOpenProblemCount(task) > 0;
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const ARBOR_UI = useMemo(() => arborColors(theme), [theme]);
  const { language, t } = useLanguage();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ nowe: 0, w_realizacji: 0, zakonczone: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Komunikat błędu sieciowego — pokazywany jako banner u góry; null = brak błędu. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recentContexts, setRecentContexts] = useState<RecentContextItem[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>('focus');

  const loadDataRef = useRef<() => Promise<void>>(async () => {});

  const loadData = async () => {
    try {
      const { user: u, token } = await getStoredSession();
      if (!u || !token) { router.replace('/login'); return; }
      setUser(u);
      const h = { Authorization: `Bearer ${token}` };

      const endpoint = (u.rola === 'Brygadzista' || u.rola === 'Pomocnik')
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;
      const shouldLoadStats = !isEstimatorRoleValue(u.rola);

      const [zRes, sRes] = await Promise.all([
        fetchJsonWithStatus(endpoint, h),
        shouldLoadStats
          ? fetchJsonWithStatus(`${API_URL}/tasks/stats`, h)
          : Promise.resolve({ ok: true, status: 200, data: stats }),
      ]);
      const nextOrders = zRes.ok ? filterDashboardOrdersForUser(readArrayPayload(zRes.data), u) : zlecenia;
      const nextStats: DashboardStats = sRes.ok && sRes.data && typeof sRes.data === 'object' ? (sRes.data as DashboardStats) : stats;
      // Najpierw twarde błędy HTTP — wcześniej szły bezgłośnie.
      if (!zRes.ok && !sRes.ok) {
        const cached = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as DashboardCache;
          setZlecenia(Array.isArray(parsed.zlecenia) ? parsed.zlecenia : []);
          setStats(parsed.stats || {});
          setLoadError(`${t('dashboard.error.partial')} API: tasks ${zRes.status}, stats ${sRes.status}.`);
        } else {
          setLoadError(`${t('dashboard.error.loadFailed')} API: tasks ${zRes.status}, stats ${sRes.status}.`);
        }
        return;
      }
      if (zRes.ok) setZlecenia(nextOrders);
      if (sRes.ok) setStats(nextStats);
      await AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
        zlecenia: nextOrders,
        stats: nextStats,
        savedAt: new Date().toISOString(),
      } satisfies DashboardCache));
      // Jeden z dwóch padł — pokazujemy łagodne ostrzeżenie, ale renderujemy to co weszło.
      if (!zRes.ok || !sRes.ok) {
        setLoadError(`${t('dashboard.error.partial')} API: tasks ${zRes.status}, stats ${sRes.status}.`);
      } else {
        setLoadError(null);
      }
    } catch (err) {
      // Sieć / parser JSON / cokolwiek — komunikat zamiast pustego ekranu.
      const msg = err instanceof Error ? err.message : 'unknown';
      try {
        const cached = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as DashboardCache;
          setZlecenia(Array.isArray(parsed.zlecenia) ? parsed.zlecenia : []);
          setStats(parsed.stats || {});
          setLoadError(`${t('dashboard.error.partial')} Offline/cache. ${msg}`);
        } else {
          setLoadError(`${t('dashboard.error.network')} (${msg})`);
        }
      } catch {
        setLoadError(`${t('dashboard.error.network')} (${msg})`);
      }
    }
    finally { setLoading(false); setRefreshing(false); }
  };

  loadDataRef.current = loadData;

  useEffect(() => { void loadDataRef.current(); }, []);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void loadDataRef.current();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void (async () => {
      setRecentContexts(await readRecentContexts());
    })();
  }, []);

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const openWithContext = async (path: string, label: string, meta?: string) => {
    void triggerHaptic('light');
    const next = await pushRecentContext({
      path,
      label,
      ...(meta ? { meta } : {}),
    });
    setRecentContexts(next);
    router.push((path === '/nowe-zlecenie' ? buildNewOrderRoute({ source: 'dashboard' }) : path) as any);
  };

  const rola = user?.rola || '';
  const rolaLabel = getRoleDisplayName(rola, 'Operator');
  const isDyrektor   = rola === 'Dyrektor' || rola === 'Administrator';
  const isKierownik  = rola === 'Kierownik';
  const isBrygadzista= rola === 'Brygadzista';
  const isSpecjalista= rola === 'Specjalista';
  const isWyceniajacy= rola === 'Wyceniający';
  const isPomocnik   = rola === 'Pomocnik';
  const isPomBez     = rola === 'Pomocnik bez doświadczenia';
  const isMagazynier = rola === 'Magazynier';
  const isCrew = isBrygadzista || isPomocnik || isPomBez;
  const dashboardOrders = useMemo(() => filterDashboardOrdersForUser(zlecenia, user), [zlecenia, user]);

  const delayedCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dashboardOrders.filter((z) => {
      if (!z.data_planowana) return false;
      const raw = typeof z.data_planowana === 'string' ? z.data_planowana.split('T')[0] : '';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      if (d >= today) return false;
      const st = z.status || '';
      return !isTaskClosed(st);
    }).length;
  }, [dashboardOrders]);
  const signalCount = useMemo(() => dashboardOrders.filter(dashboardTaskNeedsSignal).length, [dashboardOrders]);
  const riskCount = Math.max(delayedCount, signalCount);
  const activeCount = Number(stats.w_realizacji || 0) + Number(stats.zaplanowane || 0);
  const totalCount = dashboardOrders.length || Number(stats.nowe || 0) + Number(stats.w_realizacji || 0) + Number(stats.zakonczone || 0);
  const taskStatusCounts = useMemo(() => dashboardOrders.reduce<Record<string, number>>((acc, task) => {
    const status = normalizeTaskStatus(task?.status);
    if (status) acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {}), [dashboardOrders]);
  const statNumber = (keys: string[]) => keys.reduce((best, key) => {
    const value = Number(stats?.[key]);
    return Math.max(best, Number.isFinite(value) ? value : 0);
  }, 0);
  const countStatus = (status: string, keys: string[]) =>
    Math.max(taskStatusCounts[status] || 0, statNumber(keys));
  const intakeCount = countStatus(TASK_STATUS.NOWE, ['nowe', 'new']);
  const quoteCount = countStatus(TASK_STATUS.WYCENA_TERENOWA, ['wycena_terenowa', 'wyceny_terenowe', 'ogledziny']);
  const officeCount = countStatus(TASK_STATUS.DO_ZATWIERDZENIA, ['do_zatwierdzenia', 'do_opracowania', 'biuro']);
  const plannedCount = countStatus(TASK_STATUS.ZAPLANOWANE, ['zaplanowane', 'scheduled']);
  const inProgressCount = countStatus(TASK_STATUS.W_REALIZACJI, ['w_realizacji', 'w_toku']);
  const doneCount = countStatus(TASK_STATUS.ZAKONCZONE, ['zakonczone', 'done']);
  const workflowSteps: WorkflowStep[] = [
    { key: 'telefon', title: 'Telefon', subtitle: 'przyjecie', value: intakeCount, icon: 'call-outline', color: ARBOR_UI.leaf, path: '/nowe-zlecenie' },
    { key: 'teren', title: 'Teren', subtitle: 'ogledziny', value: quoteCount, icon: 'camera-outline', color: theme.info, path: '/zlecenia' },
    { key: 'biuro', title: 'Biuro', subtitle: 'opracowanie', value: officeCount, icon: 'file-tray-full-outline', color: ARBOR_UI.warning, path: '/wyceny-do-biura' },
    { key: 'ekipa', title: 'Ekipa', subtitle: 'plan i praca', value: plannedCount + inProgressCount, icon: 'people-circle-outline', color: ARBOR_UI.forest, path: '/harmonogram' },
    { key: 'zamkniecie', title: 'Koniec', subtitle: 'raporty', value: doneCount, icon: 'checkmark-done-outline', color: ARBOR_UI.moss, path: '/raporty-mobilne' },
  ];
  const workflowActiveStep = workflowSteps.find((step) => step.key !== 'zamkniecie' && step.value > 0) || workflowSteps[0];
  const workflowTotal = workflowSteps.reduce((sum, step) => sum + (step.key === 'ekipa' ? 0 : step.value), 0) + plannedCount + inProgressCount;
  const workflowDoneLabel = `${doneCount}/${Math.max(totalCount, workflowTotal, doneCount)}`;
  const dashboardSignal = useMemo(() => {
    const active = zlecenia.filter((task) => !isTaskClosed(task?.status));
    const rows = active
      .map((task) => {
        const field = getTaskFieldExecutionSummary(task);
        const problems = dashboardOpenProblemCount(task);
        const needs = dashboardTaskNeedsSignal(task);
        const priority = problems > 0 ? 0 : field.key === 'missing' ? 1 : field.missingPhotoLabels.length > 0 ? 2 : 3;
        return { task, field, problems, needs, priority };
      })
      .filter((row) => row.needs)
      .sort((a, b) => a.priority - b.priority);
    const checkin = rows.filter((row) => row.field.key === 'missing').length;
    const photos = rows.filter((row) => row.field.missingPhotoLabels.length > 0).length;
    const problems = rows.reduce((sum, row) => sum + row.problems, 0);
    const next = rows[0] || null;
    return {
      total: rows.length,
      checkin,
      photos,
      problems,
      next,
      color: rows.length ? ARBOR_UI.danger : ARBOR_UI.leaf,
      background: rows.length ? ARBOR_UI.dangerSoft : ARBOR_UI.leafSoft,
    };
  }, [zlecenia, ARBOR_UI]);
  const roleBrief = isWyceniajacy
    ? { title: 'Tryb specjalisty ds. wyceny', text: 'Moje ogledziny dzisiaj, telefon, mapa i pakiet dla biura.', action: 'Moje ogledziny', icon: 'map-outline' as IoniconName, path: '/zlecenia' }
    : isSpecjalista
      ? { title: 'Tryb biura', text: 'Dopnij pakiety z terenu, telefon do klienta i gotowy termin dla ekipy.', action: 'Do opracowania', icon: 'file-tray-full-outline' as IoniconName, path: '/wyceny-do-biura' }
      : isCrew
        ? { title: 'Tryb ekipy', text: 'Najpierw dzisiejsza trasa, potem dowody i raport po pracy.', action: 'Tryb Dzisiaj', icon: 'navigate-outline' as IoniconName, path: '/misja-dnia' }
        : isMagazynier
          ? { title: 'Tryb magazynu', text: 'Sprzet, rezerwacje i wydania pod dzisiejsze ekipy.', action: 'Rezerwacje', icon: 'cube-outline' as IoniconName, path: '/rezerwacje-sprzetu' }
          : { title: 'Tryb dyspozytorni', text: 'Kontroluj przeplyw od telefonu do ekipy i zamkniecia raportu.', action: 'Harmonogram', icon: 'calendar-outline' as IoniconName, path: '/harmonogram' };

  const statusKolor = useMemo(() => makeTaskStatusColorMap(theme), [theme]);

  const rolaKolor = useMemo(() => ({
    Dyrektor: getRolaColor('Dyrektor'),
    Administrator: getRolaColor('Administrator'),
    Kierownik: getRolaColor('Kierownik'),
    Brygadzista: getRolaColor('Brygadzista'),
    Specjalista: getRolaColor('Specjalista'),
    Wyceniający: getRolaColor('Wyceniający'),
    Pomocnik: getRolaColor('Pomocnik'),
    'Pomocnik bez doświadczenia': getRolaColor('Pomocnik bez doświadczenia'),
    Magazynier: getRolaColor('Magazynier'),
  }), []);

  const quickActions: QuickAction[] = [
    { label: 'Command Center', icon: 'sparkles-outline' as IoniconName, path: '/task-command-center', color: theme.chartCyan },
    { label: 'Tryb Dzisiaj', icon: 'navigate-circle-outline' as IoniconName, path: '/misja-dnia', color: theme.accent },
    // ── Dyrektor / Administrator / Kierownik ──
    ...(isDyrektor || isKierownik ? [
      { label: 'Autoplan dnia',     icon: 'sparkles-outline' as IoniconName,      path: '/autoplan-dnia',     color: theme.chartCyan },
      { label: 'Nowe zlecenie',     icon: 'add-circle-outline' as IoniconName,    path: '/nowe-zlecenie',    color: theme.success },
      { label: 'Harmonogram',       icon: 'calendar-outline' as IoniconName,       path: '/harmonogram',      color: theme.warning },
      { label: 'Użytkownicy',       icon: 'people-outline' as IoniconName,         path: '/uzytkownicy-mobile', color: theme.info },
      { label: 'Oddziały',          icon: 'business-outline' as IoniconName,       path: '/oddzialy-mobile',  color: theme.accent },
      { label: 'Flota',             icon: 'car-outline' as IoniconName,            path: '/flota-mobile',     color: theme.danger },
      { label: 'Rezerwacje sprzętu', icon: 'calendar-number-outline' as IoniconName, path: '/rezerwacje-sprzetu', color: theme.chartCyan },
      { label: 'Blokady kalendarza', icon: 'ban-outline' as IoniconName, path: '/blokady-kalendarza', color: theme.warning },
      { label: 'Potwierdzenia ekip', icon: 'people-circle-outline' as IoniconName, path: '/potwierdzenia-ekip', color: theme.success },
      { label: 'KPI autoplan (tydzień)', icon: 'stats-chart-outline' as IoniconName, path: '/kpi-tydzien', color: theme.chartCyan },
      { label: 'Magazyn',           icon: 'cube-outline' as IoniconName,           path: '/magazyn-mobile',   color: theme.chartCyan },
      { label: 'Oględziny',         icon: 'search-outline' as IoniconName,           path: '/ogledziny',        color: theme.info },
      { label: 'Plan ogledzin',      icon: 'map-outline' as IoniconName,              path: '/plan-ogledzin',   color: theme.success },
      { label: 'Kal. wycen',        icon: 'calculator-outline' as IoniconName,       path: '/wycena-kalendarz', color: theme.accent },
      { label: 'Wycena u klienta',  icon: 'document-text-outline' as IoniconName,    path: '/wyceny-terenowe', color: theme.success },
      { label: 'Do opracowania',    icon: 'file-tray-full-outline' as IoniconName,   path: '/wyceny-do-biura', color: theme.warning },
      { label: 'Zatwierdź wyceny',  icon: 'checkmark-circle-outline' as IoniconName, path: '/zatwierdz-wyceny', color: theme.warning },
      { label: 'Raporty',           icon: 'bar-chart-outline' as IoniconName,      path: '/raporty-mobilne',  color: theme.info },
      { label: 'Rozliczenia',       icon: 'wallet-outline' as IoniconName,         path: '/rozliczenia',      color: theme.success },
      { label: 'Funkcje oddziałów', icon: 'settings-outline' as IoniconName,       path: '/oddzial-funkcje-admin', color: theme.warning },
      { label: 'CRM',               icon: 'git-network-outline' as IoniconName,    path: '/crm-mobile',       color: theme.chartCyan },
      { label: 'Pipeline CRM',      icon: 'funnel-outline' as IoniconName,         path: '/crm-pipeline-mobile', color: theme.chartCyan },
      { label: 'Klienci',           icon: 'people-outline' as IoniconName,         path: '/klienci-mobile',   color: theme.info },
      { label: 'Telefonia',         icon: 'call-outline' as IoniconName,           path: '/telefonia-mobile', color: theme.success },
    ] : []),
    // ── Widok zleceń dla wszystkich (poza Wyceniającym i Magazynierem) ──
    ...(!isWyceniajacy && !isMagazynier ? [
      { label: 'Zlecenia', icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', color: theme.info },
    ] : []),
    // ── Brygadzista ──
    ...(isBrygadzista ? [
      { label: 'Raport dzienny', icon: 'document-text-outline' as IoniconName, path: '/raport-dzienny', color: theme.success },
      { label: 'Oględziny',      icon: 'search-outline' as IoniconName,        path: '/ogledziny',      color: theme.info },
      { label: 'Kal. wycen',    icon: 'calculator-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.accent },
      { label: 'Rozliczenia',   icon: 'wallet-outline' as IoniconName,        path: '/rozliczenia',    color: theme.warning },
    ] : []),
    // ── Specjalista ──
    ...(isSpecjalista ? [
      { label: 'Kal. wycen',  icon: 'calculator-outline' as IoniconName, path: '/wycena-kalendarz', color: theme.chartCyan },
      { label: 'Do opracowania', icon: 'file-tray-full-outline' as IoniconName, path: '/wyceny-do-biura', color: theme.warning },
      { label: 'Raporty',     icon: 'bar-chart-outline' as IoniconName,  path: '/raporty-mobilne',  color: theme.info },
      { label: 'Rozliczenia', icon: 'wallet-outline' as IoniconName,     path: '/rozliczenia',      color: theme.warning },
    ] : []),
    // ── Wyceniający ──
    ...(isWyceniajacy ? [
      { label: 'Centrum wycen', icon: 'speedometer-outline' as IoniconName, path: '/wyceniajacy-hub', color: theme.accent },
      { label: 'Nowe zlecenie terenowe', icon: 'add-circle-outline' as IoniconName, path: '/nowe-zlecenie', color: theme.success },
      { label: 'Plan ogledzin', icon: 'map-outline' as IoniconName, path: '/plan-ogledzin', color: theme.warning },
      { label: 'Wycena u klienta', icon: 'document-text-outline' as IoniconName, path: '/wyceny-terenowe', color: theme.success },
      { label: 'Wynagrodzenie', icon: 'cash-outline' as IoniconName, path: '/wyceniajacy-finanse', color: theme.success },
      { label: 'Oględziny',    icon: 'search-outline' as IoniconName,      path: '/ogledziny',       color: theme.info },
      { label: 'Kal. wycen',  icon: 'calendar-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.accent },
      { label: 'Nowa wycena', icon: 'add-circle-outline' as IoniconName,  path: '/wycena-kalendarz', color: theme.success },
    ] : []),
    // ── Magazynier ──
    ...(isMagazynier ? [
      { label: 'Flota',        icon: 'car-outline' as IoniconName,       path: '/flota-mobile',  color: theme.warning },
      { label: 'Rezerwacje sprzętu', icon: 'calendar-number-outline' as IoniconName, path: '/rezerwacje-sprzetu', color: theme.chartCyan },
      { label: 'Blokady kalendarza', icon: 'ban-outline' as IoniconName, path: '/blokady-kalendarza', color: theme.warning },
      { label: 'Potwierdzenia ekip', icon: 'people-circle-outline' as IoniconName, path: '/potwierdzenia-ekip', color: theme.success },
      { label: 'KPI autoplan (tydzień)', icon: 'stats-chart-outline' as IoniconName, path: '/kpi-tydzien', color: theme.chartCyan },
      { label: 'Magazyn',     icon: 'cube-outline' as IoniconName,      path: '/magazyn-mobile', color: theme.chartCyan },
      { label: 'Harmonogram',  icon: 'calendar-outline' as IoniconName,  path: '/harmonogram',   color: theme.warning },
    ] : []),
    // ── Pomocnik ──
    ...(isPomocnik ? [
      { label: 'Moje godziny', icon: 'time-outline' as IoniconName, path: '/rozliczenia', color: theme.warning },
    ] : []),
    // ── Pomocnik bez doświadczenia ──
    ...(isPomBez ? [
      { label: 'Moje zlecenia', icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', color: theme.textMuted },
    ] : []),
    // ── Zawsze ──
    { label: 'Diagnostyka API', icon: 'pulse-outline' as IoniconName, path: '/api-diagnostyka', color: theme.info },
    { label: 'Powiadomienia', icon: 'notifications-outline' as IoniconName, path: '/powiadomienia', color: theme.textSub },
    { label: 'Profil',        icon: 'person-outline' as IoniconName,        path: '/profil',        color: theme.textSub },
  ];
  const oddzialConfig = getOddzialFeatureConfig(user?.oddzial_id);
  const quickActionsFiltered = (() => {
    const filtered = quickActions.filter((action) =>
      isFeatureEnabledForOddzial(user?.oddzial_id, action.path),
    );
    const orderedPaths = sortPathsByOddzialPriority(user?.oddzial_id, filtered.map((a) => a.path));
    const rank = new Map(orderedPaths.map((path, idx) => [path, idx]));
    return filtered.sort((a, b) => (rank.get(a.path) ?? 999) - (rank.get(b.path) ?? 999));
  })();
  const focusActionPaths = isWyceniajacy
    ? ['/nowe-zlecenie', '/plan-ogledzin', '/wyceny-terenowe', '/wyceniajacy-hub']
    : isCrew
      ? ['/misja-dnia', '/zlecenia', '/raport-dzienny', '/rozliczenia']
      : isMagazynier
        ? ['/rezerwacje-sprzetu', '/magazyn-mobile', '/flota-mobile', '/harmonogram']
        : isSpecjalista
          ? ['/wyceny-do-biura', '/wycena-kalendarz', '/raporty-mobilne', '/rozliczenia']
          : ['/nowe-zlecenie', '/harmonogram', '/wyceny-do-biura', '/zlecenia'];
  const focusActions = focusActionPaths
    .map((path) => quickActionsFiltered.find((action) => action.path === path))
    .filter((action): action is QuickAction => Boolean(action))
    .slice(0, 4);

  const quickSections = useMemo(() => {
    const byCat = new Map<QuickCategoryId, QuickAction[]>();
    QUICK_CATEGORY_ORDER.forEach((c) => byCat.set(c, []));
    for (const a of quickActionsFiltered) {
      const cat = quickCategoryForAction(a.path, a.label);
      const bucket = byCat.get(cat) ?? byCat.get('planning')!;
      bucket.push(a);
    }
    return QUICK_CATEGORY_ORDER.map((key) => ({
      key,
      title: t(`dashboard.quickCat.${key}`),
      actions: byCat.get(key) ?? [],
    })).filter((s) => s.actions.length > 0);
  }, [quickActionsFiltered, t]);
  const quickFilterOptions = useMemo(() => {
    const sectionOptions = quickSections.map((section) => ({
      key: section.key as QuickFilterKey,
      title: section.title,
      count: section.actions.length,
      icon: 'grid-outline' as IoniconName,
    }));
    return [
      { key: 'focus' as QuickFilterKey, title: 'Priorytety', count: focusActions.length, icon: 'flash-outline' as IoniconName },
      { key: 'all' as QuickFilterKey, title: 'Wszystkie', count: quickActionsFiltered.length, icon: 'apps-outline' as IoniconName },
      ...sectionOptions,
    ].filter((option) => option.count > 0);
  }, [focusActions.length, quickActionsFiltered.length, quickSections]);
  const visibleQuickSections = useMemo(() => {
    if (quickFilter === 'focus') {
      return [{ key: 'focus' as const, title: 'Priorytety', actions: focusActions }];
    }
    if (quickFilter === 'all') return quickSections;
    return quickSections.filter((section) => section.key === quickFilter);
  }, [focusActions, quickFilter, quickSections]);

  const dzisiaj = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const dzisiajLocalized = new Date().toLocaleDateString(dateLocale, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  /** Etykiety szybkiego dostępu — pełny tekst (lista jak iOS Settings). */
  const quickActionListLabel = (label: string): string => {
    const keyMap: Record<string, string> = {
      'Command Center': 'dashboard.commandCenter',
      'Tryb Dzisiaj': 'dashboard.todayMode',
      'Autoplan dnia': 'dashboard.autoplan',
      'Nowe zlecenie': 'dashboard.newTask',
      'Harmonogram': 'dashboard.schedule',
      'Użytkownicy': 'dashboard.users',
      'Oddziały': 'dashboard.branches',
      'Flota': 'dashboard.fleet',
      'Rezerwacje sprzętu': 'dashboard.equipmentReservations',
      'Blokady kalendarza': 'dashboard.calendarBlocks',
      'Potwierdzenia ekip': 'dashboard.crewConfirm',
      'KPI autoplan (tydzień)': 'dashboard.kpiWeek',
      'Magazyn': 'dashboard.warehouse',
      'Plan ogledzin': 'dashboard.inspections',
      'Oględziny': 'dashboard.inspections',
      'Kal. wycen': 'dashboard.quoteCalendar',
      'Zatwierdź wyceny': 'dashboard.approveQuotes',
      'Raporty': 'dashboard.reports',
      'Rozliczenia': 'dashboard.settlements',
      'Funkcje oddziałów': 'dashboard.branchFeatures',
      'CRM': 'dashboard.crm',
      'Klienci': 'dashboard.clients',
      'Telefonia': 'dashboard.telephony',
      'Zlecenia': 'dashboard.orders',
      'Raport dzienny': 'dashboard.dailyReport',
      'Centrum wycen': 'dashboard.estimateCenter',
      'Nowe zlecenie terenowe': 'dashboard.newTask',
      'Wynagrodzenie': 'dashboard.estimatorPay',
      'Nowa wycena': 'dashboard.newQuote',
      'Diagnostyka API': 'dashboard.apiDiagnostics',
      'Powiadomienia': 'dashboard.notifications',
      'Profil': 'dashboard.profile',
      'Moje godziny': 'dashboard.settlements',
      'Moje zlecenia': 'dashboard.orders',
    };
    const key = keyMap[label];
    return key ? t(key) : label;
  };

  const S = makeStyles(theme);

  if (loading) {
    return (
      <View style={S.root}>
        <StatusBar
          barStyle={'light-content'}
          backgroundColor={ARBOR_UI.paper}
        />
        <DashboardSkeleton />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={ARBOR_UI.paper}
      />

      {/* ─── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <Text style={S.greeting}>{t('dashboard.greeting', { name: user?.imie || '' })}</Text>
          <Text style={S.date}>{dzisiajLocalized || dzisiaj}</Text>
          <View style={[S.rolaBadge, { backgroundColor: (rolaKolor[user?.rola as keyof typeof rolaKolor] || theme.accent) + '33' }]}>
            <Text style={[S.rolaText, { color: rolaKolor[user?.rola as keyof typeof rolaKolor] || theme.accent }]}>
              {rolaLabel}
            </Text>
          </View>
          <Text style={S.oddzialText}>{oddzialConfig.name}</Text>
          <Text style={S.oddzialSub}>{oddzialConfig.mission}</Text>
        </View>
        <View style={S.headerRight}>
          <TouchableOpacity
            style={S.commandCenterBtn}
            onPress={() => {
              void openWithContext('/task-command-center', 'Command Center', 'dashboard-header');
            }}
          >
            <Ionicons name="search-outline" size={18} color={ARBOR_UI.forest} />
          </TouchableOpacity>
          <TouchableOpacity style={S.avatar} onPress={() => void openWithContext('/profil', 'Profil', 'dashboard-header')}>
            <Text style={S.avatarText}>{user?.imie?.[0]}{user?.nazwisko?.[0]}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={S.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ARBOR_UI.forest}
            colors={[ARBOR_UI.forest]}
          />
        }
      >
        {loadError ? (
          <View style={S.errorBanner}>
            <View style={S.errorTop}>
              <View style={S.errorIcon}>
                <Ionicons name="cloud-offline-outline" size={18} color={theme.warning} />
              </View>
              <View style={S.errorBody}>
                <Text style={S.errorTitle}>Dane wymagaja odswiezenia</Text>
                <Text style={S.errorText} numberOfLines={3}>{loadError}</Text>
              </View>
            </View>
            <View style={S.errorActions}>
              <TouchableOpacity style={S.errorActionPrimary} onPress={onRefresh}>
                <Ionicons name="refresh-outline" size={15} color={theme.accentText} />
                <Text style={S.errorActionPrimaryText}>Ponow</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.errorActionSecondary}
                onPress={() => { void openWithContext('/api-diagnostyka', 'Diagnostyka API', 'dashboard-error'); }}
              >
                <Ionicons name="pulse-outline" size={15} color={theme.accent} />
                <Text style={S.errorActionSecondaryText}>Diagnostyka</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {/* ─── KPI KARTY ─────────────────────────────────────────────────────── */}
        <View style={S.opsHero}>
          <View style={S.opsHeroTop}>
            <View style={S.opsLeafBadge}>
              <Ionicons name="leaf-outline" size={22} color={ARBOR_UI.forest} />
            </View>
            <View style={S.opsHeroText}>
              <Text style={S.opsEyebrow}>ARBOR-OS MOBILE</Text>
              <Text style={S.opsTitle}>Centrum operacji terenowych</Text>
              <Text style={S.opsSubtitle}>{oddzialConfig.name} / {rolaLabel}</Text>
            </View>
          </View>
          <View style={S.opsHeroMetrics}>
            <View style={S.opsMetric}>
              <Text style={S.opsMetricValue}>{activeCount}</Text>
              <Text style={S.opsMetricLabel}>Aktywne</Text>
            </View>
            <View style={S.opsMetricDivider} />
            <View style={[S.opsMetric, riskCount > 0 && { backgroundColor: ARBOR_UI.dangerSoft, borderRadius: 10 }]}>
              <Text style={[S.opsMetricValue, riskCount > 0 && { color: ARBOR_UI.danger }]}>{riskCount}</Text>
              <Text style={S.opsMetricLabel}>{signalCount > delayedCount ? 'Sygnały' : 'Ryzyka'}</Text>
            </View>
            <View style={S.opsMetricDivider} />
            <View style={S.opsMetric}>
              <Text style={S.opsMetricValue}>{totalCount}</Text>
              <Text style={S.opsMetricLabel}>Razem</Text>
            </View>
          </View>
        </View>

        {(zlecenia.length > 0 || isCrew || isWyceniajacy) ? (
          <TouchableOpacity
            style={[
              S.signalCard,
              {
                borderColor: dashboardSignal.color + '55',
                backgroundColor: dashboardSignal.background,
              },
            ]}
            onPress={() => {
              void openWithContext(
                dashboardSignal.total ? '/zlecenia?mode=needsSignal' : '/zlecenia',
                dashboardSignal.total ? 'Brak sygnalu' : 'Sygnaly terenowe',
                'dashboard-field-signal',
              );
            }}
          >
            <View style={[S.signalIcon, { borderColor: dashboardSignal.color + '55', backgroundColor: ARBOR_UI.paper }]}>
              <Ionicons name={dashboardSignal.total ? 'radio-outline' : 'checkmark-done-outline'} size={20} color={dashboardSignal.color} />
            </View>
            <View style={S.signalBody}>
              <View style={S.signalTop}>
                <Text style={[S.signalTitle, { color: dashboardSignal.color }]}>
                  {dashboardSignal.total ? 'Brak sygnalu z terenu' : 'Sygnaly terenowe OK'}
                </Text>
                <Text style={[S.signalCount, { color: dashboardSignal.color }]}>{dashboardSignal.total}</Text>
              </View>
              <Text style={S.signalSub} numberOfLines={2}>
                {dashboardSignal.next
                  ? `${dashboardSignal.next.task?.klient_nazwa || `Zlecenie #${dashboardSignal.next.task?.id}`}: ${dashboardSignal.next.problems > 0 ? `${dashboardSignal.next.problems} problem` : dashboardSignal.next.field.detail}`
                  : 'Nie ma blokad check-in, zdjec ani otwartych problemow.'}
              </Text>
              <View style={S.signalPills}>
                {[
                  { key: 'checkin', label: 'Check-in', value: dashboardSignal.checkin },
                  { key: 'photos', label: 'Foto', value: dashboardSignal.photos },
                  { key: 'problems', label: 'Problemy', value: dashboardSignal.problems },
                ].map((item) => (
                  <View key={item.key} style={[S.signalPill, { borderColor: dashboardSignal.color + '40', backgroundColor: ARBOR_UI.paper }]}>
                    <Text style={[S.signalPillValue, { color: dashboardSignal.color }]}>{item.value}</Text>
                    <Text style={S.signalPillLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={dashboardSignal.color} />
          </TouchableOpacity>
        ) : null}

        <View style={S.workflowCard}>
          <View style={S.workflowHead}>
            <View style={S.workflowTitleBlock}>
              <View style={S.workflowIcon}>
                <Ionicons name="git-network-outline" size={18} color={ARBOR_UI.forest} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.workflowTitle}>Proces dnia</Text>
                <Text style={S.workflowSub}>Telefon - teren - biuro - ekipa - raport</Text>
              </View>
            </View>
            <TouchableOpacity
              style={S.workflowNowBtn}
              onPress={() => {
                const path = isFeatureEnabledForOddzial(user?.oddzial_id, workflowActiveStep.path)
                  ? workflowActiveStep.path
                  : '/task-command-center';
                void openWithContext(path, workflowActiveStep.title, 'dashboard-workflow-now');
              }}
            >
              <Text style={S.workflowNowText}>{workflowActiveStep.title}</Text>
              <Ionicons name="chevron-forward" size={15} color={ARBOR_UI.forest} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.workflowStrip}>
            {workflowSteps.map((step) => {
              const active = step.key === workflowActiveStep.key;
              return (
                <TouchableOpacity
                  key={step.key}
                  style={[S.workflowStep, active && S.workflowStepActive]}
                  onPress={() => {
                    const path = isFeatureEnabledForOddzial(user?.oddzial_id, step.path)
                      ? step.path
                      : '/task-command-center';
                    void openWithContext(path, step.title, `dashboard-workflow-${step.key}`);
                  }}
                >
                  <View style={[S.workflowStepIcon, { backgroundColor: step.color + '18', borderColor: step.color + '55' }]}>
                    <Ionicons name={step.icon} size={16} color={step.color} />
                  </View>
                  <Text style={S.workflowStepValue}>{step.value}</Text>
                  <Text style={S.workflowStepTitle} numberOfLines={1}>{step.title}</Text>
                  <Text style={S.workflowStepSub} numberOfLines={1}>{step.subtitle}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={S.roleBrief}>
            <View style={S.roleBriefLeft}>
              <View style={S.roleBriefIcon}>
                <Ionicons name={roleBrief.icon} size={18} color={ARBOR_UI.forest} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.roleBriefTitle}>{roleBrief.title}</Text>
                <Text style={S.roleBriefText}>{roleBrief.text}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={S.roleBriefBtn}
              onPress={() => {
                const path = isFeatureEnabledForOddzial(user?.oddzial_id, roleBrief.path)
                  ? roleBrief.path
                  : '/task-command-center';
                void openWithContext(path, roleBrief.action, 'dashboard-role-brief');
              }}
            >
              <Text style={S.roleBriefBtnText}>{roleBrief.action}</Text>
            </TouchableOpacity>
          </View>
          <View style={S.workflowFooter}>
            <Text style={S.workflowFooterText}>Zamkniete</Text>
            <Text style={S.workflowFooterValue}>{workflowDoneLabel}</Text>
          </View>
        </View>

        {focusActions.length > 0 ? (
          <View style={S.focusDeck}>
            <View style={S.focusDeckHead}>
              <View style={S.focusDeckTitleWrap}>
                <View style={S.focusDeckIcon}>
                  <Ionicons name="compass-outline" size={17} color={ARBOR_UI.forest} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.focusDeckTitle}>Najwazniejsze teraz</Text>
                  <Text style={S.focusDeckSub}>Szybki start pod Twoja role i oddzial.</Text>
                </View>
              </View>
              <Text style={S.focusDeckCount}>{focusActions.length}</Text>
            </View>
            <View style={S.focusGrid}>
              {focusActions.map((action, index) => (
                <TouchableOpacity
                  key={`${action.path}-${index}`}
                  style={[S.focusActionCard, index === 0 && S.focusActionPrimary]}
                  onPress={() => {
                    void openWithContext(action.path, quickActionListLabel(action.label), 'dashboard-focus');
                  }}
                >
                  <View style={[S.focusActionIcon, { backgroundColor: action.color + '18', borderColor: action.color + '55' }]}>
                    <Ionicons name={action.icon} size={18} color={action.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={S.focusActionTitle} numberOfLines={1}>{quickActionListLabel(action.label)}</Text>
                    <Text style={S.focusActionHint} numberOfLines={2}>{dashboardFocusHint(action.path)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={ARBOR_UI.muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {!isWyceniajacy && <View style={S.statsRow}>
          {[
            { label: t('dashboard.stats.new'), value: stats.nowe || 0, color: ARBOR_UI.leaf, icon: 'flash-outline' as IoniconName },
            { label: t('dashboard.stats.progress'), value: stats.w_realizacji || 0, color: ARBOR_UI.warning, icon: 'sync-outline' as IoniconName },
            { label: t('dashboard.stats.done'), value: stats.zakonczone || 0, color: ARBOR_UI.forest, icon: 'checkmark-circle-outline' as IoniconName },
            { label: t('dashboard.stats.total'), value: dashboardOrders.length, color: ARBOR_UI.moss, icon: 'list-outline' as IoniconName },
          ].map((s, i) => (
            <PlatinumAppear key={i} delayMs={40 * i} style={S.statWrap}>
              <View style={[S.statCard, { borderTopColor: s.color }]}>
                <PlatinumIconBadge icon={s.icon} color={s.color} size={26} />
                <Text style={[S.statNum, { color: s.color }]}>{s.value}</Text>
                <Text style={S.statLabel}>{s.label}</Text>
              </View>
            </PlatinumAppear>
          ))}
        </View>}
        {!isWyceniajacy && delayedCount > 0 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 14 }}>
              {t('dashboard.delayed')}: {delayedCount}
            </Text>
          </View>
        ) : null}

        <PlatinumCard style={[S.section, elevationCard(theme)]} glow>
          <Text style={S.sectionTitle}>{t('dashboard.branchMode')}</Text>
          <Text style={S.oddzialMission}>{oddzialConfig.mission}</Text>
          <Text style={S.oddzialFocus}>{t('dashboard.priority', { focus: oddzialConfig.focus })}</Text>
        </PlatinumCard>

        <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <View style={S.sectionHeader}>
            <Text style={S.sectionTitle}>{t('command.sectionRecent')}</Text>
            <TouchableOpacity
              onPress={() => {
                void openWithContext('/task-command-center', t('dashboard.commandCenter'), 'dashboard-recent');
              }}
              style={S.seeAllBtn}
            >
              <Text style={S.seeAll}>{t('dashboard.commandCenter')}</Text>
              <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={16} style={S.seeAllIcon} />
            </TouchableOpacity>
          </View>
          {recentContexts.length === 0 ? (
            <Text style={S.recentEmpty}>{t('command.emptyRecent')}</Text>
          ) : (
            <View style={S.recentList}>
              {recentContexts.slice(0, 4).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={S.recentRow}
                  onPress={() => {
                    void openWithContext(item.path, item.label, item.meta);
                  }}
                >
                  <Ionicons name="time-outline" size={16} color={theme.textMuted} />
                  <View style={S.recentBody}>
                    <Text style={S.recentLabel}>{item.label}</Text>
                    <Text style={S.recentMeta}>{item.meta || item.path}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </PlatinumCard>

        {/* ─── SZYBKI DOSTĘP (iOS-style grouped list) ─────────────────────────── */}
        <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <View style={S.quickAccessHead}>
            <View style={{ flex: 1 }}>
              <Text style={S.sectionTitle}>{t('dashboard.quickAccess')}</Text>
              <Text style={S.quickAccessSub}>Moduly sa ulozone wedlug procesu: sprzedaz, planowanie, wykonanie i firma.</Text>
            </View>
            <View style={S.quickAccessCount}>
              <Text style={S.quickAccessCountText}>{visibleQuickSections.reduce((sum, section) => sum + section.actions.length, 0)}</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.quickFilterStrip}>
            {quickFilterOptions.map((option) => {
              const active = quickFilter === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[S.quickFilterChip, active && S.quickFilterChipActive]}
                  onPress={() => {
                    setQuickFilter(option.key);
                    void triggerHaptic('light');
                  }}
                >
                  <Ionicons name={option.icon} size={14} color={active ? ARBOR_UI.forest : ARBOR_UI.muted} />
                  <Text style={[S.quickFilterText, active && S.quickFilterTextActive]} numberOfLines={1}>{option.title}</Text>
                  <Text style={[S.quickFilterCount, active && S.quickFilterTextActive]}>{option.count}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {visibleQuickSections.map((section, si) => (
            <View key={section.key} style={si > 0 ? S.quickSectionSpacer : S.quickSectionFirst}>
              <Text style={S.quickSectionLabel}>{section.title}</Text>
              <View style={S.quickListGroup}>
                {section.actions.map((a, i) => (
                  <Fragment key={`${section.key}-${a.path}-${a.label}-${i}`}>
                    {i > 0 ? <View style={S.quickListHairline} /> : null}
                    <Pressable
                      onPress={() => {
                        void openWithContext(a.path, quickActionListLabel(a.label), 'dashboard-quick-access');
                      }}
                      style={({ pressed }) => [S.quickListRow, pressed && S.quickListRowPressed]}
                    >
                      <View style={S.quickListIconTile}>
                        <Ionicons name={a.icon} size={21} color={theme.textSub} />
                      </View>
                      <Text style={S.quickListTitle} numberOfLines={2}>
                        {quickActionListLabel(a.label)}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            </View>
          ))}
        </PlatinumCard>

        {/* ─── OSTATNIE ZLECENIA ──────────────────────────────────────────────── */}
        {!isWyceniajacy && <PlatinumCard style={[S.section, elevationCard(theme)]} glow>
          <View style={S.sectionHeader}>
            <Text style={S.sectionTitle}>
              {isCrew ? t('dashboard.myTasks') : t('dashboard.latestTasks')}
            </Text>
            <TouchableOpacity onPress={() => { void openWithContext('/zlecenia', t('dashboard.orders'), 'dashboard-latest-orders'); }} style={S.seeAllBtn}>
              <Text style={S.seeAll}>{t('dashboard.seeAll')}</Text>
              <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={16} style={S.seeAllIcon} />
            </TouchableOpacity>
          </View>

          {dashboardOrders.length === 0 ? (
            <View style={S.empty}>
              <PlatinumIconBadge icon="clipboard-outline" color={theme.textMuted} size={28} style={S.emptyIconBadge} />
              <Text style={S.emptyTitle}>{t('dashboard.emptyOrders')}</Text>
              <Text style={S.emptySub}>
                {isCrew
                  ? t('dashboard.emptyOrdersSubBrygadzista')
                  : t('dashboard.emptyOrdersSubDefault')}
              </Text>
            </View>
          ) : (
            dashboardOrders.slice(0, 5).map((z, i) => (
              <PlatinumAppear key={z.id} delayMs={35 * i}>
                <PlatinumPressable
                  style={S.card}
                  onPress={() => { void openWithContext(`/zlecenie/${z.id}`, `${t('dashboard.orders')} #${z.id}`, z.klient_nazwa || ''); }}
                >
                <View style={[S.cardAccent, { backgroundColor: statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted }]} />
                <View style={S.cardBody}>
                  <View style={S.cardTop}>
                    <Text style={S.cardId}>#{z.id}</Text>
                    <View style={[S.statusBadge, { backgroundColor: (statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted) + '28' }]}>
                      <Text style={[S.statusText, { color: statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted }]}>
                        {z.status?.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  <Text style={S.cardKlient}>{z.klient_nazwa}</Text>
                  <View style={[S.cardMetaRow, { justifyContent: 'space-between' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <PlatinumIconBadge icon="location-outline" color={theme.textSub} size={16} style={S.metaIconBadge} />
                      <Text style={S.cardAddr}> {z.adres}, {z.miasto}</Text>
                    </View>
                    {(z.adres || z.miasto) ? (
                      <TouchableOpacity
                        onPress={() => { void openAddressInMaps(z.adres || '', z.miasto || ''); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <PlatinumIconBadge icon="map-outline" color={theme.accent} size={18} style={S.metaMapBadge} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={S.cardBottom}>
                    {z.typ_uslugi ? (
                      <View style={S.typChip}>
                        <Text style={S.typChipText}>{z.typ_uslugi}</Text>
                      </View>
                    ) : null}
                    {!isPomocnik && !isBrygadzista && z.wartosc_planowana ? (
                      <Text style={S.cardWartosc}>
                        {parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN
                      </Text>
                    ) : null}
                  </View>
                  {z.ekipa_nazwa ? (
                    <View style={S.cardMetaRow}>
                      <PlatinumIconBadge icon="people-outline" color={theme.textSub} size={16} style={S.metaIconBadge} />
                      <Text style={S.cardEkipa}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                </View>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={18} style={S.chevronBadge} />
                </PlatinumPressable>
              </PlatinumAppear>
            ))
          )}
        </PlatinumCard>}

        <View style={{ height: 128 }} />
      </ScrollView>

      {/* ─── DOLNA NAWIGACJA ────────────────────────────────────────────────── */}
      <View style={S.nav}>
        {([
          { icon: 'home', path: '/dashboard', labelKey: 'dashboard.nav.start' },
          ...(isWyceniajacy
            ? [{ icon: 'calculator-outline' as IoniconName, path: '/wycena', labelKey: 'dashboard.nav.quotes' }]
            : isCrew
              ? [{ icon: 'navigate-circle-outline' as IoniconName, path: '/misja-dnia', labelKey: 'dashboard.todayMode' }]
            : [{ icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', labelKey: 'dashboard.nav.orders' }]),
          ...(isCrew || isDyrektor || isKierownik
            ? [{ icon: 'wallet-outline' as IoniconName, path: '/rozliczenia', labelKey: 'dashboard.nav.finance' }]
            : []),
          { icon: 'notifications-outline', path: '/powiadomienia', labelKey: 'dashboard.nav.alerts' },
          { icon: 'person-outline', path: '/profil', labelKey: 'dashboard.profile' },
        ] as { icon: IoniconName; path: string; labelKey: string }[])
          .filter((item) => item.path === '/dashboard' || isFeatureEnabledForOddzial(user?.oddzial_id, item.path))
          .map((n, i) => {
          const active = n.path === '/dashboard';
          return (
            <TouchableOpacity key={i} style={[S.navBtn, active && S.navBtnActive]} onPress={() => { void triggerHaptic('light'); router.push(n.path as any); }}>
              <Ionicons
                name={n.icon}
                size={24}
                color={active ? ARBOR_UI.forest : ARBOR_UI.inactive}
              />
              <Text style={[S.navLabel, active && { color: theme.navActive }]}>
                {t(n.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) => {
  const ARBOR_UI = arborColors(t);
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: ARBOR_UI.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: ARBOR_UI.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 4 },

  // Header
  header: {
    backgroundColor: ARBOR_UI.paper,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ARBOR_UI.line,
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 24, fontWeight: '900', color: ARBOR_UI.text, marginBottom: 2, letterSpacing: 0 },
  date: { fontSize: t.fontCaption, color: ARBOR_UI.muted, marginBottom: 10, textTransform: 'capitalize' },
  rolaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20,
  },
  rolaText: { fontSize: 12, fontWeight: '700' },
  oddzialText: { fontSize: 11, color: ARBOR_UI.forest, marginTop: 6, fontWeight: '800' },
  oddzialSub: { fontSize: 11, color: ARBOR_UI.muted, marginTop: 3 },
  headerRight: { alignItems: 'flex-end', gap: 10 },
  commandCenterBtn: {
    width: 48,
    height: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ARBOR_UI.paperSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: ARBOR_UI.leafSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ARBOR_UI.line,
  },
  avatarText: { fontSize: 15, fontWeight: '900', color: ARBOR_UI.forest },

  errorBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ARBOR_UI.warningBorder,
    backgroundColor: ARBOR_UI.warningSoft,
    gap: 12,
  },
  errorTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  errorIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: ARBOR_UI.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBody: { flex: 1, gap: 2 },
  errorTitle: { color: ARBOR_UI.warningText, fontSize: 13, fontWeight: '900' },
  errorText: { color: ARBOR_UI.muted, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  errorActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  errorActionPrimary: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: ARBOR_UI.forest,
  },
  errorActionPrimaryText: { color: ARBOR_UI.onAccent, fontSize: 12, fontWeight: '900' },
  errorActionSecondary: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: ARBOR_UI.paper,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
  },
  errorActionSecondaryText: { color: ARBOR_UI.forest, fontSize: 12, fontWeight: '900' },

  opsHero: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: ARBOR_UI.paper,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    ...shadowStyle(t, { opacity: 0.08, radius: 14, offsetY: 3, elevation: 3 }),
    gap: 14,
  },
  opsHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  opsLeafBadge: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: ARBOR_UI.leafSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
  },
  opsHeroText: { flex: 1 },
  opsEyebrow: { color: ARBOR_UI.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0 },
  opsTitle: { color: ARBOR_UI.text, fontSize: 18, fontWeight: '900', letterSpacing: 0, marginTop: 2 },
  opsSubtitle: { color: ARBOR_UI.muted, fontSize: 12, fontWeight: '700', marginTop: 3 },
  opsHeroMetrics: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: ARBOR_UI.bgSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    paddingVertical: 10,
  },
  opsMetric: { flex: 1, alignItems: 'center', gap: 2 },
  opsMetricValue: { color: ARBOR_UI.forest, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  opsMetricLabel: { color: ARBOR_UI.muted, fontSize: 11, fontWeight: '800' },
  opsMetricDivider: { width: 1, backgroundColor: ARBOR_UI.line },
  signalCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...shadowStyle(t, { opacity: 0.07, radius: 12, offsetY: 2, elevation: Math.max(1, t.cardElevation - 1) }),
  },
  signalIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalBody: { flex: 1, gap: 7 },
  signalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  signalTitle: { flex: 1, fontSize: 14, fontWeight: '900' },
  signalCount: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  signalSub: { color: ARBOR_UI.muted, fontSize: 11.5, lineHeight: 16, fontWeight: '800' },
  signalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  signalPill: {
    minHeight: 26,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signalPillValue: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  signalPillLabel: { color: ARBOR_UI.muted, fontSize: 10, fontWeight: '900' },
  workflowCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: ARBOR_UI.paper,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    ...shadowStyle(t, { opacity: 0.07, radius: 12, offsetY: 2, elevation: Math.max(1, t.cardElevation - 1) }),
    gap: 12,
  },
  workflowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  workflowTitleBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  workflowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: ARBOR_UI.leafSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowTitle: { color: ARBOR_UI.text, fontSize: 15, fontWeight: '900' },
  workflowSub: { color: ARBOR_UI.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  workflowNowBtn: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: ARBOR_UI.bgSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  workflowNowText: { color: ARBOR_UI.forest, fontSize: 11, fontWeight: '900' },
  workflowStrip: { gap: 8, paddingRight: 4 },
  workflowStep: {
    minWidth: 104,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    backgroundColor: ARBOR_UI.paperSoft,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 3,
  },
  workflowStepActive: {
    backgroundColor: ARBOR_UI.leafSoft,
    borderColor: ARBOR_UI.leafBorder,
  },
  workflowStepIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  workflowStepValue: {
    color: ARBOR_UI.text,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  workflowStepTitle: { color: ARBOR_UI.text, fontSize: 12, fontWeight: '900' },
  workflowStepSub: { color: ARBOR_UI.muted, fontSize: 10, fontWeight: '800' },
  roleBrief: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ARBOR_UI.leafBorder,
    backgroundColor: ARBOR_UI.leafSoft,
    padding: 11,
    gap: 10,
  },
  roleBriefLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleBriefIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ARBOR_UI.paper,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBriefTitle: { color: ARBOR_UI.text, fontSize: 13, fontWeight: '900' },
  roleBriefText: { color: ARBOR_UI.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  roleBriefBtn: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: ARBOR_UI.forest,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBriefBtnText: { color: ARBOR_UI.onAccent, fontSize: 12, fontWeight: '900' },
  workflowFooter: {
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: ARBOR_UI.bgSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workflowFooterText: { color: ARBOR_UI.muted, fontSize: 11, fontWeight: '900' },
  workflowFooterValue: {
    color: ARBOR_UI.forest,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  focusDeck: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: ARBOR_UI.paper,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    ...shadowStyle(t, { opacity: 0.07, radius: 12, offsetY: 2, elevation: Math.max(1, t.cardElevation - 1) }),
    gap: 12,
  },
  focusDeckHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  focusDeckTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  focusDeckIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: ARBOR_UI.leafSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusDeckTitle: { color: ARBOR_UI.text, fontSize: 15, fontWeight: '900' },
  focusDeckSub: { color: ARBOR_UI.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  focusDeckCount: {
    minWidth: 34,
    textAlign: 'center',
    color: ARBOR_UI.forest,
    backgroundColor: ARBOR_UI.bgSoft,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    overflow: 'hidden',
  },
  focusGrid: { gap: 8 },
  focusActionCard: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    backgroundColor: ARBOR_UI.paperSoft,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  focusActionPrimary: {
    backgroundColor: ARBOR_UI.paper,
    borderColor: ARBOR_UI.leafBorder,
  },
  focusActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusActionTitle: { color: ARBOR_UI.text, fontSize: 13, fontWeight: '900' },
  focusActionHint: { color: ARBOR_UI.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  // Statystyki
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'transparent',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4,
    gap: 8,
  },
  statWrap: { width: '48%' },
  statCard: {
    backgroundColor: ARBOR_UI.paper,
    borderRadius: 16, padding: 12,
    alignItems: 'center', gap: 4,
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    ...shadowStyle(t, { opacity: 0.07, radius: 10, offsetY: 2, elevation: Math.max(1, t.cardElevation - 1) }),
  },
  statNum: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: t.fontMicro, color: ARBOR_UI.muted, textAlign: 'center', fontWeight: '700' },

  // Sekcje
  section: {
    backgroundColor: ARBOR_UI.paper,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: ARBOR_UI.line,
    ...shadowStyle(t, { opacity: 0.08, radius: 12, offsetY: 2, elevation: Math.max(1, t.cardElevation - 1) }),
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  sectionTitle: {
    fontSize: t.fontSection, fontWeight: '900',
    color: ARBOR_UI.text,
  },
  oddzialMission: { fontSize: 14, fontWeight: '800', color: ARBOR_UI.text, marginBottom: 4 },
  oddzialFocus: { fontSize: 12, color: ARBOR_UI.muted },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAll: { fontSize: 13, color: ARBOR_UI.forest, fontWeight: '800' },
  seeAllIcon: { width: 36, height: 36, borderRadius: 10 },
  recentEmpty: { fontSize: 12, color: ARBOR_UI.muted },
  recentList: { gap: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    backgroundColor: ARBOR_UI.paperSoft,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  recentBody: { flex: 1 },
  recentLabel: { fontSize: 13, fontWeight: '800', color: ARBOR_UI.text },
  recentMeta: { fontSize: 11, color: ARBOR_UI.muted, marginTop: 1 },

  // Szybki dostęp — kategorie + lista iOS (grupa inset)
  quickAccessHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickAccessSub: {
    color: ARBOR_UI.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  quickAccessCount: {
    minWidth: 38,
    minHeight: 34,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    borderRadius: 12,
    backgroundColor: ARBOR_UI.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  quickAccessCountText: {
    color: ARBOR_UI.forest,
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  quickFilterStrip: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
    paddingRight: 4,
  },
  quickFilterChip: {
    minHeight: 36,
    maxWidth: 150,
    borderWidth: 1,
    borderColor: ARBOR_UI.line,
    borderRadius: 999,
    backgroundColor: ARBOR_UI.paperSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickFilterChipActive: {
    backgroundColor: ARBOR_UI.leafSoft,
    borderColor: ARBOR_UI.leafBorder,
  },
  quickFilterText: { color: ARBOR_UI.muted, fontSize: 11, fontWeight: '900', maxWidth: 92 },
  quickFilterTextActive: { color: ARBOR_UI.forest },
  quickFilterCount: {
    color: ARBOR_UI.muted,
    fontSize: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  quickSectionFirst: { marginTop: 10 },
  quickSectionSpacer: { marginTop: 20 },
  quickSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: ARBOR_UI.muted,
    letterSpacing: 0,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  quickListGroup: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: ARBOR_UI.paperSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ARBOR_UI.line,
  },
  quickListHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: ARBOR_UI.line,
    marginLeft: 60,
  },
  quickListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: ARBOR_UI.paperSoft,
  },
  quickListRowPressed: {
    backgroundColor: ARBOR_UI.leafSoft,
  },
  quickListIconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ARBOR_UI.leafSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ARBOR_UI.line,
  },
  quickListTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: ARBOR_UI.text,
    letterSpacing: 0,
    lineHeight: 22,
    paddingRight: 6,
  },

  // Puste
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyIconBadge: { width: 52, height: 52, borderRadius: 16 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: ARBOR_UI.text },
  emptySub: { fontSize: 13, color: ARBOR_UI.muted, textAlign: 'center' },

  // Karty zleceń
  card: {
    flexDirection: 'row',
    backgroundColor: ARBOR_UI.paper,
    borderRadius: 16,
    borderWidth: 1, borderColor: ARBOR_UI.line,
    marginBottom: 10, overflow: 'hidden',
    ...elevationCard(t),
  },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 12 },
  cardTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6,
  },
  cardId: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardKlient: {
    fontSize: 15, fontWeight: '900',
    color: ARBOR_UI.text, marginBottom: 4,
  },
  cardMetaRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 4,
  },
  metaIconBadge: { width: 36, height: 36, borderRadius: 10 },
  metaMapBadge: { width: 40, height: 40, borderRadius: 12 },
  cardAddr: { fontSize: 12, color: ARBOR_UI.muted, flex: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  typChip: {
    backgroundColor: ARBOR_UI.paperSoft,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  typChipText: { fontSize: 11, color: ARBOR_UI.forest, fontWeight: '800' },
  cardWartosc: { fontSize: 12, color: ARBOR_UI.forest, fontWeight: '900' },
  cardEkipa: { fontSize: 11, color: ARBOR_UI.muted },
  chevronBadge: { width: 40, height: 40, borderRadius: 12, alignSelf: 'center', marginRight: 4 },

  // Dolna nawigacja
  nav: {
    flexDirection: 'row',
    backgroundColor: ARBOR_UI.paper,
    borderTopWidth: 1, borderTopColor: ARBOR_UI.line,
    paddingBottom: 28, paddingTop: 10,
    position: 'absolute', bottom: 0, left: 0, right: 0,
    ...shadowStyle(t, { opacity: 0.08, radius: 12, offsetY: -2, elevation: Math.max(1, t.cardElevation - 1) }),
  },
  navBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderRadius: 15,
    paddingVertical: 6,
    marginHorizontal: 3,
  },
  navBtnActive: {
    backgroundColor: ARBOR_UI.leafSoft,
  },
  navLabel: { fontSize: 10.5, color: ARBOR_UI.muted, fontWeight: '900', letterSpacing: 0 },
  });
};
